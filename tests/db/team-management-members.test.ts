import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { createTeamMemberActions } from "@/features/teams/manage-members-factory";
import type { TeamRemovalDependencies } from "@/features/teams/manage-effects";
import type { Session } from "@/lib/auth/types";
import type { RealtimeItem } from "@/lib/realtime/types";
import * as schema from "@/lib/db/schema";
import {
  bookingParticipants,
  bookings,
  messages,
  notifications,
  teamMembers,
  teamInvites,
} from "@/lib/db/schema";
import { createTeamSpace } from "@/lib/dal/chat-write";
import { createMeetingRoom } from "@/lib/dal/chat-meeting";
import { canReadRoom } from "@/lib/dal/chat-access";
import { buildReminderNotifications } from "@/features/notifications/builders";
import * as notificationDal from "@/lib/dal/notifications";
import * as teamBookingDal from "@/lib/dal/team-bookings";
import * as teamWrites from "@/lib/dal/teams-write";
import { createTestDatabase, type TestDatabase } from "./helper";
import {
  bookingNow,
  bookingRange,
  insertFixtureBooking,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";

describe("member removal and team leave cancellation", () => {
  let database: TestDatabase;
  let actors: BookingActors;
  let spaceId: string;
  let teamRoomId: string;
  const events: RealtimeItem[] = [];
  const evict = vi.fn<(id: string) => Promise<void>>();
  const publish = vi.fn();
  const publishMany = vi.fn(async (items: readonly RealtimeItem[]) => {
    events.push(...items);
  });
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  afterEach(() => vi.restoreAllMocks());
  beforeEach(async () => {
    vi.clearAllMocks();
    evict.mockResolvedValue(undefined);
    publish.mockResolvedValue(undefined);
    publishMany.mockImplementation(async (items) => {
      events.push(...items);
    });
    events.length = 0;
    actors = await seedBookingActors(database);
    const space = await createTeamSpace(actors.teamId, database.db);
    spaceId = space.spaceId;
    teamRoomId = space.roomId!;
  });
  const actions = (
    session: Session | null = actors.admin,
    overrides: TeamRemovalDependencies = {},
  ) =>
    createTeamMemberActions({
      database: database.db,
      getSession: async () => session,
      now: () => bookingNow,
      publisher: { publish, publishMany },
      evict,
      logError: vi.fn(),
      ...overrides,
    });
  const input = () => ({ teamId: actors.teamId, userId: actors.member.userId });
  async function future(start = "13:00", end = "14:00", owner = actors.member) {
    const booking = await insertFixtureBooking(database, actors, {
      userId: owner.userId,
      teamId: actors.teamId,
      during: bookingRange(start, end),
    });
    const room = await createMeetingRoom(
      { bookingId: booking.id, now: bookingNow },
      database.db,
    );
    return { booking, room };
  }
  async function invite(bookingId: string, userId = actors.stranger.userId) {
    await database.db.insert(bookingParticipants).values({ bookingId, userId });
  }
  const membership = () =>
    database.db
      .select()
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, actors.teamId),
          eq(teamMembers.userId, actors.member.userId),
        ),
      );

  it("removes the membership and cancels only that member's strictly future team bookings atomically", async () => {
    const next = await future();
    await invite(next.booking.id);
    const ongoing = await insertFixtureBooking(database, actors, {
      userId: actors.member.userId,
      teamId: actors.teamId,
      during: bookingRange("12:00", "13:00"),
    });
    const personal = await insertFixtureBooking(database, actors, {
      userId: actors.member.userId,
      during: bookingRange("14:00", "15:00"),
    });
    const other = await future("15:00", "16:00", actors.admin);
    await invite(other.booking.id, actors.member.userId);
    await database.db.insert(teamInvites).values({
      teamId: actors.teamId,
      email: actors.person.email,
      token: "member-created-invite",
      createdBy: actors.member.userId,
    });
    await notificationDal.insertNotifications(
      buildReminderNotifications(
        {
          id: next.booking.id,
          during: next.booking.during,
          spaceName: "회의실 B",
          floorName: "7F",
          branchName: "강남점",
          timezone: "Asia/Seoul",
        },
        [actors.member.userId, actors.stranger.userId],
        bookingNow,
      ),
      database.db,
    );
    publishMany.mockImplementation(async (items) => {
      expect(await membership()).toEqual([]);
      events.push(...items);
    });
    expect(await actions().removeMember(input())).toEqual({
      ok: true,
      data: { teamId: actors.teamId },
    });
    expect(await membership()).toEqual([]);
    expect(
      await canReadRoom(actors.member.userId, teamRoomId, database.db),
    ).toBeNull();
    const stored = await database.db.select().from(bookings);
    expect(stored.find(({ id }) => id === next.booking.id)).toMatchObject({
      status: "cancelled",
      cancelledAt: bookingNow,
      cancelledBy: actors.admin.userId,
    });
    for (const id of [ongoing.id, personal.id, other.booking.id])
      expect(stored.find((row) => row.id === id)?.status).toBe("confirmed");
    expect(await database.db.select().from(teamInvites)).toHaveLength(1);
    expect(
      await database.db
        .select()
        .from(bookingParticipants)
        .where(eq(bookingParticipants.bookingId, other.booking.id)),
    ).toMatchObject([{ userId: actors.member.userId }]);
    expect(await database.db.select().from(messages)).toMatchObject([
      {
        roomId: next.room.id,
        kind: "system",
        systemData: { type: "booking_cancelled", actorName: actors.admin.name },
      },
    ]);
    const notices = await database.db.select().from(notifications);
    expect(notices.filter(({ type }) => type === "booking_reminder")).toEqual(
      [],
    );
    expect(
      notices
        .filter(({ type }) => type === "booking_cancelled")
        .map(({ userId }) => userId)
        .sort(),
    ).toEqual([actors.member.userId, actors.stranger.userId].sort());
    expect(notices.filter(({ type }) => type === "team_removed")).toMatchObject(
      [
        {
          userId: actors.member.userId,
          data: { actorName: actors.admin.name, teamName: "그로스팀" },
        },
      ],
    );
    expect(events).toContainEqual({
      channel: `user:${actors.member.userId}`,
      event: { type: "realtime.reauth" },
    });
    expect(events).toContainEqual({
      channel: `space:${spaceId}`,
      event: { type: "space.changed", spaceId },
    });
    expect(events).toContainEqual({
      channel: `user:${actors.stranger.userId}`,
      event: { type: "notifications.changed" },
    });
    expect(evict.mock.calls.map(([id]) => id).sort()).toEqual(
      [actors.member.userId, actors.stranger.userId].sort(),
    );
    expect(publish).toHaveBeenCalledExactlyOnceWith(`floor:${actors.floorId}`, {
      type: "booking.changed",
      spaceId: actors.publicSpaceId,
    });
  });
  it("excludes a booking starting exactly now from automatic cancellation", async () => {
    const row = await insertFixtureBooking(database, actors, {
      userId: actors.member.userId,
      teamId: actors.teamId,
      during: {
        start: bookingNow,
        end: new Date(bookingNow.getTime() + 30 * 60_000),
      },
    });
    expect((await actions().removeMember(input())).ok).toBe(true);
    expect(
      (
        await database.db.select().from(bookings).where(eq(bookings.id, row.id))
      )[0]?.status,
    ).toBe("confirmed");
  });
  it("cancels future desk bookings using the desk area's notification and floor target without meeting events", async () => {
    const row = await insertFixtureBooking(database, actors, {
      spaceId: actors.deskId,
      userId: actors.member.userId,
      teamId: actors.teamId,
      kind: "desk_half",
      during: bookingRange("13:00", "18:00"),
    });
    expect((await actions().removeMember(input())).ok).toBe(true);
    const notice = (await database.db.select().from(notifications)).find(
      ({ type }) => type === "booking_cancelled",
    );
    expect(notice).toMatchObject({
      bookingId: row.id,
      userId: actors.member.userId,
      data: { spaceName: "데스크 구역 좌석 1" },
    });
    expect(publish).toHaveBeenCalledWith(`floor:${actors.floorId}`, {
      type: "booking.changed",
      spaceId: actors.deskAreaId,
    });
    expect(await database.db.select().from(messages)).toEqual([]);
  });
  it("lets a normal member leave, sends no team_removed or own cancellation notification", async () => {
    const row = await future();
    await invite(row.booking.id);
    expect(
      await actions(actors.member).leaveTeam({ teamId: actors.teamId }),
    ).toEqual({ ok: true, data: { teamId: actors.teamId } });
    expect(await membership()).toEqual([]);
    expect(
      (await database.db.select().from(notifications)).map(
        ({ type, userId }) => ({ type, userId }),
      ),
    ).toEqual([{ type: "booking_cancelled", userId: actors.stranger.userId }]);
  });
  it("rejects self-removal and the last admin leaving", async () => {
    expect(
      await actions().removeMember({
        teamId: actors.teamId,
        userId: actors.admin.userId,
      }),
    ).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(await actions().leaveTeam({ teamId: actors.teamId })).toEqual({
      ok: false,
      code: "LAST_ADMIN",
    });
  });
  it("rejects leaving a team containing only myself", async () => {
    await database.db
      .delete(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, actors.otherTeamId),
          eq(teamMembers.userId, actors.member.userId),
        ),
      );
    expect(
      await actions(actors.otherMember).leaveTeam({
        teamId: actors.otherTeamId,
      }),
    ).toEqual({ ok: false, code: "LAST_ADMIN" });
  });
  it("allows only the first of two admins removing each other", async () => {
    await database.db
      .update(teamMembers)
      .set({ role: "admin" })
      .where(
        and(
          eq(teamMembers.teamId, actors.teamId),
          eq(teamMembers.userId, actors.member.userId),
        ),
      );
    expect((await actions().removeMember(input())).ok).toBe(true);
    expect(
      await actions(actors.member).removeMember({
        teamId: actors.teamId,
        userId: actors.admin.userId,
      }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
  });
  it("rejects a normal member removing another member and an absent target", async () => {
    expect(
      await actions(actors.member).removeMember({
        teamId: actors.teamId,
        userId: actors.admin.userId,
      }),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(
      await actions().removeMember({
        teamId: actors.teamId,
        userId: actors.stranger.userId,
      }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await membership()).toHaveLength(1);
  });
  it("rejects a former admin when current membership is rechecked under the team lock", async () => {
    const original = teamWrites.lockTeam;
    vi.spyOn(teamWrites, "lockTeam").mockImplementationOnce(async (id, tx) => {
      await tx
        .update(teamMembers)
        .set({ role: "member" })
        .where(
          and(
            eq(teamMembers.teamId, id),
            eq(teamMembers.userId, actors.admin.userId),
          ),
        );
      return original(id, tx);
    });
    expect(await actions().removeMember(input())).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
    expect(await membership()).toHaveLength(1);
  });
  it("retries the whole transaction when the participant set grew beyond its initial snapshot", async () => {
    const row = await future();
    await invite(row.booking.id);
    const original = teamBookingDal.listFutureTeamBookings;
    vi.spyOn(teamBookingDal, "listFutureTeamBookings").mockImplementationOnce(
      async (scope, tx) =>
        (await original(scope, tx)).map((row) => ({
          ...row,
          participantIds: [],
        })),
    );
    const transaction = vi.spyOn(database.db, "transaction");
    expect((await actions().removeMember(input())).ok).toBe(true);
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(await database.db.select().from(messages)).toHaveLength(1);
    expect(publishMany).toHaveBeenCalledTimes(1);
    expect(evict).toHaveBeenCalledWith(actors.stranger.userId);
  });
  it("locks every booking before the chat space and all meeting room effects", async () => {
    await future();
    await future("14:00", "15:00");
    const statements: { query: string; params: unknown[] }[] = [];
    const logged = drizzle({
      client: database.client,
      schema,
      logger: {
        logQuery(query, params) {
          statements.push({ query, params });
        },
      },
    });
    expect(
      (await actions(actors.admin, { database: logged }).removeMember(input()))
        .ok,
    ).toBe(true);
    const locks = statements.filter(({ query }) =>
      /for (update|key share)/u.test(query),
    );
    expect(locks.slice(0, 2).map(({ params }) => params[0])).toEqual(
      [actors.admin.userId, actors.member.userId].sort(),
    );
    expect(
      locks.slice(0, 2).map(({ query, params }) => ({
        id: params[0],
        update: query.endsWith("for update"),
      })),
    ).toEqual(
      [actors.admin.userId, actors.member.userId]
        .sort()
        .map((id) => ({ id, update: id === actors.admin.userId })),
    );
    const bookingLock = locks.findIndex(({ query }) =>
      /from "bookings".*for update/u.test(query),
    );
    const spaceLock = locks.findIndex(({ query }) =>
      /from "chat_spaces".*for update/u.test(query),
    );
    const roomLock = locks.findIndex(({ query }) =>
      /from "chat_rooms".*for update/u.test(query),
    );
    expect(bookingLock).toBeGreaterThan(3);
    expect(spaceLock).toBeGreaterThan(bookingLock);
    expect(roomLock).toBeGreaterThan(spaceLock);
    expect(
      locks.filter(({ query }) => /from "bookings"/u.test(query)),
    ).toHaveLength(1);
    expect(locks[bookingLock]?.query).toMatch(/order by "bookings"\."id" asc/u);
    expect(
      locks.some(({ query }) => /from "(floors|spaces)"/u.test(query)),
    ).toBe(false);
  });
  it("stops after three changing participant snapshots without committing or publishing", async () => {
    const row = await future();
    await invite(row.booking.id);
    const original = teamBookingDal.listFutureTeamBookings;
    let reads = 0;
    vi.spyOn(teamBookingDal, "listFutureTeamBookings").mockImplementation(
      async (scope, tx) => {
        const rows = await original(scope, tx);
        reads++;
        return reads % 2 === 1
          ? rows.map((row) => ({ ...row, participantIds: [] }))
          : rows;
      },
    );
    const transaction = vi.spyOn(database.db, "transaction");
    expect(await actions().removeMember(input())).toEqual({
      ok: false,
      code: "INTERNAL",
    });
    expect(transaction).toHaveBeenCalledTimes(3);
    expect(await membership()).toHaveLength(1);
    expect(await database.db.select().from(messages)).toEqual([]);
    expect(events).toEqual([]);
    expect(evict).not.toHaveBeenCalled();
  });
  it("rolls membership, all cancellations, reminders and system messages back on a later notification failure", async () => {
    const row = await future();
    vi.spyOn(notificationDal, "insertNotifications").mockRejectedValueOnce(
      new Error("private failure"),
    );
    expect(await actions().removeMember(input())).toEqual({
      ok: false,
      code: "INTERNAL",
    });
    expect(await membership()).toHaveLength(1);
    expect(
      (
        await database.db
          .select()
          .from(bookings)
          .where(eq(bookings.id, row.booking.id))
      )[0]?.status,
    ).toBe("confirmed");
    expect(await database.db.select().from(messages)).toEqual([]);
    expect(events).toEqual([]);
    expect(evict).not.toHaveBeenCalled();
  });
  it("attempts independent post-commit effects even when publication, eviction and logging fail", async () => {
    const row = await future();
    await invite(row.booking.id);
    publishMany.mockRejectedValue(new Error("publish failure"));
    evict.mockRejectedValue(new Error("eviction failure"));
    const logError = vi.fn(() => {
      throw new Error("logger failure");
    });
    expect(
      (await actions(actors.admin, { logError }).removeMember(input())).ok,
    ).toBe(true);
    expect(evict).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(await membership()).toEqual([]);
  });
  it.each(["removeMember", "leaveTeam"] as const)(
    "requires a session before %s validation",
    async (method) => {
      expect(await actions(null)[method]({})).toEqual({
        ok: false,
        code: "UNAUTHENTICATED",
      });
      expect(
        await actions(actors.stranger)[method](
          method === "removeMember" ? input() : { teamId: actors.teamId },
        ),
      ).toEqual({ ok: false, code: "NOT_FOUND" });
    },
  );
});
