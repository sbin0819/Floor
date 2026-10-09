import { eq } from "drizzle-orm";
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
import { createBookingActions } from "@/features/bookings/create-booking-factory";
import { createCancelBookingAction } from "@/features/bookings/cancel-booking-factory";
import { createUpdateBookingAction } from "@/features/bookings/update-booking-factory";
import { createLeaveBookingAction } from "@/features/bookings/leave-booking-factory";
import { createAdminActions } from "@/features/admin/manage-factory";
import { publishBookingChange } from "@/features/bookings/action-factory";
import { publishAdminSpaceChange } from "@/features/admin/action-factory";
import type { Session } from "@/lib/auth/types";
import { noopRealtime } from "@/lib/realtime/noop";
import type { RealtimePublisher } from "@/lib/realtime/types";
import * as schema from "@/lib/db/schema";
import { bookingParticipants, bookings, spaces } from "@/lib/db/schema";
import {
  bookingInput,
  bookingNow,
  insertFixtureBooking,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";

const realtime = vi.hoisted(() => ({
  publish: vi.fn<RealtimePublisher["publish"]>(),
  publishMany: vi.fn<RealtimePublisher["publishMany"]>(),
  get: vi.fn(),
}));
vi.mock("@/lib/realtime/server", () => ({
  getRealtimePublisher: () => {
    realtime.get();
    return realtime;
  },
}));

describe("floor events use the production publisher after committed mutations", () => {
  let database: TestDatabase;
  let actors: BookingActors;
  const statements: string[] = [];
  beforeAll(async () => {
    database = await createTestDatabase();
    database.db = drizzle({
      client: database.client,
      schema,
      logger: {
        logQuery: (query) => statements.push(query),
      },
    });
  });
  afterAll(async () => database.client.close());
  beforeEach(async () => {
    actors = await seedBookingActors(database);
    statements.length = 0;
    vi.clearAllMocks();
    realtime.publish.mockImplementation(async () => {
      expect(statements).toContain("commit");
      expect(statements.filter((query) => query === "begin").length).toBe(
        statements.filter((query) => query === "commit").length,
      );
    });
  });
  const dependencies = (session: Session = actors.person) => ({
    database: database.db,
    getSession: async () => session,
    now: () => bookingNow,
    chatPublisher: noopRealtime,
    livekit: null,
    logError: vi.fn(),
  });
  const expectChange = (type = "booking.changed") => {
    expect(realtime.get).toHaveBeenCalledTimes(1);
    expect(realtime.publish).toHaveBeenCalledExactlyOnceWith(
      `floor:${actors.floorId}`,
      { type, spaceId: actors.publicSpaceId },
    );
  };

  it("publishes one create event without injecting a floor publisher", async () => {
    const result = await createBookingActions(dependencies()).createBooking(
      bookingInput(actors),
    );
    expect(result.ok).toBe(true);
    expectChange();
    expect(await database.db.select().from(bookings)).toHaveLength(1);
  });
  it("publishes cancellation once and not again for an already cancelled reservation", async () => {
    const row = await insertFixtureBooking(database, actors);
    const cancel = createCancelBookingAction(dependencies());
    expect((await cancel({ bookingId: row.id })).ok).toBe(true);
    expect(await cancel({ bookingId: row.id })).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expectChange();
    expect((await database.db.select().from(bookings))[0]?.status).toBe(
      "cancelled",
    );
  });
  it("publishes a title update once after its conditional update commits", async () => {
    const row = await insertFixtureBooking(database, actors);
    const result = await createUpdateBookingAction(dependencies())({
      bookingId: row.id,
      start: row.during.start.toISOString(),
      end: row.during.end.toISOString(),
      title: "수정한 제목",
      attendeeCount: null,
      participants: [],
      participantIdsAtLoad: [],
    });
    expect(result.ok).toBe(true);
    expectChange();
    expect((await database.db.select().from(bookings))[0]?.title).toBe(
      "수정한 제목",
    );
  });
  it("publishes a participant leaving once and not for the second attempt", async () => {
    const row = await insertFixtureBooking(database, actors);
    await database.db
      .insert(bookingParticipants)
      .values({ bookingId: row.id, userId: actors.stranger.userId });
    const leave = createLeaveBookingAction(dependencies(actors.stranger));
    expect((await leave({ bookingId: row.id })).ok).toBe(true);
    expect(await leave({ bookingId: row.id })).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expectChange();
    expect(await database.db.select().from(bookingParticipants)).toEqual([]);
  });
  it("publishes the committed operator space update through the production publisher", async () => {
    const result = await createAdminActions(
      dependencies(actors.operator),
    ).updateSpace({
      spaceId: actors.publicSpaceId,
      name: "수정한 공간",
      capacity: 6,
      bookable: true,
      amenities: ["whiteboard"],
    });
    expect(result.ok).toBe(true);
    expectChange("space.status_changed");
    const [space] = await database.db
      .select()
      .from(spaces)
      .where(eq(spaces.id, actors.publicSpaceId));
    expect(space?.name).toBe("수정한 공간");
  });
  it("keeps a committed booking when the default publisher fails, without logging private errors", async () => {
    realtime.publish.mockRejectedValue(new Error("private Ably credential"));
    const options = dependencies();
    expect(
      (await createBookingActions(options).createBooking(bookingInput(actors)))
        .ok,
    ).toBe(true);
    expect(await database.db.select().from(bookings)).toHaveLength(1);
    expect(options.logError).toHaveBeenCalledExactlyOnceWith(
      "Booking realtime publication failed.",
    );
  });
  it("does not use the default publisher for denied or rolled back reservations", async () => {
    const result = await createBookingActions(dependencies()).createBooking(
      bookingInput(actors, { spaceId: actors.closedSpaceId }),
    );
    expect(result.ok).toBe(false);
    expect(realtime.get).not.toHaveBeenCalled();
    expect(realtime.publish).not.toHaveBeenCalled();
  });
  it("preserves explicit injected publishers for both floor event types", async () => {
    const publisher = {
      publish: vi
        .fn<RealtimePublisher["publish"]>()
        .mockResolvedValue(undefined),
    };
    await publishBookingChange(actors.floorId, actors.publicSpaceId, {
      publisher,
    });
    await publishAdminSpaceChange(actors.floorId, actors.publicSpaceId, {
      publisher,
    });
    expect(publisher.publish).toHaveBeenCalledTimes(2);
    expect(realtime.get).not.toHaveBeenCalled();
  });
});
