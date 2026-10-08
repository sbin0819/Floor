import { eq } from "drizzle-orm";
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
import * as bookingDal from "@/lib/dal/bookings";
import { bookings, spaces } from "@/lib/db/schema";
import {
  bookingInput,
  bookingNow,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";

describe("booking attendee capacity", () => {
  let database: TestDatabase;
  let fixture: BookingActors;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    fixture = await seedBookingActors(database);
    await database.db
      .update(spaces)
      .set({ capacity: 6 })
      .where(eq(spaces.id, fixture.publicSpaceId));
  });
  afterEach(() => vi.restoreAllMocks());
  const create = (extra: Record<string, unknown> = {}) =>
    createBookingActions({
      database: database.db,
      getSession: async () => fixture.person,
      now: () => bookingNow,
      logError: vi.fn(),
    }).createBooking({ ...bookingInput(fixture), ...extra });

  it.each([undefined, null, 6])(
    "persists the optional count %s without changing quota",
    async (attendeeCount) => {
      expect(await create({ attendeeCount })).toMatchObject({ ok: true });
      expect(await database.db.select().from(bookings)).toMatchObject([
        { attendeeCount: attendeeCount ?? null },
      ]);
    },
  );
  it("rejects above the space capacity without a write", async () => {
    expect(await create({ attendeeCount: 7 })).toEqual({
      ok: false,
      code: "OVER_CAPACITY",
      message: "attendee_count",
    });
    expect(await database.db.select().from(bookings)).toEqual([]);
  });
  it.each([0, -1, 1.5, 501])(
    "rejects invalid count %s",
    async (attendeeCount) => {
      expect(await create({ attendeeCount })).toMatchObject({
        ok: false,
        code: "INVALID_INPUT",
      });
      expect(await database.db.select().from(bookings)).toEqual([]);
    },
  );
  it("accepts 500 when there is no capacity", async () => {
    await database.db
      .update(spaces)
      .set({ capacity: null })
      .where(eq(spaces.id, fixture.publicSpaceId));
    expect(await create({ attendeeCount: 500 })).toMatchObject({ ok: true });
  });
  it("keeps access denial before the capacity error", async () => {
    expect(
      await create({ spaceId: fixture.closedSpaceId, attendeeCount: 500 }),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
  });
  it("keeps desk rejection before the capacity error", async () => {
    expect(
      await create({ spaceId: fixture.deskId, attendeeCount: 500 }),
    ).toEqual({ ok: false, code: "INVALID_INPUT" });
  });
  it("rechecks capacity after locking and rolls the entire transaction back", async () => {
    const lock = bookingDal.lockSpaceForBooking;
    vi.spyOn(bookingDal, "lockSpaceForBooking").mockImplementationOnce(
      async (id, tx) => {
        await tx.update(spaces).set({ capacity: 2 }).where(eq(spaces.id, id));
        return lock(id, tx);
      },
    );
    expect(await create({ attendeeCount: 3 })).toEqual({
      ok: false,
      code: "OVER_CAPACITY",
      message: "attendee_count",
    });
    expect(await database.db.select().from(bookings)).toEqual([]);
    const [space] = await database.db
      .select()
      .from(spaces)
      .where(eq(spaces.id, fixture.publicSpaceId));
    expect(space!.capacity).toBe(6);
  });
});
