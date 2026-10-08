import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import type { DalDatabase } from "@/lib/dal/database";
import { getDb } from "@/lib/db/client";
import { bookingParticipants, bookings, teams, users } from "@/lib/db/schema";

export function getParticipantEligibility(
  ownerId: string,
  participantIds: readonly string[],
  database: DalDatabase = getDb(),
) {
  if (!participantIds.length) return Promise.resolve([]);
  return database
    .select({
      id: users.id,
      email: users.email,
      emailVerified: users.emailVerified,
      sharesTeam: sql<boolean>`exists (
      select 1 from team_members candidate_membership
      inner join team_members owner_membership
        on owner_membership.team_id = candidate_membership.team_id
      where candidate_membership.user_id = ${users}.${sql.identifier("id")}
        and owner_membership.user_id = ${ownerId}::uuid
    )`,
    })
    .from(users)
    .where(inArray(users.id, [...participantIds]));
}

export type BookingUserLock = {
  userId: string;
  strength: "update" | "key share";
};

export async function lockBookingUsers(
  requests: readonly BookingUserLock[],
  database: DalDatabase,
) {
  const strengths = new Map<string, BookingUserLock["strength"]>();
  for (const { userId, strength } of requests) {
    const id = userId.toLowerCase();
    if (strengths.get(id) !== "update") strengths.set(id, strength);
  }
  // 모든 FK 대상을 먼저 모아 최종 세기로 한 번씩 잠가 잠금 승격과 역순 잠금을 피한다.
  for (const [id, strength] of [...strengths].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    const [user] = await database
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, id))
      .for(strength);
    if (!user) return false;
  }
  return true;
}

export async function lockParticipantBookingActor(
  input: {
    userId: string;
    teamId: string | null;
    participantIds: readonly string[];
  },
  database: DalDatabase,
) {
  if (
    !(await lockBookingUsers(
      [
        {
          userId: input.userId,
          strength: input.teamId === null ? "update" : "key share",
        },
        ...input.participantIds.map((userId) => ({
          userId,
          strength: "key share" as const,
        })),
      ],
      database,
    ))
  )
    return false;
  if (input.teamId === null) return true;
  const [team] = await database
    .select({ id: teams.id })
    .from(teams)
    .where(eq(teams.id, input.teamId))
    .for("update");
  return Boolean(team);
}

export async function lockParticipantBooking(
  bookingId: string,
  database: DalDatabase,
) {
  const [booking] = await database
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .for("update");
  return booking ?? null;
}

export async function deleteCurrentBookingParticipant(
  { bookingId, userId, now }: { bookingId: string; userId: string; now: Date },
  database: DalDatabase,
) {
  const [row] = await database
    .delete(bookingParticipants)
    .where(
      and(
        eq(bookingParticipants.bookingId, bookingId),
        eq(bookingParticipants.userId, userId),
        sql`exists (select 1 from ${bookings}
      where ${bookings.id} = ${bookingParticipants}.${sql.identifier("booking_id")}
      and ${bookings.status} = 'confirmed'
      and upper(${bookings.during}) > ${now.toISOString()}::timestamptz
      and ${bookings.userId} <> ${userId}::uuid)`,
      ),
    )
    .returning({ bookingId: bookingParticipants.bookingId });
  return row ?? null;
}

export async function insertBookingParticipants(
  bookingId: string,
  userIds: readonly string[],
  database: DalDatabase,
) {
  if (userIds.length)
    await database
      .insert(bookingParticipants)
      .values(userIds.map((userId) => ({ bookingId, userId })));
}
