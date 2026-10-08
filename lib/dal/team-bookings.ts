import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";
import {
  bookings,
  branches,
  floors,
  spaces,
  teams,
  users,
} from "@/lib/db/schema";
import type { DalDatabase } from "./database";
import { teamDisplayName } from "./team-name";

export type FutureTeamBookingScope = {
  teamId: string;
  userId?: string;
  now: Date;
};
function futureTeamBookingScope(input: FutureTeamBookingScope) {
  return and(
    eq(bookings.teamId, input.teamId),
    input.userId ? eq(bookings.userId, input.userId) : undefined,
    eq(bookings.status, "confirmed"),
    sql`lower(${bookings.during}) > ${input.now.toISOString()}::timestamptz`,
  );
}

export async function listFutureTeamBookings(
  input: FutureTeamBookingScope,
  database: DalDatabase,
) {
  return database
    .select({
      booking: bookings,
      space: spaces,
      floor: floors,
      branch: branches,
      userName: users.name,
      teamName: teamDisplayName(teams),
      participantIds: sql<
        string[]
      >`coalesce((select array_agg(p.user_id order by p.user_id) from booking_participants p where p.booking_id = ${bookings}.id), '{}'::uuid[])`,
    })
    .from(bookings)
    .innerJoin(spaces, eq(spaces.id, bookings.spaceId))
    .innerJoin(floors, eq(floors.id, spaces.floorId))
    .innerJoin(branches, eq(branches.id, floors.branchId))
    .innerJoin(users, eq(users.id, bookings.userId))
    .innerJoin(teams, eq(teams.id, bookings.teamId))
    .where(futureTeamBookingScope(input))
    .orderBy(asc(bookings.id));
}

// 팀 행을 먼저 잠근 호출자만 쓴다. 어떤 회의 방보다 모든 예약을 먼저 잠근다.
export function lockFutureTeamBookingRows(
  input: FutureTeamBookingScope,
  database: DalDatabase,
) {
  return database
    .select({ id: bookings.id })
    .from(bookings)
    .where(futureTeamBookingScope(input))
    .orderBy(asc(bookings.id))
    .for("update");
}

export type FutureTeamBooking = Awaited<
  ReturnType<typeof listFutureTeamBookings>
>[number];
