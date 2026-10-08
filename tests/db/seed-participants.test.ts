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
import { createAuth, type AuthInstance } from "@/lib/auth/auth";
import * as participantDal from "@/lib/dal/booking-participants";
import {
  bookingParticipants,
  bookings,
  branches,
  users,
} from "@/lib/db/schema";
import { createMemoryEmailSender } from "@/lib/email/memory";
import { loadSeedBookings2 } from "@/lib/seed/bookings-2";
import { loadSeedData } from "@/lib/seed/data";
import { loadSeedPhotos } from "@/lib/seed/photos";
import { runSeed } from "@/lib/seed/run-seed";
import { selectSeedBranches } from "@/lib/seed/scope";
import { createTestDatabase, type TestDatabase } from "./helper";

const data = loadSeedData();
const extras = loadSeedBookings2(data);
const now = new Date("2026-10-07T03:00:00Z");
describe("participant seed additions", () => {
  let database: TestDatabase;
  let auth: AuthInstance;
  beforeAll(async () => {
    database = await createTestDatabase();
    auth = createAuth({
      db: database.db,
      email: createMemoryEmailSender(),
      secret: "participant-seed-secret-with-at-least-32-bytes",
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
  const read = () =>
    database.db
      .select()
      .from(bookingParticipants)
      .orderBy(bookingParticipants.bookingId, bookingParticipants.userId);

  it("inserts the five declared participants and preserves their exact mapping on rerun", async () => {
    await seed();
    const accounts = await database.db.select().from(users);
    const expected = extras.participants.flatMap(({ bookingId, userKeys }) =>
      userKeys.map((key) => ({
        bookingId,
        createdAt: now,
        userId: accounts.find(
          ({ email }) =>
            email === data.users.find((user) => user.key === key)!.email,
        )!.id,
      })),
    );
    expect(await read()).toEqual(expect.arrayContaining(expected));
    expect(await read()).toHaveLength(5);
    const before = await read();
    await seed();
    expect(await read()).toEqual(before);
  });

  it("skips participants for a time booking skipped due to a foreign overlap", async () => {
    await seed();
    const id = extras.participants[0]!.bookingId;
    const [original] = await database.db
      .select()
      .from(bookings)
      .where(eq(bookings.id, id));
    await database.db.delete(bookings).where(eq(bookings.id, id));
    const foreignId = crypto.randomUUID();
    await database.db.insert(bookings).values({ ...original!, id: foreignId });
    const result = await seed();
    expect(result.skippedBookings).toBe(1);
    expect(await read()).toHaveLength(3);
    expect((await read()).some(({ bookingId }) => bookingId === id)).toBe(
      false,
    );
    expect(
      await database.db
        .select()
        .from(bookings)
        .where(eq(bookings.id, foreignId)),
    ).toHaveLength(1);
  });

  it("leaves an existing branch's removed participant and other data alone", async () => {
    await seed();
    await database.db
      .delete(bookingParticipants)
      .where(
        eq(bookingParticipants.bookingId, extras.participants[0]!.bookingId),
      );
    const before = await read();
    const branchId = data.branches.find(({ name }) => name === "강남점")!.id;
    await runSeed({
      db: database.db,
      now,
      resetPasswords: false,
      branchIds: [branchId],
    });
    expect(await read()).toEqual(before);
  });

  it("rolls the complete seed back if participant insertion fails", async () => {
    vi.spyOn(participantDal, "insertBookingParticipants").mockRejectedValueOnce(
      new Error("private participant failure"),
    );
    await expect(seed()).rejects.toThrow("되돌렸어요");
    expect(await database.db.select().from(users)).toEqual([]);
    expect(await database.db.select().from(branches)).toEqual([]);
    expect(await database.db.select().from(bookings)).toEqual([]);
    expect(await read()).toEqual([]);
  });

  it("includes participant-only accounts in the selected branch's required users", () => {
    const fixture = structuredClone(data);
    fixture.users.push({
      ...fixture.users[0]!,
      key: "guest-only",
      email: "guest-only@floor.test",
    });
    const selectedExtras = structuredClone(extras);
    selectedExtras.participants[0]!.userKeys.push("guest-only");
    const branch = fixture.branches.find(({ name }) => name === "강남점")!;
    const scope = selectSeedBranches(
      fixture,
      loadSeedPhotos(data),
      [branch.id],
      selectedExtras,
    );
    expect(scope.data.users.some(({ key }) => key === "guest-only")).toBe(true);
  });
});
