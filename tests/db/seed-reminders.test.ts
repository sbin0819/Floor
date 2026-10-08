import { eq, sql } from "drizzle-orm";
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
import { createReminderSchedule } from "@/features/notifications/builders";
import { createAuth, type AuthInstance } from "@/lib/auth/auth";
import * as notificationDal from "@/lib/dal/notifications";
import {
  bookingParticipants,
  bookings,
  branches,
  notifications,
  spaces,
  users,
} from "@/lib/db/schema";
import { createMemoryEmailSender } from "@/lib/email/memory";
import { loadSeedData } from "@/lib/seed/data";
import { loadSeedBookings2 } from "@/lib/seed/bookings-2";
import { runSeed } from "@/lib/seed/run-seed";
import { createTestDatabase, type TestDatabase } from "./helper";

const now = new Date("2026-10-07T03:00:00Z");
const data = loadSeedData();
const extras = loadSeedBookings2(data);
describe("future reminders for actual seeded time reservations", () => {
  let database: TestDatabase;
  let auth: AuthInstance;
  beforeAll(async () => {
    database = await createTestDatabase();
    auth = createAuth({
      db: database.db,
      email: createMemoryEmailSender(),
      secret: "seed-reminder-tests-at-least-thirty-two-bytes",
      baseUrl: "http://localhost:3000",
      rateLimit: { enabled: false },
    });
  });
  afterAll(async () => {
    await database?.client.close();
  });
  beforeEach(async () => {
    await database.db.execute(
      sql`TRUNCATE users, branches, auth_verifications CASCADE`,
    );
  });
  afterEach(() => vi.restoreAllMocks());
  const seed = () =>
    runSeed({ db: database.db, auth, now, resetPasswords: false });
  const read = () => database.db.select().from(notifications);
  it("creates only future time-booking reminders for each owner and participant, with expiry and no title", async () => {
    await seed();
    const expected: {
      userId: string;
      bookingId: string;
      scheduledFor: Date;
      expiresAt: Date;
    }[] = [];
    const participants = await database.db.select().from(bookingParticipants);
    const allBookings = await database.db
      .select({ booking: bookings, type: spaces.type })
      .from(bookings)
      .innerJoin(spaces, eq(bookings.spaceId, spaces.id));
    for (const { booking, type } of allBookings) {
      if (type === "desk" || booking.status !== "confirmed") continue;
      const recipients = [
        booking.userId,
        ...participants
          .filter(({ bookingId }) => bookingId === booking.id)
          .map(({ userId }) => userId),
      ];
      for (const recipient of recipients)
        for (const slot of createReminderSchedule(booking.during, now))
          expected.push({
            userId: recipient,
            bookingId: booking.id,
            scheduledFor: slot.scheduledFor,
            expiresAt: booking.during.end,
          });
    }
    const allNotifications = await read();
    const rows = allNotifications.filter(
      ({ type }) => type === "booking_reminder",
    );
    expect(
      allNotifications.filter(({ type }) => type !== "booking_reminder"),
    ).toEqual([
      expect.objectContaining({ type: "friend_request" }),
      expect.objectContaining({ type: "friend_request" }),
      expect.objectContaining({ type: "message_request" }),
    ]);
    expect(rows).toHaveLength(expected.length);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows).toEqual(
      expect.arrayContaining(
        expected.map((row) => expect.objectContaining(row)),
      ),
    );
    for (const row of rows) {
      expect(row.type).toBe("booking_reminder");
      expect(row.actorId).toBeNull();
      expect(row.scheduledFor > now).toBe(true);
      expect(row.data).not.toHaveProperty("title");
    }
  });
  it("has identical recipient/booking/time keys when the full seed is repeated", async () => {
    await seed();
    const keys = async () =>
      (await read())
        .map(
          ({ userId, bookingId, scheduledFor }) =>
            `${userId}/${bookingId}/${scheduledFor.toISOString()}`,
        )
        .sort();
    const before = await keys();
    await seed();
    expect(await keys()).toEqual(before);
  });
  it("does not create reminders for a skipped conflicting seed reservation", async () => {
    await seed();
    const id = extras.participants[1]!.bookingId;
    const [original] = await database.db
      .select()
      .from(bookings)
      .where(eq(bookings.id, id));
    await database.db.delete(bookings).where(eq(bookings.id, id));
    const foreignId = crypto.randomUUID();
    await database.db.insert(bookings).values({ ...original!, id: foreignId });
    expect((await seed()).skippedBookings).toBe(1);
    expect(
      (await read()).some(
        ({ bookingId }) => bookingId === id || bookingId === foreignId,
      ),
    ).toBe(false);
  });
  it("preserves read reminders when selecting an already-existing branch", async () => {
    await seed();
    const first = (await read())[0]!;
    await database.db
      .update(notifications)
      .set({ readAt: now })
      .where(eq(notifications.id, first.id));
    const before = await read();
    const branchId = data.branches.find(({ name }) => name === "홍대점")!.id;
    await runSeed({
      db: database.db,
      now,
      resetPasswords: false,
      branchIds: [branchId],
    });
    expect(await read()).toEqual(before);
  });
  it("rolls all seed data back when reminder insertion fails", async () => {
    vi.spyOn(notificationDal, "insertNotifications").mockRejectedValueOnce(
      new Error("private notification error"),
    );
    await expect(seed()).rejects.toThrow("되돌렸어요");
    expect(await database.db.select().from(users)).toEqual([]);
    expect(await database.db.select().from(branches)).toEqual([]);
    expect(await database.db.select().from(bookings)).toEqual([]);
    expect(await database.db.select().from(bookingParticipants)).toEqual([]);
    expect(await read()).toEqual([]);
  });
});
