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
import { createTeamDeleteActions } from "@/features/teams/manage-delete-factory";
import { createTeamActions } from "@/features/teams/create-team-factory";
import { createTeamQueries } from "@/features/teams/query-factory";
import { createInviteResponseActions } from "@/features/teams/invite-response-factory";
import { buildReminderNotifications } from "@/features/notifications/builders";
import type { TeamRemovalDependencies } from "@/features/teams/manage-effects";
import type { Session } from "@/lib/auth/types";
import type { RealtimeItem } from "@/lib/realtime/types";
import * as schema from "@/lib/db/schema";
import {
  accessGrants,
  bookingParticipants,
  bookings,
  chatRooms,
  chatSpaces,
  messages,
  notifications,
  spaces,
  teamInvites,
  teamJoinRequests,
  teamMembers,
  teams,
} from "@/lib/db/schema";
import { createTeamSpace } from "@/lib/dal/chat-write";
import { createMeetingRoom } from "@/lib/dal/chat-meeting";
import { canReadRoom } from "@/lib/dal/chat-access";
import { getBookingWithLocation } from "@/lib/dal/bookings";
import {
  getInviteForRecipient,
  getTeamById,
  searchTeams,
} from "@/lib/dal/teams-read";
import * as deletionDal from "@/lib/dal/team-deletion";
import * as bookingDal from "@/lib/dal/team-bookings";
import * as notificationDal from "@/lib/dal/notifications";
import * as teamWrites from "@/lib/dal/teams-write";
import { createTestDatabase, type TestDatabase } from "./helper";
import {
  bookingNow,
  bookingRange,
  insertFixtureBooking,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";

describe("soft deletion of a team", () => {
  let database: TestDatabase;
  let actors: BookingActors;
  let spaceId: string;
  let roomId: string;
  const evict = vi.fn<(id: string) => Promise<void>>();
  const publish = vi.fn();
  const events: RealtimeItem[] = [];
  const publishMany = vi.fn(async (items: readonly RealtimeItem[]) => {
    events.push(...items);
  });
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => database.client.close());
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
    roomId = space.roomId!;
  });
  const actions = (
    session: Session | null = actors.admin,
    overrides: TeamRemovalDependencies = {},
  ) =>
    createTeamDeleteActions({
      database: database.db,
      getSession: async () => session,
      now: () => bookingNow,
      publisher: { publish, publishMany },
      evict,
      logError: vi.fn(),
      ...overrides,
    });
  const input = () => ({ teamId: actors.teamId, confirmName: "그로스팀" });
  const team = async () =>
    (
      await database.db.select().from(teams).where(eq(teams.id, actors.teamId))
    )[0];
  async function future(
    start = "13:00",
    end = "14:00",
    userId = actors.member.userId,
  ) {
    const row = await insertFixtureBooking(database, actors, {
      userId,
      teamId: actors.teamId,
      during: bookingRange(start, end),
    });
    await createMeetingRoom(
      { bookingId: row.id, now: bookingNow },
      database.db,
    );
    return row;
  }

  it("soft deletes the team and its space while retaining channels, bookings and messages", async () => {
    const next = await future();
    const own = await future("14:00", "15:00", actors.admin.userId);
    await database.db.insert(bookingParticipants).values({
      bookingId: next.id,
      userId: actors.stranger.userId,
    });
    const past = await insertFixtureBooking(database, actors, {
      teamId: actors.teamId,
      userId: actors.member.userId,
      during: bookingRange("10:00", "11:00"),
    });
    const ongoing = await insertFixtureBooking(database, actors, {
      teamId: actors.teamId,
      userId: actors.member.userId,
      during: bookingRange("12:00", "13:00"),
    });
    const personal = await insertFixtureBooking(database, actors, {
      userId: actors.member.userId,
      during: bookingRange("15:00", "16:00"),
    });
    publishMany.mockImplementation(async (items) => {
      expect((await team())?.deletedAt).toEqual(bookingNow);
      events.push(...items);
    });
    expect(await actions().deleteTeam(input())).toEqual({
      ok: true,
      data: { teamId: actors.teamId },
    });
    expect(await team()).toMatchObject({
      name: "그로스팀",
      deletedAt: bookingNow,
      deletedBy: actors.admin.userId,
    });
    expect(
      await database.db
        .select()
        .from(teamMembers)
        .where(eq(teamMembers.teamId, actors.teamId)),
    ).toEqual([]);
    expect(
      await database.db
        .select()
        .from(teamMembers)
        .where(eq(teamMembers.teamId, actors.otherTeamId)),
    ).toHaveLength(2);
    expect(
      (
        await database.db
          .select()
          .from(chatSpaces)
          .where(eq(chatSpaces.id, spaceId))
      )[0]?.deletedAt,
    ).toEqual(bookingNow);
    expect(await database.db.select().from(chatRooms)).toHaveLength(4);
    const stored = await database.db.select().from(bookings);
    expect(stored).toHaveLength(5);
    for (const id of [next.id, own.id])
      expect(stored.find((row) => row.id === id)).toMatchObject({
        status: "cancelled",
        cancelledBy: actors.admin.userId,
        cancelledAt: bookingNow,
      });
    for (const id of [past.id, ongoing.id, personal.id])
      expect(stored.find((row) => row.id === id)?.status).toBe("confirmed");
    expect(await database.db.select().from(messages)).toHaveLength(2);
    expect(
      (await database.db.select().from(notifications))
        .filter(({ type }) => type === "team_deleted")
        .map(({ userId, actorId, data }) => ({ userId, actorId, data })),
    ).toEqual([
      {
        userId: actors.member.userId,
        actorId: actors.admin.userId,
        data: { teamName: "그로스팀", actorName: actors.admin.name },
      },
    ]);
    expect(evict.mock.calls.map(([id]) => id).sort()).toEqual(
      [
        actors.admin.userId,
        actors.member.userId,
        actors.stranger.userId,
      ].sort(),
    );
    for (const userId of [actors.admin.userId, actors.member.userId])
      expect(events).toContainEqual({
        channel: `user:${userId}`,
        event: { type: "realtime.reauth" },
      });
    for (const userId of [actors.member.userId, actors.stranger.userId])
      expect(
        events.filter(
          (row) =>
            row.channel === `user:${userId}` &&
            row.event.type === "notifications.changed",
        ),
      ).toHaveLength(1);
    expect(
      events.some(
        (row) =>
          row.channel === `user:${actors.admin.userId}` &&
          row.event.type === "notifications.changed",
      ),
    ).toBe(false);
    expect(
      publish.mock.calls.filter(
        ([, event]) => event.type === "booking.changed",
      ),
    ).toEqual([
      [
        `floor:${actors.floorId}`,
        { type: "booking.changed", spaceId: actors.publicSpaceId },
      ],
    ]);
  });

  it("revokes only pending invitations and rejects only pending requests with audit columns", async () => {
    const invites = await database.db
      .insert(teamInvites)
      .values([
        {
          teamId: actors.teamId,
          email: actors.person.email,
          token: "pending-token",
          createdBy: actors.admin.userId,
        },
        {
          teamId: actors.teamId,
          email: actors.person.email,
          token: "accepted-token",
          createdBy: actors.admin.userId,
          acceptedAt: bookingNow,
        },
        {
          teamId: actors.teamId,
          email: actors.person.email,
          token: "declined-token",
          createdBy: actors.admin.userId,
          declinedAt: bookingNow,
        },
        {
          teamId: actors.otherTeamId,
          email: actors.person.email,
          token: "other-token",
          createdBy: actors.otherMember.userId,
        },
      ])
      .returning();
    const requests = await database.db
      .insert(teamJoinRequests)
      .values([
        { teamId: actors.teamId, userId: actors.person.userId },
        {
          teamId: actors.teamId,
          userId: actors.stranger.userId,
          status: "approved",
          decidedBy: actors.admin.userId,
          decidedAt: bookingNow,
        },
        { teamId: actors.otherTeamId, userId: actors.person.userId },
      ])
      .returning();
    expect((await actions().deleteTeam(input())).ok).toBe(true);
    const savedInvites = await database.db.select().from(teamInvites);
    expect(
      savedInvites.find((row) => row.id === invites[0]!.id)?.revokedAt,
    ).toEqual(bookingNow);
    for (const row of invites.slice(1))
      expect(savedInvites.find(({ id }) => id === row.id)).toEqual(row);
    const savedRequests = await database.db.select().from(teamJoinRequests);
    expect(
      savedRequests.find((row) => row.id === requests[0]!.id),
    ).toMatchObject({
      status: "rejected",
      decidedBy: actors.admin.userId,
      decidedAt: bookingNow,
    });
    for (const row of requests.slice(1))
      expect(savedRequests.find(({ id }) => id === row.id)).toEqual(row);
  });

  it("removes only this team's grants and notifies each affected space once including floor grants", async () => {
    await database.db.insert(accessGrants).values([
      {
        teamId: actors.otherTeamId,
        targetType: "space",
        targetId: actors.restrictedSpaceId,
      },
      {
        teamId: actors.teamId,
        targetType: "space",
        targetId: actors.restrictedFloorSpaceId,
      },
    ]);
    const [extra] = await database.db
      .insert(spaces)
      .values({
        floorId: actors.restrictedFloorId,
        type: "lounge",
        name: "또 다른 허용 공간",
        bookable: false,
      })
      .returning();
    expect((await actions().deleteTeam(input())).ok).toBe(true);
    expect(await database.db.select().from(accessGrants)).toMatchObject([
      { teamId: actors.otherTeamId, targetId: actors.restrictedSpaceId },
    ]);
    expect(
      publish.mock.calls.filter(
        ([, event]) => event.type === "space.status_changed",
      ),
    ).toEqual(
      expect.arrayContaining([
        [
          `floor:${actors.floorId}`,
          { type: "space.status_changed", spaceId: actors.restrictedSpaceId },
        ],
        [
          `floor:${actors.restrictedFloorId}`,
          {
            type: "space.status_changed",
            spaceId: actors.restrictedFloorSpaceId,
          },
        ],
        [
          `floor:${actors.restrictedFloorId}`,
          { type: "space.status_changed", spaceId: extra!.id },
        ],
      ]),
    );
    expect(publish).toHaveBeenCalledTimes(3);
  });

  it("hides the deleted team, denies its channels, invalidates invitation URLs, and labels historical bookings", async () => {
    const past = await insertFixtureBooking(database, actors, {
      teamId: actors.teamId,
    });
    const token = "a".repeat(64);
    await database.db.insert(teamInvites).values({
      teamId: actors.teamId,
      email: actors.person.email,
      token,
      createdBy: actors.admin.userId,
      expiresAt: new Date(bookingNow.getTime() + 86_400_000),
    });
    expect((await actions().deleteTeam(input())).ok).toBe(true);
    expect(await getTeamById(actors.teamId, database.db)).toBeNull();
    expect(await searchTeams("그로스", database.db)).toEqual([]);
    expect(
      await createTeamQueries({
        database: database.db,
        requireSession: async () => actors.admin,
        now: () => bookingNow,
      }).getTeamPageData(actors.teamId),
    ).toBeNull();
    expect(
      await getInviteForRecipient(
        token,
        actors.person.email,
        database.db,
        bookingNow,
      ),
    ).toBeNull();
    expect(
      await createInviteResponseActions({
        database: database.db,
        getSession: async () => actors.person,
        logError: vi.fn(),
      }).acceptTeamInvite({ token }),
    ).toEqual({ ok: false, code: "INVITE_INVALID" });
    for (const person of [actors.admin, actors.member, actors.operator])
      expect(await canReadRoom(person.userId, roomId, database.db)).toBeNull();
    expect((await getBookingWithLocation(past.id, database.db))?.teamName).toBe(
      "지운 팀",
    );
  });

  it("allows a new team to reuse the deleted name through the normal create action", async () => {
    expect((await actions().deleteTeam(input())).ok).toBe(true);
    const result = await createTeamActions({
      database: database.db,
      getSession: async () => actors.admin,
      logError: vi.fn(),
    }).createTeam({
      name: "그로스팀",
      homeBranchId: actors.branchId,
      headcount: 3,
      contactPhone: "02-1234-5678",
      title: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.id).not.toBe(actors.teamId);
    expect((await team())?.deletedAt).toEqual(bookingNow);
  });

  it("normalizes confirmation whitespace but requires exact case and the latest locked team name", async () => {
    await database.db
      .update(teams)
      .set({ name: "Growth 팀" })
      .where(eq(teams.id, actors.teamId));
    expect(
      await actions().deleteTeam({ ...input(), confirmName: "growth 팀" }),
    ).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect((await team())?.deletedAt).toBeNull();
    expect(
      (
        await actions().deleteTeam({
          ...input(),
          confirmName: "  Growth   팀  ",
        })
      ).ok,
    ).toBe(true);
  });

  it("rechecks a renamed team and a demoted actor after acquiring the team lock", async () => {
    const original = teamWrites.lockTeam;
    vi.spyOn(teamWrites, "lockTeam").mockImplementationOnce(async (id, tx) => {
      await tx
        .update(teams)
        .set({ name: "잠금 전 새 이름" })
        .where(eq(teams.id, id));
      return original(id, tx);
    });
    expect(await actions().deleteTeam(input())).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    });
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
    expect(await actions().deleteTeam(input())).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
    expect((await team())?.deletedAt).toBeNull();
  });

  it("requires authentication, manager rights and a live team", async () => {
    expect(await actions(null).deleteTeam({})).toEqual({
      ok: false,
      code: "UNAUTHENTICATED",
    });
    expect(await actions(actors.member).deleteTeam(input())).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
    expect(await actions(actors.stranger).deleteTeam(input())).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect((await actions().deleteTeam(input())).ok).toBe(true);
    expect(await actions().deleteTeam(input())).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
  });

  it("supports a team with no future bookings or active chat space and preserves unrelated spaces", async () => {
    const otherSpace = await createTeamSpace(actors.otherTeamId, database.db);
    await database.db
      .update(chatSpaces)
      .set({ deletedAt: bookingNow })
      .where(eq(chatSpaces.id, spaceId));
    expect((await actions().deleteTeam(input())).ok).toBe(true);
    expect(await database.db.select().from(messages)).toEqual([]);
    expect((await team())?.deletedAt).toEqual(bookingNow);
    expect(
      (
        await database.db
          .select()
          .from(chatSpaces)
          .where(eq(chatSpaces.id, otherSpace.spaceId))
      )[0]?.deletedAt,
    ).toBeNull();
  });

  it("allows the sole administrator to delete the team rather than leave it", async () => {
    await database.db
      .delete(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, actors.teamId),
          eq(teamMembers.userId, actors.member.userId),
        ),
      );
    expect((await actions().deleteTeam(input())).ok).toBe(true);
    expect((await team())?.deletedAt).toEqual(bookingNow);
    expect(await database.db.select().from(notifications)).toEqual([]);
    expect(evict).toHaveBeenCalledExactlyOnceWith(actors.admin.userId);
  });

  it("retries when a newly observed team member was not in the first user-lock set", async () => {
    const original = deletionDal.listTeamMemberUserIds;
    vi.spyOn(deletionDal, "listTeamMemberUserIds").mockImplementationOnce(
      async (teamId, tx) =>
        (await original(teamId, tx)).filter(
          (id) => id !== actors.member.userId,
        ),
    );
    const transaction = vi.spyOn(database.db, "transaction");
    expect((await actions().deleteTeam(input())).ok).toBe(true);
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(
      events.filter(({ event }) => event.type === "realtime.reauth"),
    ).toHaveLength(2);
    expect(
      events.filter(({ event }) => event.type === "space.changed"),
    ).toHaveLength(1);
    expect(evict).toHaveBeenCalledTimes(2);
  });

  it("retries a changed participant set and cancels once after locking the full set", async () => {
    const row = await future();
    await database.db
      .insert(bookingParticipants)
      .values({ bookingId: row.id, userId: actors.stranger.userId });
    const original = bookingDal.listFutureTeamBookings;
    vi.spyOn(bookingDal, "listFutureTeamBookings").mockImplementationOnce(
      async (scope, tx) =>
        (await original(scope, tx)).map((row) => ({
          ...row,
          participantIds: [],
        })),
    );
    const transaction = vi.spyOn(database.db, "transaction");
    expect((await actions().deleteTeam(input())).ok).toBe(true);
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(await database.db.select().from(messages)).toHaveLength(1);
    expect(evict).toHaveBeenCalledTimes(3);
  });

  it("rolls every deletion and cancellation back when the last notification write fails", async () => {
    const row = await future();
    const reminders = buildReminderNotifications(
      {
        id: row.id,
        during: row.during,
        spaceName: "회의실 B",
        floorName: "7F",
        branchName: "강남점",
        timezone: "Asia/Seoul",
      },
      [actors.member.userId],
      bookingNow,
    );
    await notificationDal.insertNotifications(reminders, database.db);
    await database.db.insert(teamInvites).values({
      teamId: actors.teamId,
      email: actors.person.email,
      token: "rollback-invite",
      createdBy: actors.admin.userId,
    });
    await database.db
      .insert(teamJoinRequests)
      .values({ teamId: actors.teamId, userId: actors.person.userId });
    const original = notificationDal.insertNotifications;
    vi.spyOn(notificationDal, "insertNotifications").mockImplementation(
      (rows, tx) => {
        if (rows.some(({ type }) => type === "team_deleted"))
          return Promise.reject(new Error("private rollback reason"));
        return original(rows, tx);
      },
    );
    expect(await actions().deleteTeam(input())).toEqual({
      ok: false,
      code: "INTERNAL",
    });
    expect((await team())?.deletedAt).toBeNull();
    expect(
      await database.db
        .select()
        .from(teamMembers)
        .where(eq(teamMembers.teamId, actors.teamId)),
    ).toHaveLength(2);
    expect(
      (
        await database.db.select().from(bookings).where(eq(bookings.id, row.id))
      )[0]?.status,
    ).toBe("confirmed");
    expect(
      (
        await database.db
          .select()
          .from(chatSpaces)
          .where(eq(chatSpaces.id, spaceId))
      )[0]?.deletedAt,
    ).toBeNull();
    expect(await database.db.select().from(accessGrants)).toHaveLength(2);
    expect((await database.db.select().from(teamJoinRequests))[0]?.status).toBe(
      "pending",
    );
    expect(await database.db.select().from(messages)).toEqual([]);
    expect(
      (await database.db.select().from(notifications)).map(({ type }) => type),
    ).toEqual(reminders.map(({ type }) => type));
    expect(
      (await database.db.select().from(teamInvites))[0]?.revokedAt,
    ).toBeNull();
    expect(events).toEqual([]);
    expect(evict).not.toHaveBeenCalled();
  });

  it("keeps committed success and attempts evictions and all floor effects even if other effects fail", async () => {
    await future();
    publishMany.mockRejectedValue(new Error("private publisher failure"));
    publish.mockRejectedValue(new Error("private floor failure"));
    evict.mockRejectedValue(new Error("private eviction failure"));
    const logError = vi.fn(() => {
      throw new Error("private logger failure");
    });
    expect(
      (await actions(actors.admin, { logError }).deleteTeam(input())).ok,
    ).toBe(true);
    expect(evict).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledTimes(3);
    expect((await team())?.deletedAt).toEqual(bookingNow);
  });

  it("attempts space, chat and notification publications after the reauthorization batch fails", async () => {
    await future();
    publishMany.mockRejectedValueOnce(
      new Error("private first category failure"),
    );
    expect((await actions().deleteTeam(input())).ok).toBe(true);
    const batches = publishMany.mock.calls.map(([items]) => items);
    expect(batches).toHaveLength(4);
    expect(batches[0]?.map(({ event }) => event.type)).toEqual([
      "realtime.reauth",
      "realtime.reauth",
    ]);
    expect(events.some(({ event }) => event.type === "space.changed")).toBe(
      true,
    );
    expect(events.some(({ event }) => event.type === "message.created")).toBe(
      true,
    );
    expect(
      events.some(({ event }) => event.type === "notifications.changed"),
    ).toBe(true);
    expect(evict).toHaveBeenCalledTimes(2);
    expect((await team())?.deletedAt).toEqual(bookingNow);
  });

  it("locks users once in UUID order then team, memberships, all bookings, space and meeting rooms", async () => {
    const next = await future();
    await future("14:00", "15:00");
    await database.db
      .insert(bookingParticipants)
      .values({ bookingId: next.id, userId: actors.stranger.userId });
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
      (await actions(actors.admin, { database: logged }).deleteTeam(input()))
        .ok,
    ).toBe(true);
    const locks = statements.filter(({ query }) =>
      /for (update|key share)/u.test(query),
    );
    const userIds = [
      actors.admin.userId,
      actors.member.userId,
      actors.stranger.userId,
    ].sort();
    expect(locks.slice(0, 3).map(({ params }) => params[0])).toEqual(userIds);
    expect(
      locks.slice(0, 3).map(({ query, params }) => ({
        id: params[0],
        update: query.endsWith("for update"),
      })),
    ).toEqual(
      userIds.map((id) => ({ id, update: id === actors.admin.userId })),
    );
    expect(locks[3]?.query).toContain('from "teams"');
    expect(locks[4]?.query).toContain('from "team_members"');
    expect(locks[5]?.query).toMatch(
      /from "bookings".*order by "bookings"\."id" asc.*for update/u,
    );
    expect(locks[6]?.query).toContain('from "chat_spaces"');
    expect(locks[7]?.query).toContain('from "chat_rooms"');
    expect(
      locks.filter(({ query }) => query.includes('from "users"')),
    ).toHaveLength(3);
    expect(
      locks.filter(({ query }) => query.includes('from "bookings"')),
    ).toHaveLength(1);
    expect(
      locks.some(({ query }) => /from "(floors|spaces)"/u.test(query)),
    ).toBe(false);
  });

  it("records the actual statement count for deleting thirty future team reservations", async () => {
    const roomIds: string[] = [];
    const values = Array.from({ length: 30 }, (_, index) => {
      const start = new Date(bookingNow.getTime() + (index + 1) * 60 * 60_000);
      return {
        userId: actors.member.userId,
        teamId: actors.teamId,
        spaceId: actors.publicSpaceId,
        during: { start, end: new Date(start.getTime() + 30 * 60_000) },
      };
    });
    const rows = await database.db.insert(bookings).values(values).returning();
    for (const row of rows)
      roomIds.push(
        (
          await createMeetingRoom(
            { bookingId: row.id, now: bookingNow },
            database.db,
          )
        ).id,
      );
    const statements: string[] = [];
    const logged = drizzle({
      client: database.client,
      schema,
      logger: {
        logQuery(query) {
          statements.push(query);
        },
      },
    });
    expect(
      (await actions(actors.admin, { database: logged }).deleteTeam(input()))
        .ok,
    ).toBe(true);
    expect(
      await database.db
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.teamId, actors.teamId),
            eq(bookings.status, "cancelled"),
          ),
        ),
    ).toHaveLength(30);
    expect(await database.db.select().from(messages)).toHaveLength(30);
    expect(roomIds).toHaveLength(30);
    const transactionStatements = statements.filter(
      (query) =>
        !["begin", "commit", "rollback"].includes(query.trim().toLowerCase()),
    );
    expect(transactionStatements.length).toBeGreaterThan(30);
    console.info(
      `team-delete-30-bookings: ${transactionStatements.length} SQL statements (authorization included; transaction control and setup excluded)`,
    );
  });
});
