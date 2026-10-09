import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createAnnouncementActionFactory } from "@/features/admin/announcement-action-factory";
import { createChatActions } from "@/features/chat/action-factory";
import * as sendCore from "@/features/chat/send-message-core";
import { createSpaceActions } from "@/features/chat/space-action-factory";
import { createNotificationQueries } from "@/features/notifications/query-factory";
import type { Session } from "@/lib/auth/types";
import * as write from "@/lib/dal/announcement-write";
import * as notificationDal from "@/lib/dal/notifications";
import { createBranchLounge } from "@/lib/dal/chat-write";
import { canReactRoom, canWriteRoom } from "@/lib/dal/chat-access";
import * as schema from "@/lib/db/schema";
import {
  announcements,
  bookingParticipants,
  branches,
  branchStaff,
  chatRooms,
  chatRoomReads,
  chatSpaceMembers,
  chatSpaces,
  messages,
  notifications,
  roleSettings,
  users,
} from "@/lib/db/schema";
import { permissionKeys } from "@/lib/permissions/keys";
import { userChannel } from "@/lib/realtime/channels";
import type { RealtimeItem } from "@/lib/realtime/types";
import {
  bookingDate,
  bookingNow,
  bookingRange,
  insertFixtureBooking,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";
import { countSqlStatements } from "./query-meter";

describe("atomic branch announcement actions", () => {
  let database: TestDatabase;
  let fixture: BookingActors;
  let loungeId: string;
  let roomId: string;
  let db: TestDatabase["db"];
  const queries: { query: string; params: unknown[] }[] = [];
  const publish = vi.fn(async () => {});
  const publishMany = vi.fn<(items: RealtimeItem[]) => Promise<void>>(
    async () => {},
  );
  const logError = vi.fn();
  beforeAll(async () => {
    database = await createTestDatabase();
    db = drizzle({
      client: database.client,
      schema,
      logger: {
        logQuery(query, params) {
          queries.push({ query, params });
        },
      },
    });
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    publishMany.mockImplementation(async () => {});
    logError.mockImplementation(() => {});
    fixture = await seedBookingActors(database);
    loungeId = (await createBranchLounge(fixture.branchId, db)).spaceId;
    const [room] = await db
      .select({ id: chatRooms.id })
      .from(chatRooms)
      .where(and(eq(chatRooms.spaceId, loungeId), eq(chatRooms.name, "공지")));
    roomId = room!.id;
    queries.length = 0;
  });
  const deps = (session: Session | null = fixture.operator) => ({
    database: db,
    getSession: async () => session,
    now: () => bookingNow,
    publisher: { publish, publishMany },
    logError,
  });
  const audience = () => ({
    date: bookingDate,
    floorId: fixture.floorId,
    spaceId: null,
  });
  const input = () => ({
    branchId: fixture.branchId,
    title: "  점검 안내  ",
    body: "  내일 회의실을 점검해요.  ",
    lounge: true,
    audience: null,
  });
  const send = (overrides = {}, session: Session | null = fixture.operator) =>
    createAnnouncementActionFactory(deps(session)).sendAnnouncement({
      ...input(),
      ...overrides,
    });
  const allEvents = () => publishMany.mock.calls.flatMap(([items]) => items);
  async function bookRecipients() {
    const booking = await insertFixtureBooking(database, fixture);
    await db.insert(bookingParticipants).values([
      { bookingId: booking.id, userId: fixture.stranger.userId },
      { bookingId: booking.id, userId: fixture.operator.userId },
    ]);
    return booking;
  }
  async function counts() {
    return {
      announcements: (await db.select().from(announcements)).length,
      messages: (await db.select().from(messages)).length,
      notifications: (await db.select().from(notifications)).length,
      membership: (
        await db
          .select()
          .from(chatSpaceMembers)
          .where(eq(chatSpaceMembers.userId, fixture.operator.userId))
      ).length,
      reads: (await db.select().from(chatRoomReads)).length,
      roomSeq: (
        await db
          .select({ seq: chatRooms.lastSeq })
          .from(chatRooms)
          .where(eq(chatRooms.id, roomId))
      )[0]?.seq,
    };
  }
  async function expectEmpty() {
    expect(await counts()).toEqual({
      announcements: 0,
      messages: 0,
      notifications: 0,
      membership: 0,
      reads: 0,
      roomSeq: 0,
    });
    expect(publishMany).not.toHaveBeenCalled();
  }
  async function addMemberships(count: number) {
    const spaces = Array.from({ length: count }, (_, i) => ({
      id: crypto.randomUUID(),
      kind: "community" as const,
      name: `커뮤니티 ${i}`,
      createdBy: fixture.operator.userId,
    }));
    await db.insert(chatSpaces).values(spaces);
    await db.insert(chatSpaceMembers).values(
      spaces.map(({ id }) => ({
        spaceId: id,
        userId: fixture.operator.userId,
        role: "member" as const,
        joinedAt: bookingNow,
        statusChangedAt: bookingNow,
      })),
    );
  }
  async function seedDaily(
    count: number,
    createdAt = bookingNow,
    branchId = fixture.branchId,
  ) {
    await db.insert(announcements).values(
      Array.from({ length: count }, () => ({
        branchId,
        authorId: fixture.operator.userId,
        title: "이전 공지",
        body: "내용",
        audience: audience(),
        createdAt,
      })),
    );
  }

  it("posts an everyone message, joins only the existing lounge and publishes normal chat events", async () => {
    await db.insert(chatSpaceMembers).values({
      spaceId: loungeId,
      userId: fixture.person.userId,
      joinedAt: bookingNow,
      statusChangedAt: bookingNow,
    });
    const result = await send();
    expect(result).toEqual({
      ok: true,
      data: { announcementId: expect.any(String), recipientCount: 0 },
    });
    if (!result.ok) throw new Error(result.code);
    const [announcement] = await db.select().from(announcements);
    const [message] = await db.select().from(messages);
    expect(announcement).toMatchObject({
      id: result.data.announcementId,
      branchId: fixture.branchId,
      authorId: fixture.operator.userId,
      title: "점검 안내",
      body: "내일 회의실을 점검해요.",
      audience: null,
      recipientCount: 0,
      loungeMessageId: message!.id,
      createdAt: bookingNow,
    });
    expect(message).toMatchObject({
      roomId,
      clientId: announcement!.id,
      body: "점검 안내\n\n내일 회의실을 점검해요.\n\n<@everyone>",
      authorId: fixture.operator.userId,
      mentionsEveryone: true,
      seq: 1,
      createdAt: bookingNow,
    });
    expect((await db.select().from(chatRoomReads))[0]).toMatchObject({
      userId: fixture.operator.userId,
      lastReadSeq: 1,
    });
    expect(allEvents().map(({ event }) => event.type)).toEqual(
      expect.arrayContaining([
        "message.created",
        "room.activity",
        "mention.created",
        "realtime.reauth",
      ]),
    );
    expect(
      allEvents().find(({ event }) => event.type === "mention.created")
        ?.channel,
    ).toBe(userChannel(fixture.person.userId));
    expect(await db.select().from(notifications)).toEqual([]);
    expect(JSON.stringify(allEvents())).not.toContain("email");
  });
  it("sends only notifications without joining the lounge or touching a room", async () => {
    await bookRecipients();
    const result = await send({ lounge: false, audience: audience() });
    expect(result).toMatchObject({ ok: true, data: { recipientCount: 2 } });
    const rows = await db.select().from(notifications);
    expect(rows.map(({ userId }) => userId).sort()).toEqual(
      [fixture.person.userId, fixture.stranger.userId].sort(),
    );
    expect(rows[0]).toMatchObject({
      type: "branch_announcement",
      actorId: fixture.operator.userId,
      bookingId: null,
      expiresAt: null,
      scheduledFor: bookingNow,
      data: {
        branchName: "강남점",
        title: "점검 안내",
        body: "내일 회의실을 점검해요.",
        announcementId: expect.any(String),
      },
    });
    expect(Object.keys(rows[0]!.data).sort()).toEqual([
      "announcementId",
      "body",
      "branchName",
      "title",
    ]);
    expect(await counts()).toMatchObject({
      membership: 0,
      messages: 0,
      roomSeq: 0,
    });
    expect(allEvents()).toHaveLength(2);
    expect(
      allEvents().every(({ event }) => event.type === "notifications.changed"),
    ).toBe(true);
  });
  it("sends both destinations, includes ended bookings and excludes duplicate/self recipients", async () => {
    await bookRecipients();
    await insertFixtureBooking(database, fixture, {
      spaceId: fixture.secondSpaceId,
      during: bookingRange("09:00", "10:00"),
    });
    const result = await send({ audience: audience() });
    expect(result).toMatchObject({ ok: true, data: { recipientCount: 2 } });
    expect(await counts()).toMatchObject({
      announcements: 1,
      messages: 1,
      notifications: 2,
      membership: 1,
    });
    expect(
      allEvents().filter(({ event }) => event.type === "notifications.changed"),
    ).toHaveLength(2);
    const inbox = await createNotificationQueries({
      database: db,
      requireSession: async () => fixture.person,
      now: () => bookingNow,
    }).getNotifications();
    expect(inbox.items).toHaveLength(1);
    expect(inbox.items[0]).toMatchObject({
      type: "branch_announcement",
      href: null,
      read: false,
      data: {
        branchName: "강남점",
        title: "점검 안내",
        body: "내일 회의실을 점검해요.",
      },
    });
    expect(JSON.stringify(inbox)).not.toMatch(/email|recipientIds/);
  });
  it("delivers tomorrow's 7F announcement to its booker and attendee inboxes and the lounge", async () => {
    const booking = await insertFixtureBooking(database, fixture, {
      during: bookingRange("10:00", "11:00", "2026-10-08"),
    });
    await db
      .insert(bookingParticipants)
      .values({ bookingId: booking.id, userId: fixture.stranger.userId });
    await insertFixtureBooking(database, fixture, {
      userId: fixture.member.userId,
      spaceId: fixture.restrictedFloorSpaceId,
      during: bookingRange("10:00", "11:00", "2026-10-08"),
    });
    const result = await send({
      audience: { ...audience(), date: "2026-10-08" },
    });
    expect(result).toMatchObject({ ok: true, data: { recipientCount: 2 } });
    for (const session of [fixture.person, fixture.stranger]) {
      const inbox = await createNotificationQueries({
        database: db,
        requireSession: async () => session,
        now: () => bookingNow,
      }).getNotifications();
      expect(inbox.items).toHaveLength(1);
      expect(inbox.items[0]).toMatchObject({
        type: "branch_announcement",
        data: { title: "점검 안내", branchName: "강남점" },
      });
    }
    const otherFloor = await createNotificationQueries({
      database: db,
      requireSession: async () => fixture.member,
      now: () => bookingNow,
    }).getNotifications();
    expect(otherFloor.items).toEqual([]);
    expect((await db.select().from(messages))[0]).toMatchObject({
      roomId,
      mentionsEveryone: true,
    });
  });
  it("does not reauthorize an already active operator even at the joined-space cap", async () => {
    await addMemberships(99);
    await db.insert(chatSpaceMembers).values({
      spaceId: loungeId,
      userId: fixture.operator.userId,
      joinedAt: bookingNow,
      statusChangedAt: bookingNow,
    });
    expect((await send()).ok).toBe(true);
    expect(
      allEvents().some(({ event }) => event.type === "realtime.reauth"),
    ).toBe(false);
  });
  it("allows announce-only operators in admin-only lounge channels but does not loosen normal messages or reactions", async () => {
    await db.insert(roleSettings).values({
      branchId: fixture.branchId,
      role: "user",
      permissions: [],
      limits: {},
    });
    await db.insert(roleSettings).values({
      branchId: fixture.branchId,
      role: "operator",
      permissions: ["branch.announce"],
      limits: {},
    });
    expect((await send()).ok).toBe(true);
    const [general] = await db
      .select({ id: chatRooms.id })
      .from(chatRooms)
      .where(
        and(eq(chatRooms.spaceId, loungeId), eq(chatRooms.name, "라운지")),
      );
    expect(
      (await canWriteRoom(fixture.operator.userId, general!.id, db, bookingNow))
        .canWrite,
    ).toBe(false);
    expect(
      (await canReactRoom(fixture.operator.userId, roomId, db, bookingNow))
        .canReact,
    ).toBe(false);
    expect(
      (await canWriteRoom(fixture.operator.userId, roomId, db, bookingNow))
        .canWrite,
    ).toBe(true);
    await db.insert(chatSpaceMembers).values({
      spaceId: loungeId,
      userId: fixture.person.userId,
      joinedAt: bookingNow,
      statusChangedAt: bookingNow,
    });
    const ordinary = createChatActions(deps(fixture.person));
    expect(
      await ordinary.sendMessage({
        roomId,
        clientId: crypto.randomUUID(),
        body: "일반 멤버의 공지",
      }),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
  it("keeps ordinary lounge writers out of the announcement channel", async () => {
    await db.insert(chatSpaceMembers).values({
      spaceId: loungeId,
      userId: fixture.person.userId,
      joinedAt: bookingNow,
      statusChangedAt: bookingNow,
    });
    const [general] = await db
      .select({ id: chatRooms.id })
      .from(chatRooms)
      .where(
        and(eq(chatRooms.spaceId, loungeId), eq(chatRooms.name, "라운지")),
      );
    expect(
      (await canWriteRoom(fixture.person.userId, general!.id, db, bookingNow))
        .canWrite,
    ).toBe(true);
    expect(
      (await canWriteRoom(fixture.person.userId, roomId, db, bookingNow))
        .canWrite,
    ).toBe(false);
  });
  it.each([
    "missing",
    "archived",
    "renamed",
    "not-admin-only",
    "banned",
    "space-limit",
  ])("rejects unavailable lounge %s without partial writes", async (kind) => {
    if (kind === "missing")
      await db.delete(chatRooms).where(eq(chatRooms.id, roomId));
    if (kind === "archived")
      await db
        .update(chatRooms)
        .set({ archivedAt: bookingNow })
        .where(eq(chatRooms.id, roomId));
    if (kind === "renamed")
      await db
        .update(chatRooms)
        .set({ name: "지난 공지" })
        .where(eq(chatRooms.id, roomId));
    if (kind === "not-admin-only")
      await db
        .update(chatRooms)
        .set({ adminOnly: false })
        .where(eq(chatRooms.id, roomId));
    if (kind === "banned")
      await db.insert(chatSpaceMembers).values({
        spaceId: loungeId,
        userId: fixture.operator.userId,
        status: "banned",
        joinedAt: bookingNow,
        statusChangedAt: bookingNow,
      });
    if (kind === "space-limit") await addMemberships(100);
    const before = await counts();
    expect(await send()).toEqual({
      ok: false,
      code: "INVALID_INPUT",
      message: "lounge_unavailable",
    });
    expect(await counts()).toEqual(before);
    expect(publishMany).not.toHaveBeenCalled();
  });
  it("does not create a missing lounge as a side effect of announcement sending", async () => {
    await db.delete(chatRooms).where(eq(chatRooms.spaceId, loungeId));
    await db.delete(chatSpaces).where(eq(chatSpaces.id, loungeId));
    expect(await send()).toEqual({
      ok: false,
      code: "INVALID_INPUT",
      message: "lounge_unavailable",
    });
    expect(
      await db
        .select()
        .from(chatSpaces)
        .where(eq(chatSpaces.branchId, fixture.branchId)),
    ).toEqual([]);
  });
  it("preserves the original public joinLounge behavior", async () => {
    const result = await createSpaceActions(deps()).joinLounge({
      branchId: fixture.branchId,
    });
    expect(result).toEqual({ ok: true, data: { spaceId: loungeId } });
    expect((await send()).ok).toBe(true);
  });
  it("rejects unauthenticated input before validation or database access", async () => {
    expect(
      await createAnnouncementActionFactory(deps(null)).sendAnnouncement(null),
    ).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    expect(queries).toEqual([]);
  });
  it.each([
    { title: "" },
    { title: "가".repeat(61) },
    { body: "" },
    { body: "😀".repeat(501) },
    { title: "<@everyone>" },
    { body: "<@잘못된 토큰" },
    { title: "NUL\0" },
    { body: "NUL\0" },
    { lounge: false, audience: null },
    { actorId: crypto.randomUUID() },
    { audience: { date: "2026-02-30", floorId: null, spaceId: null } },
  ])("validates strict input before any transaction: %j", async (invalid) => {
    expect(await send(invalid)).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
    });
    expect(queries).toEqual([]);
  });
  it("accepts Unicode code-point limits and normalized uppercase IDs", async () => {
    expect(
      (
        await send({
          branchId: fixture.branchId.toUpperCase(),
          title: "😀".repeat(60),
          body: "😀".repeat(500),
        })
      ).ok,
    ).toBe(true);
  });
  it("hides foreign or missing branches and denies own staff without announce permission", async () => {
    expect(await send({}, fixture.person)).toMatchObject({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(await send({ branchId: fixture.otherBranchId })).toMatchObject({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(await send({ branchId: crypto.randomUUID() })).toMatchObject({
      ok: false,
      code: "NOT_FOUND",
    });
    await db.insert(roleSettings).values({
      branchId: fixture.branchId,
      role: "operator",
      permissions: permissionKeys.filter((key) => key !== "branch.announce"),
      limits: {},
    });
    expect(await send()).toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expectEmpty();
  });
  it.each([
    { date: "2026-10-06" },
    { date: "2026-11-07" },
    { floorId: "foreign" },
    { spaceId: "foreign" },
  ])("rejects out-of-window or out-of-scope audience %j", async (invalid) => {
    const target = { ...audience(), ...invalid };
    if (target.floorId === "foreign") target.floorId = fixture.otherFloorId;
    if (target.spaceId === "foreign") target.spaceId = fixture.otherSpaceId;
    expect(await send({ audience: target })).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
    });
    await expectEmpty();
  });
  it("rejects no recipients only when lounge is not selected", async () => {
    expect(await send({ lounge: false, audience: audience() })).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    });
    expect((await send({ audience: audience() })).ok).toBe(true);
  });
  it("enforces 20 per branch local day, including the twentieth, not previous day or other branch", async () => {
    await seedDaily(19);
    await seedDaily(20, new Date("2026-10-06T14:59:59Z"));
    await seedDaily(20, bookingNow, fixture.otherBranchId);
    expect((await send()).ok).toBe(true);
    expect(await send()).toEqual({
      ok: false,
      code: "LIMIT_EXCEEDED",
      message: "announce_daily",
    });
    expect((await counts()).messages).toBe(1);
  });
  it("uses branch-local midnight instead of host or UTC midnight for the daily limit", async () => {
    await db
      .update(branches)
      .set({ timezone: "America/Los_Angeles" })
      .where(eq(branches.id, fixture.branchId));
    await seedDaily(19, new Date("2026-10-06T07:00:00Z"));
    await seedDaily(20, new Date("2026-10-06T06:59:59Z"));
    expect((await send()).ok).toBe(true);
    expect(await send()).toEqual({
      ok: false,
      code: "LIMIT_EXCEEDED",
      message: "announce_daily",
    });
  });
  it("permits only one final daily slot when two action calls are dispatched together", async () => {
    await seedDaily(19);
    const results = await Promise.all([send(), send()]);
    expect(results.filter(({ ok }) => ok)).toHaveLength(1);
    expect(results.find(({ ok }) => !ok)).toEqual({
      ok: false,
      code: "LIMIT_EXCEEDED",
      message: "announce_daily",
    });
    expect((await counts()).announcements).toBe(20);
  });
  it("captures the injected clock once only after acquiring the branch advisory lock", async () => {
    const now = vi.fn(() => bookingNow);
    const original = write.lockAnnouncementBranch;
    vi.spyOn(write, "lockAnnouncementBranch").mockImplementationOnce(
      async (...args) => {
        expect(now).not.toHaveBeenCalled();
        await original(...args);
      },
    );
    expect(
      (
        await createAnnouncementActionFactory({
          ...deps(),
          now,
        }).sendAnnouncement(input())
      ).ok,
    ).toBe(true);
    expect(now).toHaveBeenCalledTimes(1);
  });
  it("stops before any write if a referenced user cannot be locked", async () => {
    vi.spyOn(write, "lockAnnouncementUsers").mockResolvedValueOnce(false);
    expect(await send()).toEqual({ ok: false, code: "STALE" });
    await expectEmpty();
  });
  it.each([500, 501])(
    "accepts 500 recipients and rejects 501: %i",
    async (recipientCount) => {
      const booking = await insertFixtureBooking(database, fixture);
      const recipients = Array.from({ length: recipientCount - 1 }, (_, i) => ({
        id: crypto.randomUUID(),
        name: `받는 사람 ${i}`,
        email: `recipient-${i}@example.test`,
      }));
      await db.insert(users).values(recipients);
      await db
        .insert(bookingParticipants)
        .values(
          recipients.map(({ id }) => ({ bookingId: booking.id, userId: id })),
        );
      const result = await send({ lounge: false, audience: audience() });
      if (recipientCount === 500) {
        expect(result).toMatchObject({
          ok: true,
          data: { recipientCount: 500 },
        });
        expect((await counts()).notifications).toBe(500);
        expect(
          queries.filter(({ query }) =>
            query.startsWith('insert into "notifications"'),
          ),
        ).toHaveLength(1);
      } else {
        expect(result).toEqual({
          ok: false,
          code: "LIMIT_EXCEEDED",
          message: "announce_recipients",
        });
        await expectEmpty();
      }
    },
  );
  it.each(["staff", "permission"])(
    "rechecks %s after acquiring users, not a request cache",
    async (change) => {
      const original = write.lockAnnouncementUsers;
      vi.spyOn(write, "lockAnnouncementUsers").mockImplementationOnce(
        async (...args) => {
          const locked = await original(...args);
          const tx = args[2];
          if (change === "staff")
            await tx
              .delete(branchStaff)
              .where(eq(branchStaff.userId, fixture.operator.userId));
          else
            await tx.insert(roleSettings).values({
              branchId: fixture.branchId,
              role: "operator",
              permissions: [],
              limits: {},
            });
          return locked;
        },
      );
      expect(await send()).toMatchObject({
        ok: false,
        code: change === "staff" ? "NOT_FOUND" : "FORBIDDEN",
      });
      await expectEmpty();
    },
  );
  it.each(["archive", "ban"])(
    "rechecks lounge %s after initial availability",
    async (change) => {
      const original = write.lockAnnouncementUsers;
      vi.spyOn(write, "lockAnnouncementUsers").mockImplementationOnce(
        async (...args) => {
          const locked = await original(...args);
          if (change === "archive")
            await args[2]
              .update(chatRooms)
              .set({ archivedAt: bookingNow })
              .where(eq(chatRooms.id, roomId));
          else
            await args[2].insert(chatSpaceMembers).values({
              spaceId: loungeId,
              userId: fixture.operator.userId,
              status: "banned",
              joinedAt: bookingNow,
              statusChangedAt: bookingNow,
            });
          return locked;
        },
      );
      expect(await send()).toEqual({
        ok: false,
        code: "INVALID_INPUT",
        message: "lounge_unavailable",
      });
      await expectEmpty();
    },
  );
  it("rechecks join capacity after acquiring the operator lock", async () => {
    const original = write.lockAnnouncementUsers;
    vi.spyOn(write, "lockAnnouncementUsers").mockImplementationOnce(
      async (...args) => {
        const locked = await original(...args);
        const spaces = Array.from({ length: 100 }, (_, i) => ({
          id: crypto.randomUUID(),
          kind: "community" as const,
          name: `직전 참여 ${i}`,
          createdBy: fixture.operator.userId,
        }));
        await args[2].insert(chatSpaces).values(spaces);
        await args[2].insert(chatSpaceMembers).values(
          spaces.map(({ id }) => ({
            spaceId: id,
            userId: fixture.operator.userId,
            joinedAt: bookingNow,
            statusChangedAt: bookingNow,
          })),
        );
        return locked;
      },
    );
    expect(await send()).toEqual({
      ok: false,
      code: "INVALID_INPUT",
      message: "lounge_unavailable",
    });
    await expectEmpty();
  });
  it.each(["message", "notification", "announcement"])(
    "rolls back membership, cursor, message, notifications and announcement on late %s failure",
    async (stage) => {
      await bookRecipients();
      if (stage === "message")
        vi.spyOn(sendCore, "sendLockedMessage").mockRejectedValueOnce(
          new Error("private failure"),
        );
      if (stage === "notification")
        vi.spyOn(notificationDal, "insertNotifications").mockRejectedValueOnce(
          new Error("private failure"),
        );
      if (stage === "announcement")
        vi.spyOn(write, "insertAnnouncement").mockRejectedValueOnce(
          new Error("private failure"),
        );
      expect(await send({ audience: audience() })).toEqual({
        ok: false,
        code: "INTERNAL",
      });
      await expectEmpty();
      expect(logError).toHaveBeenCalledWith("Announcement operation failed.");
    },
  );
  it("keeps success if one event category and even logging fail while attempting all categories", async () => {
    await bookRecipients();
    publishMany.mockImplementation(async (items) => {
      if (items.some(({ event }) => event.type === "message.created"))
        throw new Error("private publish failure");
    });
    logError.mockImplementation(() => {
      throw new Error("private logger failure");
    });
    expect(await send({ audience: audience() })).toMatchObject({
      ok: true,
      data: { recipientCount: 2 },
    });
    expect(await counts()).toMatchObject({
      announcements: 1,
      messages: 1,
      notifications: 2,
      membership: 1,
    });
    expect(allEvents().map(({ event }) => event.type)).toEqual(
      expect.arrayContaining([
        "message.created",
        "realtime.reauth",
        "notifications.changed",
      ]),
    );
  });
  it("locks branch first, users once in UUID order, then space/room before inserts", async () => {
    await bookRecipients();
    queries.length = 0;
    expect((await send({ audience: audience() })).ok).toBe(true);
    const statements = queries.filter(
      ({ query }) => !/^(begin|commit)$/i.test(query),
    );
    expect(statements[0]?.query).toContain("pg_advisory_xact_lock");
    const lockIndex = statements.findIndex(({ query }) =>
      query.includes("with requested as materialized"),
    );
    const userLocks = statements.filter(({ query }) =>
      query.includes("with requested as materialized"),
    );
    expect(userLocks).toHaveLength(1);
    const lock = userLocks[0]!;
    expect(countSqlStatements(lock.query)).toBe(1);
    expect(lock.query).toMatch(
      /then \(select u.id from users u where u.id = requested.id for update\)/,
    );
    expect(lock.query).toMatch(
      /else \(select u.id from users u where u.id = requested.id for key share\)/,
    );
    expect(lock.params.slice(0, -1)).toEqual(
      [
        fixture.operator.userId,
        fixture.person.userId,
        fixture.stranger.userId,
      ].sort(),
    );
    const spaceIndex = statements.findIndex(
      ({ query }) =>
        query.includes('from "chat_spaces"') && query.includes("for update"),
    );
    const roomIndex = statements.findIndex(
      ({ query }) =>
        query.includes('from "chat_rooms"') && query.includes("for update"),
    );
    const messageIndex = statements.findIndex(({ query }) =>
      query.startsWith('insert into "messages"'),
    );
    const notificationIndex = statements.findIndex(({ query }) =>
      query.startsWith('insert into "notifications"'),
    );
    const announcementIndex = statements.findIndex(({ query }) =>
      query.startsWith('insert into "announcements"'),
    );
    expect(lockIndex).toBeGreaterThan(0);
    expect(spaceIndex).toBeGreaterThan(lockIndex);
    expect(roomIndex).toBeGreaterThan(spaceIndex);
    expect(messageIndex).toBeGreaterThan(roomIndex);
    expect(notificationIndex).toBeGreaterThan(messageIndex);
    expect(announcementIndex).toBeGreaterThan(notificationIndex);
  });
  it("executes mixed lock scalar subplans above the UUID sort without upgrading or duplicate IDs", async () => {
    const [lower, operator, upper] = [
      fixture.operator.userId,
      fixture.person.userId,
      fixture.stranger.userId,
    ].sort();
    expect(
      await write.lockAnnouncementUsers(
        operator!.toUpperCase(),
        [upper!, operator!, lower!, upper!],
        db,
      ),
    ).toBe(true);
    expect(queries).toHaveLength(1);
    const query = queries[0]!;
    const result = await database.client.query<{
      "QUERY PLAN": { Plan: PlanNode }[];
    }>(`explain (analyze, verbose, format json) ${query.query}`, query.params);
    const root = result.rows[0]!["QUERY PLAN"][0]!.Plan;
    const nodes = planNodes(root);
    const projection = nodes.find((node) =>
      node.Output?.some((line) => line.includes("CASE")),
    );
    expect(projection).toBeDefined();
    expect(["Result", "CTE Scan"]).toContain(projection!["Node Type"]);
    expect(projection!.Plans?.[0]?.["Node Type"]).toBe("Sort");
    const subplans = nodes.filter(
      (node) => node["Parent Relationship"] === "SubPlan",
    );
    expect(subplans.map((node) => node["Actual Loops"]).sort()).toEqual([1, 2]);
    expect(subplans.every((node) => node["Node Type"] === "LockRows")).toBe(
      true,
    );
    expect(
      await write.lockAnnouncementUsers(
        fixture.operator.userId,
        [crypto.randomUUID()],
        db,
      ),
    ).toBe(false);
  });
});

type PlanNode = {
  "Node Type": string;
  "Parent Relationship"?: string;
  "Actual Loops"?: number;
  Output?: string[];
  Plans?: PlanNode[];
};
function planNodes(node: PlanNode): PlanNode[] {
  return [node, ...(node.Plans ?? []).flatMap(planNodes)];
}
