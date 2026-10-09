import { and, eq } from "drizzle-orm";
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
import { createAnnouncementQueries } from "@/features/admin/announcement-query-factory";
import type {
  GetAnnouncementsInput,
  PreviewAnnouncementAudienceInput,
} from "@/features/admin/announcement-schema";
import { ActionError } from "@/lib/actions/result";
import type { Session } from "@/lib/auth/types";
import * as read from "@/lib/dal/announcements-read";
import { createBranchLounge } from "@/lib/dal/chat-write";
import {
  announcements,
  bookingParticipants,
  branchStaff,
  chatRooms,
  chatSpaceMembers,
  chatSpaces,
  messages,
  roleSettings,
  spaces,
  users,
} from "@/lib/db/schema";
import {
  bookingNow,
  bookingRange,
  insertFixtureBooking,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";
import { createQueryMeter } from "./query-meter";

describe("announcement reads and audience", () => {
  let database: TestDatabase;
  let actors: BookingActors;
  let meter: ReturnType<typeof createQueryMeter>;
  beforeAll(async () => {
    database = await createTestDatabase();
    meter = createQueryMeter(database.client);
  });
  beforeEach(async () => {
    actors = await seedBookingActors(database);
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    meter.restore();
    await database.client.close();
  });
  const query = (session: Session = actors.operator) =>
    createAnnouncementQueries({
      database: database.db,
      requireSession: async () => session,
      now: () => bookingNow,
    });
  const preview = (): PreviewAnnouncementAudienceInput => ({
    branchId: actors.branchId,
    lounge: true,
    audience: { date: "2026-10-07", floorId: null, spaceId: null },
  });
  const scope = () => ({
    branchId: actors.branchId,
    operatorId: actors.operator.userId,
  });
  const recipientInput = () => ({
    ...scope(),
    floorId: null,
    spaceId: null,
    start: new Date("2026-10-06T15:00:00Z"),
    end: new Date("2026-10-07T15:00:00Z"),
  });
  async function lounge() {
    const { spaceId } = await createBranchLounge(actors.branchId, database.db);
    const [room] = await database.db
      .select({ id: chatRooms.id })
      .from(chatRooms)
      .where(and(eq(chatRooms.spaceId, spaceId), eq(chatRooms.name, "공지")));
    return { spaceId, roomId: room!.id };
  }
  async function member(
    spaceId: string,
    userId = actors.operator.userId,
    status: "active" | "banned" = "active",
  ) {
    await database.db.insert(chatSpaceMembers).values({
      spaceId,
      userId,
      status,
      joinedAt: bookingNow,
      statusChangedAt: bookingNow,
    });
  }
  it("checks the session before parsing and SQL", async () => {
    const subject = createAnnouncementQueries({
      database: database.db,
      requireSession: async () => {
        throw new ActionError("UNAUTHENTICATED");
      },
    });
    meter.start();
    await expect(
      subject.getAnnouncements({ branchId: "bad" }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(
      subject.previewAnnouncementAudience({ ...preview(), branchId: "bad" }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(meter.stop().statements).toBe(0);
  });
  it("strictly validates runtime arguments before SQL", async () => {
    meter.start();
    for (const value of [
      { branchId: "bad" },
      { branchId: actors.branchId, actorId: actors.operator.userId },
    ])
      await expect(
        query().getAnnouncements(value as GetAnnouncementsInput),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    for (const value of [
      { ...preview(), title: "private" },
      { ...preview(), audience: { date: "bad", floorId: null, spaceId: null } },
    ])
      await expect(
        query().previewAnnouncementAudience(
          value as PreviewAnnouncementAudienceInput,
        ),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(meter.stop().statements).toBe(0);
  });
  it("reads only gated relationship IDs before permission, not floor or space names", async () => {
    const run = vi.spyOn(database.client, "query");
    const metadata = await read.readAnnouncementBranch(scope(), database.db);
    expect(metadata?.floors).toEqual(
      expect.arrayContaining([
        {
          id: actors.floorId,
          spaces: expect.arrayContaining([{ id: actors.publicSpaceId }]),
        },
      ]),
    );
    expect(
      metadata?.floors.every(
        (floor) =>
          Object.keys(floor).sort().join() === "id,spaces" &&
          floor.spaces.every((space) => Object.keys(space).join() === "id"),
      ),
    ).toBe(true);
    expect(run.mock.calls[0]?.[0]).not.toMatch(/"(?:floors|spaces)"\."name"/);
    expect(run.mock.calls[0]?.[0]).toContain("exists(select 1 from");
    await expect(
      read.readAnnouncementBranch(
        { ...scope(), operatorId: actors.otherOperator.userId },
        database.db,
      ),
    ).resolves.toBeNull();
  });
  it.each(["person", "otherOperator"] as const)(
    "hides another branch from %s before audience or history",
    async (name) => {
      const count = vi.spyOn(read, "countAnnouncementRecipients");
      const list = vi.spyOn(read, "listAnnouncementRows");
      const catalog = vi.spyOn(read, "listAnnouncementFloors");
      await expect(
        query(actors[name]).getAnnouncements({ branchId: actors.branchId }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        query(actors[name]).previewAnnouncementAudience(preview()),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(count).not.toHaveBeenCalled();
      expect(list).not.toHaveBeenCalled();
      expect(catalog).not.toHaveBeenCalled();
    },
  );
  it("requires branch.announce and permits it without chat.lounge or booking.manage_all", async () => {
    await database.db
      .insert(roleSettings)
      .values({ branchId: actors.branchId, role: "operator", permissions: [] });
    const count = vi.spyOn(read, "countAnnouncementRecipients");
    const list = vi.spyOn(read, "listAnnouncementRows");
    const catalog = vi.spyOn(read, "listAnnouncementFloors");
    await expect(
      query().getAnnouncements({ branchId: actors.branchId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      query().previewAnnouncementAudience(preview()),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(count).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    expect(catalog).not.toHaveBeenCalled();
    await database.db
      .update(roleSettings)
      .set({ permissions: ["branch.announce"] })
      .where(eq(roleSettings.branchId, actors.branchId));
    await expect(
      query().previewAnnouncementAudience(preview()),
    ).resolves.toMatchObject({ recipientCount: 0 });
  });
  it("rejects out-of-window dates and cross-branch floor/space before recipient SQL", async () => {
    const count = vi.spyOn(read, "countAnnouncementRecipients");
    for (const audience of [
      { date: "2026-10-06", floorId: null, spaceId: null },
      { date: "2026-11-07", floorId: null, spaceId: null },
      { date: "2026-10-07", floorId: actors.otherFloorId, spaceId: null },
      {
        date: "2026-10-07",
        floorId: actors.floorId,
        spaceId: actors.otherSpaceId,
      },
      {
        date: "2026-10-07",
        floorId: actors.floorId,
        spaceId: actors.restrictedFloorSpaceId,
      },
    ])
      await expect(
        query().previewAnnouncementAudience({ ...preview(), audience }),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(count).not.toHaveBeenCalled();
  });
  it("unions bookers and current participants once, including ended bookings and excluding the operator", async () => {
    const first = await insertFixtureBooking(database, actors, {
      during: bookingRange("09:00", "10:00"),
    });
    const second = await insertFixtureBooking(database, actors, {
      userId: actors.member.userId,
      during: bookingRange("10:00", "11:00"),
    });
    await insertFixtureBooking(database, actors, {
      userId: actors.operator.userId,
      during: bookingRange("11:00", "12:00"),
    });
    await database.db.insert(bookingParticipants).values([
      {
        bookingId: first.id,
        userId: actors.member.userId,
        createdAt: bookingNow,
      },
      {
        bookingId: first.id,
        userId: actors.operator.userId,
        createdAt: bookingNow,
      },
      {
        bookingId: second.id,
        userId: actors.person.userId,
        createdAt: bookingNow,
      },
      {
        bookingId: second.id,
        userId: actors.admin.userId,
        createdAt: bookingNow,
      },
    ]);
    meter.start();
    expect(
      await read.announcementRecipients(recipientInput(), database.db),
    ).toEqual(
      [actors.person.userId, actors.member.userId, actors.admin.userId].sort(),
    );
    expect(meter.stop().perStage).toEqual([1]);
    expect(
      (await query().previewAnnouncementAudience(preview())).recipientCount,
    ).toBe(3);
    await database.db
      .delete(bookingParticipants)
      .where(eq(bookingParticipants.userId, actors.admin.userId));
    expect(
      await read.countAnnouncementRecipients(recipientInput(), database.db),
    ).toBe(2);
  });
  it("uses half-open day overlap and excludes cancelled and other-branch reservations", async () => {
    await insertFixtureBooking(database, actors, {
      userId: actors.admin.userId,
      during: {
        start: new Date("2026-10-06T14:00:00Z"),
        end: new Date("2026-10-06T15:00:00Z"),
      },
    });
    await insertFixtureBooking(database, actors, {
      userId: actors.person.userId,
      during: {
        start: new Date("2026-10-06T14:30:00Z"),
        end: new Date("2026-10-06T15:30:00Z"),
      },
      spaceId: actors.secondSpaceId,
    });
    await insertFixtureBooking(database, actors, {
      userId: actors.member.userId,
      during: {
        start: new Date("2026-10-07T14:30:00Z"),
        end: new Date("2026-10-07T15:30:00Z"),
      },
    });
    await insertFixtureBooking(database, actors, {
      userId: actors.stranger.userId,
      during: {
        start: new Date("2026-10-07T15:00:00Z"),
        end: new Date("2026-10-07T16:00:00Z"),
      },
      spaceId: actors.secondSpaceId,
    });
    await insertFixtureBooking(database, actors, {
      userId: actors.otherMember.userId,
      status: "cancelled",
      cancelledAt: bookingNow,
      cancelledBy: actors.otherMember.userId,
    });
    await insertFixtureBooking(database, actors, {
      userId: actors.otherOperator.userId,
      spaceId: actors.otherSpaceId,
    });
    expect(
      await read.announcementRecipients(recipientInput(), database.db),
    ).toEqual([actors.person.userId, actors.member.userId].sort());
  });
  it("scopes floors and desk areas, including each child seat and archived booked spaces", async () => {
    await insertFixtureBooking(database, actors, {
      userId: actors.person.userId,
      spaceId: actors.deskId,
    });
    await insertFixtureBooking(database, actors, {
      userId: actors.member.userId,
      spaceId: actors.otherDeskId,
    });
    await insertFixtureBooking(database, actors, {
      userId: actors.admin.userId,
      spaceId: actors.publicSpaceId,
    });
    await insertFixtureBooking(database, actors, {
      userId: actors.stranger.userId,
      spaceId: actors.restrictedFloorSpaceId,
    });
    await database.db
      .update(spaces)
      .set({ archivedAt: bookingNow })
      .where(eq(spaces.id, actors.publicSpaceId));
    const base = recipientInput();
    expect(
      await read.announcementRecipients(
        { ...base, floorId: actors.floorId },
        database.db,
      ),
    ).toEqual(
      [actors.person.userId, actors.member.userId, actors.admin.userId].sort(),
    );
    expect(
      await read.announcementRecipients(
        { ...base, floorId: actors.floorId, spaceId: actors.deskAreaId },
        database.db,
      ),
    ).toEqual([actors.person.userId, actors.member.userId].sort());
    expect(
      await read.announcementRecipients(
        { ...base, floorId: actors.floorId, spaceId: actors.deskId },
        database.db,
      ),
    ).toEqual([actors.person.userId]);
    expect(
      await read.announcementRecipients(
        { ...base, floorId: actors.floorId, spaceId: actors.publicSpaceId },
        database.db,
      ),
    ).toEqual([actors.admin.userId]);
  });
  it("returns zero without audience SQL when only the lounge is selected", async () => {
    await insertFixtureBooking(database, actors);
    const count = vi.spyOn(read, "countAnnouncementRecipients");
    meter.start();
    const result = await query().previewAnnouncementAudience({
      ...preview(),
      audience: null,
    });
    expect(meter.stop().perStage).toEqual([4, 1]);
    expect(count).not.toHaveBeenCalled();
    expect(result.recipientCount).toBe(0);
  });
  it("requires the exact unarchived admin-only text announcement channel without repairing it", async () => {
    expect(await read.loungeAvailability(scope(), database.db)).toMatchObject({
      available: false,
      reason: "missing_channel",
      memberCount: 0,
    });
    const room = await lounge();
    expect(await read.loungeAvailability(scope(), database.db)).toMatchObject({
      available: true,
      reason: null,
      ...room,
    });
    for (const change of [
      { name: "다른-공지" },
      { adminOnly: false },
      { archivedAt: bookingNow },
    ]) {
      await database.db
        .update(chatRooms)
        .set({ name: "공지", adminOnly: true, archivedAt: null, ...change })
        .where(eq(chatRooms.id, room.roomId));
      expect(await read.loungeAvailability(scope(), database.db)).toMatchObject(
        { available: false, reason: "missing_channel" },
      );
    }
    await database.db
      .update(chatRooms)
      .set({ archivedAt: null, kind: "voice", voiceCapacity: 10 })
      .where(eq(chatRooms.id, room.roomId));
    expect(await read.loungeAvailability(scope(), database.db)).toMatchObject({
      available: false,
      reason: "missing_channel",
    });
    expect(await database.db.select().from(chatSpaceMembers)).toHaveLength(0);
  });
  it("distinguishes banned membership and counts only active lounge members", async () => {
    const room = await lounge();
    await member(room.spaceId, actors.operator.userId, "banned");
    await member(room.spaceId, actors.person.userId);
    await member(room.spaceId, actors.member.userId, "banned");
    expect(await read.loungeAvailability(scope(), database.db)).toMatchObject({
      available: false,
      reason: "banned",
      memberCount: 1,
    });
    await database.db
      .update(chatSpaceMembers)
      .set({ status: "active" })
      .where(eq(chatSpaceMembers.userId, actors.operator.userId));
    expect(await read.loungeAvailability(scope(), database.db)).toMatchObject({
      available: true,
      reason: null,
      memberCount: 2,
    });
  });
  it("applies the 100 active branch/community limit only to a new lounge member", async () => {
    const room = await lounge();
    const communities = Array.from({ length: 100 }, (_, index) => ({
      id: crypto.randomUUID(),
      kind: "community" as const,
      name: `커뮤니티 ${index}`,
      createdBy: actors.operator.userId,
    }));
    await database.db.insert(chatSpaces).values(communities);
    await database.db.insert(chatSpaceMembers).values(
      communities.map(({ id }) => ({
        spaceId: id,
        userId: actors.operator.userId,
        joinedAt: bookingNow,
        statusChangedAt: bookingNow,
      })),
    );
    expect(await read.loungeAvailability(scope(), database.db)).toMatchObject({
      available: false,
      reason: "space_limit",
    });
    await member(room.spaceId);
    expect(await read.loungeAvailability(scope(), database.db)).toMatchObject({
      available: true,
      reason: null,
    });
    await database.db
      .delete(chatSpaceMembers)
      .where(eq(chatSpaceMembers.spaceId, room.spaceId));
    await database.db
      .update(chatSpaces)
      .set({ deletedAt: bookingNow })
      .where(eq(chatSpaces.id, communities[0]!.id));
    expect(await read.loungeAvailability(scope(), database.db)).toMatchObject({
      available: true,
      reason: null,
    });
  });
  it("returns a bounded public DTO and a branch-local recent history with stable ordering", async () => {
    const room = await lounge();
    await member(room.spaceId, actors.person.userId);
    const [message] = await database.db
      .insert(messages)
      .values({
        roomId: room.roomId,
        authorId: actors.operator.userId,
        body: "비공개 본문",
        seq: 1,
        clientId: crypto.randomUUID(),
      })
      .returning();
    const ids = [
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
    ];
    const common = {
      branchId: actors.branchId,
      authorId: actors.operator.userId,
      body: "비공개 본문",
    };
    await database.db.insert(announcements).values([
      {
        ...common,
        id: ids[0],
        title: "첫 공지",
        createdAt: bookingNow,
        loungeMessageId: message!.id,
        recipientCount: 1,
      },
      {
        ...common,
        id: ids[1],
        title: "둘째 공지",
        createdAt: bookingNow,
        audience: preview().audience,
        recipientCount: 3,
      },
      { ...common, title: "경계", createdAt: new Date("2026-09-06T15:00:00Z") },
      {
        ...common,
        title: "범위 밖",
        createdAt: new Date("2026-09-06T14:59:59Z"),
      },
      {
        ...common,
        title: "미래",
        createdAt: new Date(bookingNow.getTime() + 1),
      },
      {
        ...common,
        branchId: actors.otherBranchId,
        title: "다른 지점",
        createdAt: bookingNow,
      },
    ]);
    meter.start();
    const result = await query().getAnnouncements({
      branchId: actors.branchId,
    });
    expect(meter.stop().perStage).toEqual([5, 2]);
    expect(Object.keys(result).sort()).toEqual([
      "branch",
      "floors",
      "lounge",
      "maxDate",
      "now",
      "rows",
      "today",
    ]);
    expect(result).toMatchObject({
      branch: { id: actors.branchId, name: "강남점", timezone: "Asia/Seoul" },
      now: bookingNow.toISOString(),
      today: "2026-10-07",
      maxDate: "2026-11-06",
      lounge: { available: true, reason: null, memberCount: 1 },
    });
    expect(result.rows.map(({ title }) => title)).toEqual([
      "둘째 공지",
      "첫 공지",
      "경계",
    ]);
    expect(result.rows[0]).toEqual({
      id: ids[1],
      title: "둘째 공지",
      createdAt: bookingNow.toISOString(),
      lounge: false,
      audience: true,
      recipientCount: 3,
    });
    expect(result.rows[1]).toMatchObject({ lounge: true, audience: false });
    expect(result.floors.map(({ id }) => id)).toEqual([
      actors.floorId,
      actors.restrictedFloorId,
    ]);
    const json = JSON.stringify(result);
    for (const hidden of [
      "body",
      "authorId",
      "roomId",
      "operatorId",
      "email",
      "@example.test",
      "비공개 본문",
      actors.otherFloorId,
    ])
      expect(json).not.toContain(hidden);
    expect(Object.keys(result.lounge).sort()).toEqual([
      "available",
      "memberCount",
      "reason",
    ]);
    expect(
      result.floors[0]?.spaces.every(
        (space) => Object.keys(space).sort().join() === "id,name,type",
      ),
    ).toBe(true);
  });
  it("keeps one count SQL and the two-stage budget for over 500 recipients without exposing identities", async () => {
    const booking = await insertFixtureBooking(database, actors);
    const recipients = Array.from({ length: 501 }, (_, index) => ({
      id: crypto.randomUUID(),
      name: `참석자 ${index}`,
      email: `audience-${index}@example.test`,
      emailVerified: true,
    }));
    await database.db.insert(users).values(recipients);
    await database.db.insert(bookingParticipants).values(
      recipients.map(({ id }) => ({
        bookingId: booking.id,
        userId: id,
        createdAt: bookingNow,
      })),
    );
    meter.start();
    const result = await query().previewAnnouncementAudience(preview());
    expect(meter.stop().perStage).toEqual([4, 2]);
    expect(result).toEqual({
      branchId: actors.branchId,
      lounge: { available: false, reason: "missing_channel", memberCount: 0 },
      recipientCount: 502,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /@|참석자|userId|roomId|spaceId|body|title/,
    );
  });
  it("rechecks staff membership in second-stage recipient/history SQL", async () => {
    await insertFixtureBooking(database, actors);
    await database.db.insert(announcements).values({
      branchId: actors.branchId,
      authorId: actors.operator.userId,
      title: "공지",
      body: "내용",
      createdAt: bookingNow,
    });
    await database.db
      .delete(branchStaff)
      .where(eq(branchStaff.userId, actors.operator.userId));
    expect(
      await read.announcementRecipients(recipientInput(), database.db),
    ).toEqual([]);
    expect(
      await read.countAnnouncementRecipients(recipientInput(), database.db),
    ).toBe(0);
    expect(
      await read.listAnnouncementRows(
        {
          ...scope(),
          cutoff: new Date("2026-09-01T00:00:00Z"),
          now: bookingNow,
        },
        database.db,
      ),
    ).toEqual([]);
    expect(await read.loungeAvailability(scope(), database.db)).toMatchObject({
      available: false,
      memberCount: 0,
    });
    expect(await read.readAnnouncementBranch(scope(), database.db)).toBeNull();
    expect(await read.listAnnouncementFloors(scope(), database.db)).toEqual([]);
  });
});
