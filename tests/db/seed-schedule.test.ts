import { and, eq, inArray, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REMINDER_MINUTES } from "@/features/notifications/builders";
import { createAuth, type AuthInstance } from "@/lib/auth/auth";
import {
  announcements,
  bookingParticipants,
  bookings,
  chatRoomReads,
  chatRooms,
  chatSpaces,
  messages,
  notifications,
  reports,
  spaceBlocks,
  users,
} from "@/lib/db/schema";
import { createMemoryEmailSender } from "@/lib/email/memory";
import { loadSeedData } from "@/lib/seed/data";
import { runSeed } from "@/lib/seed/run-seed";
import { expandSeedSchedule, loadSeedSchedule } from "@/lib/seed/schedule";
import { loadSeedSpaces } from "@/lib/seed/spaces";
import { createTestDatabase, type TestDatabase } from "./helper";

const now = new Date("2026-11-05T05:00:00Z");
const data = loadSeedData();
const schedule = expandSeedSchedule(loadSeedSchedule(data), data, now);
const spaceChat = loadSeedSpaces(data);

describe("month-long schedule written by the seed", () => {
  let database: TestDatabase;
  let auth: AuthInstance;
  let userIds: Map<string, string>;
  beforeAll(async () => {
    database = await createTestDatabase();
    auth = createAuth({
      db: database.db,
      email: createMemoryEmailSender(),
      secret: "seed-schedule-tests-secret-at-least-32-bytes",
      baseUrl: "http://localhost:3000",
      rateLimit: { enabled: false },
    });
    await runSeed({ db: database.db, auth, now, resetPasswords: false });
    const rows = await database.db.select().from(users);
    userIds = new Map(
      data.users.map(({ key, email }) => [
        key,
        rows.find((row) => row.email === email)!.id,
      ]),
    );
  });
  afterAll(async () => {
    await database?.client.close();
  });
  const userId = (key: string) => userIds.get(key)!;

  it("stores every expanded booking with its owner, team, status, cancellation and attendee data", async () => {
    const rows = await database.db.select().from(bookings);
    expect(rows).toHaveLength(schedule.bookings.length);
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const booking of schedule.bookings) {
      expect(byId.get(booking.id)).toMatchObject({
        spaceId: booking.spaceId,
        userId: userId(booking.userKey),
        teamId: booking.teamId,
        title: booking.title,
        attendeeCount: booking.attendeeCount,
        status: booking.status,
        cancelledAt: booking.cancelledAt,
        cancelledBy: booking.cancelledByKey
          ? userId(booking.cancelledByKey)
          : null,
        cancelKind: booking.cancelKind,
        cancelReason: booking.cancelReason,
        createdAt: booking.createdAt,
      });
      expect(byId.get(booking.id)!.during).toEqual(booking.during);
    }
    const participants = await database.db.select().from(bookingParticipants);
    expect(participants).toHaveLength(
      schedule.bookings.reduce(
        (count, booking) => count + booking.participantKeys.length,
        0,
      ),
    );
    const blocks = await database.db.select().from(spaceBlocks);
    expect(blocks).toHaveLength(schedule.blocks.length);
    for (const block of schedule.blocks)
      expect(blocks.find(({ id }) => id === block.id)).toMatchObject({
        spaceId: block.spaceId,
        reason: block.reason,
        createdBy: userId(block.createdByKey),
        during: block.during,
      });
  });

  it("opens a meeting channel per time booking with ordered system and member messages and read cursors", async () => {
    const rooms = await database.db
      .select()
      .from(chatRooms)
      .where(eq(chatRooms.kind, "meeting"));
    const timeBookings = schedule.bookings.filter((row) => !row.isDesk);
    expect(rooms).toHaveLength(timeBookings.length);
    const roomByBooking = new Map(rooms.map((room) => [room.bookingId, room]));
    const allMessages = await database.db
      .select()
      .from(messages)
      .where(
        inArray(
          messages.roomId,
          rooms.map(({ id }) => id),
        ),
      );
    const reads = await database.db
      .select()
      .from(chatRoomReads)
      .where(
        inArray(
          chatRoomReads.roomId,
          rooms.map(({ id }) => id),
        ),
      );
    for (const booking of timeBookings) {
      const room = roomByBooking.get(booking.id)!;
      expect(room.createdAt).toEqual(booking.createdAt);
      const conversation = allMessages
        .filter(({ roomId }) => roomId === room.id)
        .sort((a, b) => a.seq - b.seq);
      const expectedLength =
        1 + booking.messages.length + (booking.status === "cancelled" ? 1 : 0);
      expect(conversation).toHaveLength(expectedLength);
      expect(conversation.map(({ seq }) => seq)).toEqual(
        conversation.map((_, index) => index + 1),
      );
      expect(room.lastSeq).toBe(expectedLength);
      expect(room.lastMessageAt).toEqual(conversation.at(-1)!.createdAt);
      expect(conversation[0]).toMatchObject({
        kind: "system",
        authorId: null,
        systemData: { type: "booking_created" },
        createdAt: booking.createdAt,
      });
      for (let index = 1; index < conversation.length; index += 1)
        expect(
          conversation[index]!.createdAt >= conversation[index - 1]!.createdAt,
        ).toBe(true);
      if (booking.status === "cancelled")
        expect(
          conversation.find(
            (row) => row.systemData?.type === "booking_cancelled",
          ),
        ).toMatchObject({
          createdAt: booking.cancelledAt,
          systemData: expect.objectContaining(
            booking.cancelKind
              ? { cancelKind: booking.cancelKind, reason: booking.cancelReason }
              : {},
          ),
        });
      // 예약한 사람은 자기가 만든 메시지를 읽은 상태다.
      expect(
        reads.find(
          (row) =>
            row.roomId === room.id && row.userId === userId(booking.userKey),
        )?.lastReadSeq,
      ).toBeGreaterThanOrEqual(1);
      for (const message of booking.messages) {
        const stored = conversation.find(
          (row) => row.body === message.body && row.kind === "text",
        )!;
        expect(stored).toMatchObject({
          authorId: userId(message.authorKey),
          createdAt: message.at,
        });
      }
    }
  });

  it("writes invitations, cancellations and only future reminders, marking anything older than three days as read", async () => {
    const rows = await database.db.select().from(notifications);
    const reminders = rows.filter(({ type }) => type === "booking_reminder");
    expect(reminders.length).toBeGreaterThan(0);
    for (const reminder of reminders) {
      expect(reminder.scheduledFor > now).toBe(true);
      expect(reminder.readAt).toBeNull();
      const booking = schedule.bookings.find(
        ({ id }) => id === reminder.bookingId,
      )!;
      expect(booking.status).toBe("confirmed");
      expect(booking.isDesk).toBe(false);
      expect(
        REMINDER_MINUTES.map(
          (minutes) => booking.during.start.getTime() - minutes * 60_000,
        ),
      ).toContain(reminder.scheduledFor.getTime());
    }
    const invited = rows.filter(({ type }) => type === "booking_invited");
    expect(invited).toHaveLength(
      schedule.bookings.reduce(
        (count, booking) => count + booking.participantKeys.length,
        0,
      ),
    );
    for (const row of invited) {
      const booking = schedule.bookings.find(({ id }) => id === row.bookingId)!;
      expect(row.scheduledFor).toEqual(booking.createdAt);
      expect(row.actorId).toBe(userId(booking.userKey));
      expect(booking.participantKeys.map(userId)).toContain(row.userId);
    }
    const cancelled = rows.filter(({ type }) => type === "booking_cancelled");
    const maintenance = schedule.bookings.filter(
      (row) => row.cancelKind === "maintenance",
    );
    expect(maintenance.length).toBeGreaterThan(0);
    for (const booking of maintenance) {
      const mine = cancelled.filter((row) => row.bookingId === booking.id);
      expect(mine.map(({ userId }) => userId).sort()).toEqual(
        [
          userId(booking.userKey),
          ...booking.participantKeys.map(userId),
        ].sort(),
      );
      for (const row of mine)
        expect(row.data).toMatchObject({
          cancelKind: "maintenance",
          cancelReason: booking.cancelReason,
        });
    }
    // 자기가 취소한 예약은 자기에게 알리지 않는다.
    for (const booking of schedule.bookings.filter(
      (row) => row.status === "cancelled" && row.cancelledByKey === row.userKey,
    ))
      expect(
        cancelled.some(
          (row) =>
            row.bookingId === booking.id &&
            row.userId === userId(booking.userKey),
        ),
      ).toBe(false);
    for (const row of rows.filter(({ type }) => type !== "booking_reminder")) {
      const old = now.getTime() - row.scheduledFor.getTime() > 3 * 86_400_000;
      expect(row.readAt === null).toBe(!old);
      expect(row.scheduledFor <= now).toBe(true);
    }
  });

  it("posts each announcement in the branch's notice channel and notifies the audience", async () => {
    const rows = await database.db.select().from(announcements);
    expect(rows).toHaveLength(schedule.announcements.length);
    const lounges = await database.db
      .select({ branchId: chatSpaces.branchId, roomId: chatRooms.id })
      .from(chatRooms)
      .innerJoin(chatSpaces, eq(chatSpaces.id, chatRooms.spaceId))
      .where(and(eq(chatRooms.name, "공지"), eq(chatSpaces.kind, "branch")));
    for (const announcement of schedule.announcements) {
      const row = rows.find(({ id }) => id === announcement.id)!;
      expect(row).toMatchObject({
        branchId: announcement.branchId,
        authorId: userId(announcement.authorKey),
        title: announcement.title,
        body: announcement.body,
        audience: announcement.audience,
        recipientCount: announcement.recipientKeys.length,
        createdAt: announcement.at,
      });
      const [message] = await database.db
        .select()
        .from(messages)
        .where(eq(messages.id, row.loungeMessageId!));
      expect(message).toMatchObject({
        roomId: lounges.find(
          ({ branchId }) => branchId === announcement.branchId,
        )!.roomId,
        clientId: announcement.id,
        authorId: userId(announcement.authorKey),
        mentionsEveryone: true,
        body: `${announcement.title}\n\n${announcement.body}\n\n<@everyone>`,
        createdAt: announcement.at,
      });
      const notified = await database.db
        .select()
        .from(notifications)
        .where(eq(notifications.type, "branch_announcement"));
      expect(
        notified
          .filter(
            (row) =>
              (row.data as { announcementId: string }).announcementId ===
              announcement.id,
          )
          .map(({ userId }) => userId)
          .sort(),
      ).toEqual(announcement.recipientKeys.map(userId).sort());
    }
    const noticeRooms = await database.db
      .select()
      .from(chatRooms)
      .where(
        inArray(
          chatRooms.id,
          lounges.map(({ roomId }) => roomId),
        ),
      );
    for (const room of noticeRooms) {
      const posted = await database.db
        .select()
        .from(messages)
        .where(eq(messages.roomId, room.id));
      expect(room.lastSeq).toBe(Math.max(0, ...posted.map(({ seq }) => seq)));
    }
  });

  it("keeps the spam report open against the seeded lounge message", async () => {
    const open = await database.db
      .select()
      .from(reports)
      .where(isNull(reports.resolvedAt));
    const report = spaceChat.loungeReports[0]!;
    expect(open).toHaveLength(report.reporterKeys.length);
    const [message] = await database.db
      .select()
      .from(messages)
      .where(eq(messages.id, open[0]!.messageId!));
    expect(message!.body).toContain("코인 리딩방");
    expect(new Set(open.map(({ reporterId }) => reporterId))).toEqual(
      new Set(report.reporterKeys.map(userId)),
    );
    expect(open.every((row) => row.targetUserId === message!.authorId)).toBe(
      true,
    );
    expect(open.every((row) => row.reason === "spam")).toBe(true);
  });
});
