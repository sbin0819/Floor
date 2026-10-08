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
import { createBookingQueries } from "@/features/bookings/query-factory";
import { ActionError } from "@/lib/actions/result";
import * as bookingDal from "@/lib/dal/bookings";
import {
  bookingNow,
  insertFixtureBooking,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";
import { createQueryMeter } from "./query-meter";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("progressive booking queries", () => {
  let database: TestDatabase;
  let actors: BookingActors;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  beforeEach(async () => {
    actors = await seedBookingActors(database);
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await database?.client.close();
  });
  const query = () =>
    createBookingQueries({
      database: database.db,
      requireSession: async () => actors.member,
      now: () => bookingNow,
    });

  it("returns timezone and real month before bookings, with one session and clock read", async () => {
    const pending =
      deferred<
        Awaited<ReturnType<typeof bookingDal.listMyConfirmedBookingsBetween>>
      >();
    const read = vi
      .spyOn(bookingDal, "listMyConfirmedBookingsBetween")
      .mockReturnValue(pending.promise);
    const session = vi.fn(async () => actors.member);
    const now = vi.fn(() => bookingNow);
    const stream = await createBookingQueries({
      database: database.db,
      requireSession: session,
      now,
    }).getMyBookingsMonthStream({ month: "2026-11", day: "2026-11-05" });
    expect(stream.meta).toMatchObject({
      month: "2026-11",
      day: "2026-11-05",
      timezone: "Asia/Seoul",
    });
    expect(stream.meta).not.toHaveProperty("bookings");
    expect(session).toHaveBeenCalledOnce();
    expect(now).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledOnce();
    const consumed = vi.fn();
    void stream.bookings.then(consumed);
    await Promise.resolve();
    expect(consumed).not.toHaveBeenCalled();
    pending.resolve([]);
    expect(await stream.bookings).toEqual([]);
  });

  it("returns accessible floors and operating hours before booking-date marks", async () => {
    const pending = deferred<string[]>();
    const read = vi
      .spyOn(bookingDal, "listMyBranchBookingDates")
      .mockReturnValue(pending.promise);
    const stream = await query().getBranchNavigationStream(actors.branchId);
    expect(stream.meta.branch.id).toBe(actors.branchId);
    expect(stream.meta.branch.openHours).toBeDefined();
    expect(
      stream.meta.floors.some((floor) => floor.id === actors.floorId),
    ).toBe(true);
    expect(stream.meta).not.toHaveProperty("bookingDates");
    expect(read).toHaveBeenCalledOnce();
    pending.resolve(["2026-10-08"]);
    expect(await stream.bookingDates).toEqual(["2026-10-08"]);
  });

  it("does not convert a later data failure into an empty calendar", async () => {
    const pending =
      deferred<
        Awaited<ReturnType<typeof bookingDal.listMyConfirmedBookingsBetween>>
      >();
    vi.spyOn(bookingDal, "listMyConfirmedBookingsBetween").mockReturnValue(
      pending.promise,
    );
    const stream = await query().getMyBookingsMonthStream();
    const result = expect(stream.bookings).rejects.toThrow(
      "calendar read failed",
    );
    pending.reject(new Error("calendar read failed"));
    await result;
  });

  it("keeps the complete DTO contracts without changing booking filtering", async () => {
    await insertFixtureBooking(database, actors);
    const month = await query().getMyBookingsMonthStream();
    expect({ ...month.meta, bookings: await month.bookings }).toEqual(
      await query().getMyBookingsMonth(),
    );
    const navigation = await query().getBranchNavigationStream(actors.branchId);
    expect({
      ...navigation.meta,
      bookingDates: await navigation.bookingDates,
    }).toEqual(await query().getBranchNavigation(actors.branchId));
  });

  it("checks the session before metadata, clock, or SQL in both stream entry points", async () => {
    const read = vi.spyOn(database.client, "query");
    const now = vi.fn(() => bookingNow);
    const queries = createBookingQueries({
      database: database.db,
      requireSession: async () => {
        throw new ActionError("UNAUTHENTICATED");
      },
      now,
    });
    await expect(queries.getMyBookingsMonthStream()).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    await expect(
      queries.getBranchNavigationStream(actors.branchId),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(read).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
  });

  it("retains the SQL stage budgets while metadata and data are consumed separately", async () => {
    const meter = createQueryMeter(database.client);
    try {
      meter.start();
      const month = await query().getMyBookingsMonthStream();
      await month.bookings;
      expect(meter.stop().perStage).toEqual([1, 1]);
      meter.start();
      const navigation = await query().getBranchNavigationStream(
        actors.branchId,
      );
      await navigation.bookingDates;
      expect(meter.stop().perStage).toEqual([6, 1]);
    } finally {
      meter.restore();
    }
  });
});
