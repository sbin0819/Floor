import "server-only";

import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { DalDatabase } from "@/lib/dal/database";
import { getDb } from "@/lib/db/client";
import { serializeTimeRange, type TimeRange } from "@/lib/db/range";
import {
  bookings,
  branches,
  floors,
  spaceBlocks,
  spacePhotos,
  spaces,
  teamMembers,
  teams,
  users,
} from "@/lib/db/schema";
import { addDays, localDate, zonedDateTime } from "@/lib/time/zoned";
import {
  bookingParticipantNames,
  ownedOrInvitedBooking,
} from "@/lib/dal/booking-attendance";

export type ScheduleRange = { spaceIds: string[]; during: TimeRange };
export type BookingActor = { userId: string } | { teamId: string };
type BookingSummary = Pick<
  typeof bookings.$inferSelect,
  "id" | "spaceId" | "userId" | "teamId" | "during"
>;
type BookingDetail = typeof bookings.$inferSelect & {
  userName: string;
  teamName: string | null;
};

export function listSpaceBookings(
  input: ScheduleRange & { summaryOnly: true },
  database?: DalDatabase,
): Promise<BookingSummary[]>;
export function listSpaceBookings(
  input: ScheduleRange & { summaryOnly?: false },
  database?: DalDatabase,
): Promise<BookingDetail[]>;

export async function listSpaceBookings(
  { spaceIds, during, summaryOnly }: ScheduleRange & { summaryOnly?: boolean },
  database: DalDatabase = getDb(),
) {
  if (spaceIds.length === 0) return [];
  const filter = and(
    inArray(bookings.spaceId, spaceIds),
    eq(bookings.status, "confirmed"),
    sql`${bookings.during} && ${serializeTimeRange(during)}::tstzrange`,
  );
  if (summaryOnly) {
    return database
      .select({
        id: bookings.id,
        spaceId: bookings.spaceId,
        userId: bookings.userId,
        teamId: bookings.teamId,
        during: bookings.during,
      })
      .from(bookings)
      .where(filter)
      .orderBy(asc(sql`lower(${bookings.during})`), asc(bookings.id));
  }
  return database
    .select({
      ...getTableColumns(bookings),
      userName: users.name,
      teamName: teams.name,
    })
    .from(bookings)
    .innerJoin(users, eq(users.id, bookings.userId))
    .leftJoin(teams, eq(teams.id, bookings.teamId))
    .where(filter)
    .orderBy(asc(sql`lower(${bookings.during})`), asc(bookings.id));
}

export async function listSpaceBlocks(
  { spaceIds, during }: ScheduleRange,
  database: DalDatabase = getDb(),
) {
  if (spaceIds.length === 0) return [];
  return database
    .select()
    .from(spaceBlocks)
    .where(
      and(
        inArray(spaceBlocks.spaceId, spaceIds),
        sql`${spaceBlocks.during} && ${serializeTimeRange(during)}::tstzrange`,
      ),
    )
    .orderBy(asc(sql`lower(${spaceBlocks.during})`), asc(spaceBlocks.id));
}

export async function sumBookedMinutes(
  {
    branchId,
    during,
    actor,
  }: { branchId: string; during: TimeRange; actor: BookingActor },
  database: DalDatabase = getDb(),
): Promise<number> {
  const [result] = await database
    .select({
      minutes:
        sql<string>`coalesce(sum(extract(epoch from (upper(${bookings.during}) - lower(${bookings.during}))) / 60), 0)`.mapWith(
          Number,
        ),
    })
    .from(bookings)
    .innerJoin(spaces, eq(spaces.id, bookings.spaceId))
    .innerJoin(floors, eq(floors.id, spaces.floorId))
    .where(
      and(
        eq(floors.branchId, branchId),
        ne(spaces.type, "desk"),
        eq(bookings.status, "confirmed"),
        sql`lower(${bookings.during}) >= ${during.start.toISOString()}::timestamptz`,
        sql`lower(${bookings.during}) < ${during.end.toISOString()}::timestamptz`,
        "teamId" in actor
          ? eq(bookings.teamId, actor.teamId)
          : and(eq(bookings.userId, actor.userId), isNull(bookings.teamId)),
      ),
    );
  return result?.minutes ?? 0;
}

export async function sumActorBookedMinutes(
  {
    branchId,
    during,
    userId,
    teamIds,
    includePersonal,
  }: {
    branchId: string;
    during: TimeRange;
    userId: string;
    teamIds: string[];
    includePersonal: boolean;
  },
  database: DalDatabase = getDb(),
) {
  if (!includePersonal && teamIds.length === 0) return [];
  return database
    .select({
      teamId: bookings.teamId,
      minutes:
        sql<string>`sum(extract(epoch from (upper(${bookings.during}) - lower(${bookings.during}))) / 60)`.mapWith(
          Number,
        ),
    })
    .from(bookings)
    .innerJoin(spaces, eq(spaces.id, bookings.spaceId))
    .innerJoin(floors, eq(floors.id, spaces.floorId))
    .where(
      and(
        eq(floors.branchId, branchId),
        ne(spaces.type, "desk"),
        eq(bookings.status, "confirmed"),
        sql`lower(${bookings.during}) >= ${during.start.toISOString()}::timestamptz`,
        sql`lower(${bookings.during}) < ${during.end.toISOString()}::timestamptz`,
        or(
          includePersonal
            ? and(eq(bookings.userId, userId), isNull(bookings.teamId))
            : undefined,
          teamIds.length ? inArray(bookings.teamId, teamIds) : undefined,
        ),
      ),
    )
    .groupBy(bookings.teamId);
}

export async function insertBooking(
  input: typeof bookings.$inferInsert,
  database: DalDatabase = getDb(),
) {
  const [booking] = await database.insert(bookings).values(input).returning();
  if (!booking) throw new Error("Booking insertion returned no row.");
  return booking;
}

export async function cancelBookingRecord(
  { bookingId, userId, now }: { bookingId: string; userId: string; now: Date },
  database: DalDatabase = getDb(),
) {
  const [booking] = await database
    .update(bookings)
    .set({ status: "cancelled", cancelledAt: now, cancelledBy: userId })
    .where(
      and(
        eq(bookings.id, bookingId),
        eq(bookings.status, "confirmed"),
        sql`upper(${bookings.during}) > ${now.toISOString()}::timestamptz`,
      ),
    )
    .returning();
  return booking ?? null;
}

function locatedBookings(database: DalDatabase, userId: string) {
  const area = alias(spaces, "booking_desk_area");
  return database
    .select({
      booking: bookings,
      space: spaces,
      area,
      floor: floors,
      branch: branches,
      userName: users.name,
      teamName: teams.name,
      photo: { path: spacePhotos.path, alt: spacePhotos.alt },
      isOwner: sql<boolean>`${bookings.userId} = ${userId}`,
      participantNames: bookingParticipantNames,
    })
    .from(bookings)
    .innerJoin(spaces, eq(spaces.id, bookings.spaceId))
    .leftJoin(
      area,
      and(
        eq(spaces.type, "desk"),
        eq(area.id, spaces.parentId),
        eq(area.type, "desk_area"),
        eq(area.floorId, spaces.floorId),
      ),
    )
    .leftJoin(
      spacePhotos,
      and(
        eq(
          spacePhotos.spaceId,
          sql`case when ${spaces.type} = 'desk' then ${area.id} else ${spaces.id} end`,
        ),
        eq(spacePhotos.sortOrder, 0),
        eq(bookings.userId, userId),
      ),
    )
    .innerJoin(floors, eq(floors.id, spaces.floorId))
    .innerJoin(branches, eq(branches.id, floors.branchId))
    .innerJoin(users, eq(users.id, bookings.userId))
    .leftJoin(teams, eq(teams.id, bookings.teamId));
}

export async function listMyUpcomingBookings(
  userId: string,
  now: Date,
  database: DalDatabase = getDb(),
) {
  return locatedBookings(database, userId)
    .where(
      and(
        ownedOrInvitedBooking(userId),
        eq(bookings.status, "confirmed"),
        sql`upper(${bookings.during}) > ${now.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(asc(sql`lower(${bookings.during})`), asc(bookings.id))
    .limit(3);
}

export async function listMyBranchBookingDates(
  {
    userId,
    branchId,
    today,
    timezone,
  }: { userId: string; branchId: string; today: string; timezone: string },
  database: DalDatabase = getDb(),
): Promise<string[]> {
  const start = zonedDateTime(today, "00:00", timezone);
  const end = zonedDateTime(addDays(today, 61), "00:00", timezone);
  const rows = await database
    .select({ during: bookings.during })
    .from(bookings)
    .innerJoin(spaces, eq(spaces.id, bookings.spaceId))
    .innerJoin(floors, eq(floors.id, spaces.floorId))
    .where(
      and(
        eq(bookings.userId, userId),
        eq(floors.branchId, branchId),
        eq(bookings.status, "confirmed"),
        sql`lower(${bookings.during}) >= ${start.toISOString()}::timestamptz`,
        sql`lower(${bookings.during}) < ${end.toISOString()}::timestamptz`,
      ),
    );
  return [
    ...new Set(rows.map(({ during }) => localDate(during.start, timezone))),
  ].sort();
}

export async function listMyConfirmedBookingsBetween(
  { userId, start, end }: { userId: string; start: Date; end: Date },
  database: DalDatabase = getDb(),
) {
  return locatedBookings(database, userId)
    .where(
      and(
        ownedOrInvitedBooking(userId),
        eq(bookings.status, "confirmed"),
        sql`lower(${bookings.during}) >= ${start.toISOString()}::timestamptz`,
        sql`lower(${bookings.during}) < ${end.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(asc(sql`lower(${bookings.during})`), asc(bookings.id));
}

export async function getBookingWithLocation(
  bookingId: string,
  database: DalDatabase = getDb(),
) {
  // 취소 권한을 확인하기 위한 조회에는 사진을 읽지 않는다.
  const [row] = await database
    .select({
      booking: bookings,
      space: spaces,
      floor: floors,
      branch: branches,
      userName: users.name,
      teamName: teams.name,
    })
    .from(bookings)
    .innerJoin(spaces, eq(spaces.id, bookings.spaceId))
    .innerJoin(floors, eq(floors.id, spaces.floorId))
    .innerJoin(branches, eq(branches.id, floors.branchId))
    .innerJoin(users, eq(users.id, bookings.userId))
    .leftJoin(teams, eq(teams.id, bookings.teamId))
    .where(eq(bookings.id, bookingId))
    .limit(1);
  return row ?? null;
}

export async function listMyBookings(
  userId: string,
  now: Date,
  database: DalDatabase = getDb(),
) {
  const [bookedBranches, upcoming] = await Promise.all([
    database
      .select({ id: branches.id, timezone: branches.timezone })
      .from(bookings)
      .innerJoin(spaces, eq(spaces.id, bookings.spaceId))
      .innerJoin(floors, eq(floors.id, spaces.floorId))
      .innerJoin(branches, eq(branches.id, floors.branchId))
      .where(ownedOrInvitedBooking(userId))
      .groupBy(branches.id, branches.timezone),
    locatedBookings(database, userId)
      .where(
        and(
          ownedOrInvitedBooking(userId),
          eq(bookings.status, "confirmed"),
          sql`upper(${bookings.during}) > ${now.toISOString()}::timestamptz`,
        ),
      )
      .orderBy(asc(sql`lower(${bookings.during})`), asc(bookings.id)),
  ]);
  const recentAtBranch = bookedBranches.map((branch) => {
    const oldestDate = addDays(localDate(now, branch.timezone), -30);
    const cutoff = zonedDateTime(oldestDate, "00:00", branch.timezone);
    return and(
      eq(branches.id, branch.id),
      sql`lower(${bookings.during}) >= ${cutoff.toISOString()}::timestamptz`,
    );
  });
  const past = recentAtBranch.length
    ? await locatedBookings(database, userId)
        .where(
          and(
            ownedOrInvitedBooking(userId),
            or(
              eq(bookings.status, "cancelled"),
              sql`upper(${bookings.during}) <= ${now.toISOString()}::timestamptz`,
            ),
            or(...recentAtBranch),
          ),
        )
        .orderBy(desc(sql`lower(${bookings.during})`), asc(bookings.id))
        .limit(50)
    : [];
  return { upcoming, past };
}

export async function getUserDefaultBranch(
  userId: string,
  database: DalDatabase = getDb(),
): Promise<string | null> {
  const [row] = await database
    .select({ defaultBranchId: users.defaultBranchId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.defaultBranchId ?? null;
}

export async function setUserDefaultBranch(
  userId: string,
  branchId: string,
  database: DalDatabase = getDb(),
) {
  const [row] = await database
    .update(users)
    .set({ defaultBranchId: branchId })
    .where(eq(users.id, userId))
    .returning({ id: users.id, defaultBranchId: users.defaultBranchId });
  return row ?? null;
}

export function listUserTeamHomeBranches(
  userId: string,
  database: DalDatabase = getDb(),
) {
  return database
    .select({
      id: teams.id,
      name: teams.name,
      homeBranchId: teams.homeBranchId,
    })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(eq(teamMembers.userId, userId))
    .orderBy(asc(teams.name), asc(teams.id));
}

export async function lockFloorForBooking(
  floorId: string,
  transaction: DalDatabase,
) {
  const [floor] = await transaction
    .select()
    .from(floors)
    .where(eq(floors.id, floorId))
    .for("share");
  return floor ?? null;
}

export async function lockSpaceForBooking(
  spaceId: string,
  transaction: DalDatabase,
) {
  const [space] = await transaction
    .select()
    .from(spaces)
    .where(eq(spaces.id, spaceId))
    .for("share");
  return space ?? null;
}

export async function lockBookingActor(
  { userId, teamId }: { userId: string; teamId: string | null },
  transaction: DalDatabase,
): Promise<boolean> {
  // 팀 가입 처리와 사용자 → 팀 순서를 맞춰 INSERT의 FK 잠금과 역전되지 않게 해요.
  const [user] = await transaction
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .for(teamId === null ? "update" : "key share");
  if (!user) return false;
  if (teamId === null) return true;
  const [team] = await transaction
    .select({ id: teams.id })
    .from(teams)
    .where(eq(teams.id, teamId))
    .for("update");
  return Boolean(team);
}

export async function lockBookingCanceller(
  userId: string,
  database: DalDatabase,
): Promise<boolean> {
  const [user] = await database
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .for("key share");
  return Boolean(user);
}
