import "server-only";
import { and, asc, count, eq, ilike, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "@/lib/db/client";
import {
  bookingParticipants,
  bookings,
  floors,
  spaces,
  teams,
  users,
} from "@/lib/db/schema";
import type { DalDatabase } from "./database";
import { teamDisplayName } from "./team-name";

type Filters = {
  branchId: string;
  start: Date;
  end: Date;
  floorId?: string;
  type?: typeof spaces.$inferSelect.type;
  status: "all" | "confirmed" | "cancelled";
  q: string;
  page: number;
};
function conditions(input: Filters) {
  const literal = input.q.replace(/[\\%_]/g, "\\$&");
  return and(
    eq(floors.branchId, input.branchId),
    sql`${bookings.during} && tstzrange(${input.start.toISOString()}::timestamptz, ${input.end.toISOString()}::timestamptz, '[)')`,
    input.floorId ? eq(floors.id, input.floorId) : undefined,
    input.type ? eq(spaces.type, input.type) : undefined,
    input.status === "all" ? undefined : eq(bookings.status, input.status),
    literal
      ? or(
          ilike(users.name, `%${literal}%`),
          ilike(bookings.title, `%${literal}%`),
          sql`${teamDisplayName(teams)} ILIKE ${`%${literal}%`}`,
        )
      : undefined,
  );
}
export function listAdminBookingRows(
  input: Filters,
  database: DalDatabase = getDb(),
) {
  const area = alias(spaces, "admin_booking_area");
  return database
    .select({
      id: bookings.id,
      during: bookings.during,
      floorName: floors.name,
      spaceName: spaces.name,
      spaceType: spaces.type,
      areaName: area.name,
      userId: users.id,
      bookerName: users.name,
      avatarColor: users.avatarColor,
      avatarPhoto: users.avatarPhoto,
      avatarUrl: users.avatarUrl,
      teamName: teamDisplayName(teams),
      title: bookings.title,
      attendeeCount: bookings.attendeeCount,
      participantCount:
        sql<number>`(select count(*) from ${bookingParticipants} where ${bookingParticipants.bookingId} = ${bookings.id})`.mapWith(
          Number,
        ),
      status: bookings.status,
      cancelledByOwner: sql<boolean>`${bookings.cancelledBy} is not distinct from ${bookings.userId}`,
      cancelKind: bookings.cancelKind,
      cancelReason: bookings.cancelReason,
    })
    .from(bookings)
    .innerJoin(spaces, eq(spaces.id, bookings.spaceId))
    .innerJoin(floors, eq(floors.id, spaces.floorId))
    .innerJoin(users, eq(users.id, bookings.userId))
    .leftJoin(teams, eq(teams.id, bookings.teamId))
    .leftJoin(area, eq(area.id, spaces.parentId))
    .where(conditions(input))
    .orderBy(sql`lower(${bookings.during})`, asc(bookings.id))
    .limit(30)
    .offset((input.page - 1) * 30);
}
export async function countAdminBookings(
  input: Filters,
  database: DalDatabase = getDb(),
) {
  const [row] = await database
    .select({ count: count() })
    .from(bookings)
    .innerJoin(spaces, eq(spaces.id, bookings.spaceId))
    .innerJoin(floors, eq(floors.id, spaces.floorId))
    .innerJoin(users, eq(users.id, bookings.userId))
    .leftJoin(teams, eq(teams.id, bookings.teamId))
    .where(conditions(input));
  return row?.count ?? 0;
}
