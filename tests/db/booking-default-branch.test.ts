import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
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
import { createBookingActions } from "@/features/bookings/create-booking-factory";
import type { Session } from "@/lib/auth/types";
import * as defaultBranchDal from "@/lib/dal/booking-default-branch";
import { bookings, users } from "@/lib/db/schema";
import {
  bookingInput,
  bookingNow,
  insertFixtureBooking,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";

describe("default branch from a successful booking", () => {
  let database: TestDatabase;
  let fixture: BookingActors;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database?.client.close();
  });
  beforeEach(async () => {
    fixture = await seedBookingActors(database);
  });
  afterEach(() => vi.restoreAllMocks());
  const actions = (session: Session) =>
    createBookingActions({
      database: database.db,
      getSession: async () => session,
      now: () => bookingNow,
      logError: vi.fn(),
    });
  async function defaultBranch(session: Session) {
    const [row] = await database.db
      .select({ branchId: users.defaultBranchId })
      .from(users)
      .where(eq(users.id, session.userId));
    return row?.branchId;
  }

  it("fills only the session user's empty default after a personal booking", async () => {
    expect(
      await actions(fixture.person).createBooking(bookingInput(fixture)),
    ).toMatchObject({ ok: true });
    expect(await defaultBranch(fixture.person)).toBe(fixture.branchId);
    expect(await defaultBranch(fixture.stranger)).toBeNull();
  });
  it("fills the booking user's default even when booking for a team", async () => {
    expect(
      await actions(fixture.member).createBooking(
        bookingInput(fixture, {
          teamId: fixture.teamId,
          spaceId: fixture.restrictedSpaceId,
        }),
      ),
    ).toMatchObject({ ok: true });
    expect(await defaultBranch(fixture.member)).toBe(fixture.branchId);
    expect(await defaultBranch(fixture.admin)).toBeNull();
  });
  it("does not replace an existing default", async () => {
    await database.db
      .update(users)
      .set({ defaultBranchId: fixture.otherBranchId })
      .where(eq(users.id, fixture.person.userId));
    expect(
      await actions(fixture.person).createBooking(bookingInput(fixture)),
    ).toMatchObject({ ok: true });
    expect(await defaultBranch(fixture.person)).toBe(fixture.otherBranchId);
  });
  it("uses one conditional UPDATE with the NULL predicate", async () => {
    const statements: string[] = [];
    const measured = drizzle({
      client: database.client,
      logger: { logQuery: (query) => statements.push(query) },
    });
    await createBookingActions({
      database: measured,
      getSession: async () => fixture.person,
      now: () => bookingNow,
    }).createBooking(bookingInput(fixture));
    const updates = statements.filter((sql) =>
      /update "users" set "default_branch_id"/i.test(sql),
    );
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatch(/"users"\."default_branch_id" is null/i);
  });
  it("keeps the default empty when the reservation conflicts", async () => {
    await insertFixtureBooking(database, fixture);
    expect(
      await actions(fixture.person).createBooking(bookingInput(fixture)),
    ).toMatchObject({ ok: false, code: "BOOKING_CONFLICT" });
    expect(await defaultBranch(fixture.person)).toBeNull();
  });
  it("rolls back both the inserted reservation and default if the transaction fails afterwards", async () => {
    const original = defaultBranchDal.fillBookingDefaultBranch;
    vi.spyOn(
      defaultBranchDal,
      "fillBookingDefaultBranch",
    ).mockImplementationOnce(async (...args) => {
      await original(...args);
      throw new Error("Simulated post-update failure");
    });
    expect(
      await actions(fixture.person).createBooking(bookingInput(fixture)),
    ).toMatchObject({ ok: false, code: "INTERNAL" });
    expect(await database.db.select().from(bookings)).toHaveLength(0);
    expect(await defaultBranch(fixture.person)).toBeNull();
  });
});
