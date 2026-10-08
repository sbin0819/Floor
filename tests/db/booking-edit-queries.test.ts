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
import { createBookingQueries } from "@/features/bookings/query-factory";
import { maskParticipantEmail } from "@/features/bookings/participants";
import type { Session } from "@/lib/auth/types";
import * as photoDal from "@/lib/dal/photos";
import * as editDal from "@/lib/dal/booking-edit";
import {
  accessGrants,
  bookingParticipants,
  branches,
  floors,
  roleSettings,
  spaceBlocks,
  spacePhotos,
  spaces,
  teamMembers,
  teams,
  users,
} from "@/lib/db/schema";
import {
  bookingDate,
  bookingNow,
  bookingRange,
  insertFixtureBooking,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";
import { createQueryMeter } from "./query-meter";

describe("booking edit query", () => {
  let database: TestDatabase;
  let actors: BookingActors;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    actors = await seedBookingActors(database);
  });
  afterEach(() => vi.restoreAllMocks());
  const query = (session: Session = actors.person, now = bookingNow) =>
    createBookingQueries({
      database: database.db,
      requireSession: async () => session,
      now: () => now,
    });

  it("loads only the fixed owner edit fields, original date and authorized cover", async () => {
    const row = await insertFixtureBooking(database, actors, {
      title: "원래 제목",
      attendeeCount: 3,
    });
    await database.db.insert(spacePhotos).values({
      spaceId: actors.publicSpaceId,
      path: "/seed/photos/meeting.webp",
      alt: "회의실",
      sortOrder: 0,
    });
    const result = await query().getBookingForEdit(row.id.toUpperCase());
    expect(result.booking).toEqual({
      id: row.id,
      start: row.during.start.toISOString(),
      end: row.during.end.toISOString(),
      title: "원래 제목",
      attendeeCount: 3,
      started: true,
    });
    expect(result.space).toEqual({
      id: actors.publicSpaceId,
      type: "meeting_room",
      name: "회의실 B",
      capacity: 4,
      amenities: ["monitor"],
      photo: { path: "/seed/photos/meeting.webp", alt: "회의실" },
    });
    expect(result.actor).toMatchObject({
      teamId: null,
      name: "개인으로",
      remainingMinutes: 120,
    });
    expect(result.date).toBe(bookingDate);
    expect(result.now).toBe(bookingNow.toISOString());
    expect(result.participants).toEqual([]);
    expect(Object.keys(result.branch).sort()).toEqual([
      "id",
      "name",
      "openHours",
      "timezone",
    ]);
    expect(Object.keys(result.floor).sort()).toEqual(["id", "name"]);
  });

  it.each([
    "unknown",
    "invalid",
    "other",
    "invited",
    "desk",
    "ended",
    "cancelled",
    "archived",
  ] as const)(
    "rejects %s without fetching a photo or participant details",
    async (kind) => {
      const row = await insertFixtureBooking(database, actors, {
        ...(kind === "other" || kind === "invited"
          ? { userId: actors.stranger.userId }
          : {}),
        ...(kind === "desk" ? { spaceId: actors.deskId } : {}),
        ...(kind === "ended" ? { during: bookingRange("11:00", "12:00") } : {}),
        ...(kind === "cancelled"
          ? { status: "cancelled", cancelledAt: bookingNow }
          : {}),
        ...(kind === "archived" ? { spaceId: actors.archivedSpaceId } : {}),
      });
      if (kind === "invited")
        await database.db
          .insert(bookingParticipants)
          .values({ bookingId: row.id, userId: actors.person.userId });
      const photo = vi.spyOn(photoDal, "listSpaceCoverPhotos");
      const participants = vi.spyOn(editDal, "listBookingParticipantDetails");
      await expect(
        query().getBookingForEdit(
          kind === "unknown"
            ? crypto.randomUUID()
            : kind === "invalid"
              ? "bad-id"
              : row.id,
        ),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(photo).not.toHaveBeenCalled();
      expect(participants).not.toHaveBeenCalled();
    },
  );

  it.each([
    "team_left",
    "floor_closed",
    "space_closed",
    "floor_permission",
    "booking_permission",
    "restricted_personal",
  ] as const)(
    "requires current access and the stored booking actor: %s",
    async (kind) => {
      const session = kind === "team_left" ? actors.member : actors.person;
      const row = await insertFixtureBooking(database, actors, {
        userId: session.userId,
        ...(kind === "team_left" ? { teamId: actors.teamId } : {}),
      });
      if (kind === "team_left")
        await database.db
          .delete(teamMembers)
          .where(
            and(
              eq(teamMembers.userId, session.userId),
              eq(teamMembers.teamId, actors.teamId),
            ),
          );
      if (kind === "floor_closed")
        await database.db
          .update(floors)
          .set({ access: "closed" })
          .where(eq(floors.id, actors.floorId));
      if (kind === "space_closed")
        await database.db
          .update(spaces)
          .set({ access: "closed" })
          .where(eq(spaces.id, actors.publicSpaceId));
      if (kind === "floor_permission" || kind === "booking_permission")
        await database.db.insert(roleSettings).values({
          branchId: actors.branchId,
          role: "user",
          permissions:
            kind === "floor_permission" ? ["booking.own"] : ["floor.view"],
        });
      if (kind === "restricted_personal") {
        await database.db
          .update(spaces)
          .set({ access: "teams" })
          .where(eq(spaces.id, actors.publicSpaceId));
        await database.db
          .insert(teamMembers)
          .values({ teamId: actors.teamId, userId: actors.person.userId });
        await database.db.insert(accessGrants).values({
          targetType: "space",
          targetId: actors.publicSpaceId,
          teamId: actors.teamId,
        });
      }
      const photo = vi.spyOn(photoDal, "listSpaceCoverPhotos");
      await expect(
        query(session).getBookingForEdit(row.id),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(photo).not.toHaveBeenCalled();
    },
  );

  it("does not grant an operator or team admin edit access to another owner", async () => {
    const row = await insertFixtureBooking(database, actors, {
      userId: actors.member.userId,
      teamId: actors.teamId,
    });
    for (const session of [actors.operator, actors.admin])
      await expect(
        query(session).getBookingForEdit(row.id),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("excludes the booking itself from both schedule and personal usage", async () => {
    const own = await insertFixtureBooking(database, actors);
    const other = await insertFixtureBooking(database, actors, {
      during: bookingRange("13:00", "13:30"),
    });
    await insertFixtureBooking(database, actors, {
      during: bookingRange("13:30", "14:00"),
      userId: actors.stranger.userId,
    });
    await insertFixtureBooking(database, actors, {
      spaceId: actors.deskId,
      during: bookingRange("09:00", "22:00"),
    });
    const result = await query().getBookingForEdit(own.id);
    expect(result.bookings.map(({ id }) => id)).not.toContain(own.id);
    expect(result.bookings.map(({ id }) => id)).toContain(other.id);
    expect(result.actor.remainingMinutes).toBe(90);
  });

  it("uses the fixed team actor name and that team's usage without the edited row", async () => {
    const own = await insertFixtureBooking(database, actors, {
      userId: actors.member.userId,
      teamId: actors.teamId,
    });
    await insertFixtureBooking(database, actors, {
      during: bookingRange("13:00", "14:00"),
      userId: actors.admin.userId,
      teamId: actors.teamId,
    });
    await database.db.insert(roleSettings).values({
      branchId: actors.branchId,
      role: "team_member",
      permissions: ["booking.team", "floor.view"],
      limits: { maxMinutesPerDay: 180 },
    });
    const result = await query(actors.member).getBookingForEdit(own.id);
    expect(result.actor).toMatchObject({
      teamId: actors.teamId,
      name: "그로스팀으로",
      remainingMinutes: 120,
    });
  });

  it("retains existing unverified and external participants but masks every email", async () => {
    const own = await insertFixtureBooking(database, actors, {
      userId: actors.member.userId,
    });
    await database.db
      .insert(bookingParticipants)
      .values(
        [actors.admin, actors.otherMember, actors.stranger].map(
          ({ userId }) => ({ bookingId: own.id, userId }),
        ),
      );
    await database.db
      .update(users)
      .set({ emailVerified: false })
      .where(eq(users.id, actors.stranger.userId));
    const result = await query(actors.member).getBookingForEdit(own.id);
    expect(result.participants).toHaveLength(3);
    for (const person of [actors.admin, actors.otherMember, actors.stranger]) {
      const participant = result.participants.find(
        ({ userId }) => userId === person.userId,
      );
      expect(participant).toEqual({
        userId: person.userId,
        name: person.name,
        maskedEmail: maskParticipantEmail(person.email),
        sharedTeamNames:
          person === actors.admin
            ? ["그로스팀"]
            : person === actors.otherMember
              ? ["플랫폼팀"]
              : [],
      });
      expect(JSON.stringify(result)).not.toContain(person.email);
    }
  });

  it("preserves the exact getSpaceDay schedule privacy rules and maintenance records", async () => {
    const own = await insertFixtureBooking(database, actors, {
      userId: actors.member.userId,
    });
    await insertFixtureBooking(database, actors, {
      userId: actors.stranger.userId,
      during: bookingRange("13:00", "14:00"),
      title: "숨긴 제목",
      attendeeCount: 4,
    });
    await insertFixtureBooking(database, actors, {
      userId: actors.admin.userId,
      teamId: actors.teamId,
      during: bookingRange("14:00", "15:00"),
      title: "팀 제목",
      attendeeCount: 3,
    });
    await database.db.insert(spaceBlocks).values({
      spaceId: actors.publicSpaceId,
      createdBy: actors.operator.userId,
      during: bookingRange("16:00", "17:00"),
      reason: "점검",
    });
    const result = await query(actors.member).getBookingForEdit(own.id);
    const day = await query(actors.member).getSpaceDay(
      actors.branchId,
      actors.floorId,
      actors.publicSpaceId,
      bookingDate,
    );
    expect(result.bookings).toEqual(
      day.bookings.filter(({ id }) => id !== own.id),
    );
    expect(result.blocks).toEqual(day.blocks);
    expect(JSON.stringify(result)).not.toContain("숨긴 제목");
    expect(
      result.bookings.find(({ title }) => title === "팀 제목")?.attendeeCount,
    ).toBe(3);
    expect(Object.keys(result.bookings[0]!)).not.toContain("attendeeCount");
  });

  it("keeps the original local date outside the discovery window and allows metadata edits after limits or hours shrink", async () => {
    const own = await insertFixtureBooking(database, actors, {
      during: bookingRange("12:00", "13:00", "2027-01-10"),
      attendeeCount: 4,
    });
    await database.db
      .update(spaces)
      .set({ capacity: 2, bookable: false })
      .where(eq(spaces.id, actors.publicSpaceId));
    await database.db
      .update(branches)
      .set({ openHours: { sun: null } })
      .where(eq(branches.id, actors.branchId));
    await database.db.insert(roleSettings).values({
      branchId: actors.branchId,
      role: "user",
      permissions: ["floor.view", "booking.own"],
      limits: { maxMinutesPerDay: 0, maxDaysAhead: 0 },
    });
    const result = await query().getBookingForEdit(own.id);
    expect(result.date).toBe("2027-01-10");
    expect(result.openHours).toBeNull();
    expect(result.actor.remainingMinutes).toBe(0);
    expect(result.booking.attendeeCount).toBe(4);
    expect(result.space.capacity).toBe(2);
  });

  it("reads session and the clock once and finishes in three bounded stages regardless of participants or teams", async () => {
    const own = await insertFixtureBooking(database, actors);
    const sessions = vi.fn(async () => actors.person);
    const clock = vi.fn(() => bookingNow);
    const queries = createBookingQueries({
      database: database.db,
      requireSession: sessions,
      now: clock,
    });
    const meter = createQueryMeter(database.client);
    try {
      meter.start();
      await queries.getBookingForEdit(own.id);
      const before = meter.stop();
      expect(before).toEqual({
        stages: 3,
        statements: 11,
        perStage: [1, 5, 5],
      });
      expect(sessions).toHaveBeenCalledTimes(1);
      expect(clock).toHaveBeenCalledTimes(1);
      const attendees = Array.from({ length: 20 }, (_, index) => ({
        id: crypto.randomUUID(),
        email: `attendee-${index}@example.test`,
        name: `참석자 ${index}`,
      }));
      await database.db.insert(users).values(attendees);
      const extraTeams = Array.from({ length: 5 }, (_, index) => ({
        id: crypto.randomUUID(),
        name: `함께 쓰는 팀 ${index}`,
        createdBy: actors.person.userId,
      }));
      await database.db.insert(teams).values(extraTeams);
      await database.db
        .insert(teamMembers)
        .values(
          extraTeams.flatMap(({ id }) =>
            [actors.person.userId, ...attendees.map(({ id }) => id)].map(
              (userId) => ({ userId, teamId: id }),
            ),
          ),
        );
      await database.db
        .insert(bookingParticipants)
        .values(attendees.map(({ id }) => ({ bookingId: own.id, userId: id })));
      meter.start();
      const result = await queries.getBookingForEdit(own.id);
      expect(meter.stop()).toEqual(before);
      expect(result.participants).toHaveLength(20);
      expect(
        result.participants.every(
          ({ sharedTeamNames }) => sharedTeamNames.length === 5,
        ),
      ).toBe(true);
    } finally {
      meter.restore();
    }
  });

  it("requires a session before validating an ID or reading private records", async () => {
    const sessionError = new Error("Session required");
    const queries = createBookingQueries({
      database: database.db,
      requireSession: async () => {
        throw sessionError;
      },
    });
    await expect(queries.getBookingForEdit("invalid")).rejects.toBe(
      sessionError,
    );
  });

  it("uses the booking branch timezone across midnight and detects start at the exact boundary", async () => {
    const own = await insertFixtureBooking(database, actors);
    await database.db
      .update(branches)
      .set({ timezone: "America/New_York" })
      .where(eq(branches.id, actors.branchId));
    const before = await query(
      actors.person,
      new Date(own.during.start.getTime() - 1),
    ).getBookingForEdit(own.id);
    const started = await query(
      actors.person,
      own.during.start,
    ).getBookingForEdit(own.id);
    expect(before.date).toBe("2026-10-06");
    expect(before.booking.started).toBe(false);
    expect(started.date).toBe(before.date);
    expect(started.booking.started).toBe(true);
  });
});
