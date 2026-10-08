import "server-only";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { lockBookingUsers, type BookingUserLock } from "./booking-participants";
import type { DalDatabase } from "./database";
import { serializeTimeRange, type TimeRange } from "@/lib/db/range";
import {
  bookingParticipants,
  bookings,
  branches,
  floors,
  notifications,
  spaceBlocks,
  spaces,
  teams,
  users,
} from "@/lib/db/schema";

export type Round2SeedReferences = {
  bookingIds: string[];
  blockIds: string[];
  spaceIds: string[];
  floorIds: string[];
  branchIds: string[];
  userEmails: string[];
  teamIds: string[];
};

export async function readRound2SeedState(
  references: Round2SeedReferences,
  db: DalDatabase,
) {
  const [
    bookingRows,
    blockRows,
    spaceRows,
    floorRows,
    branchRows,
    userRows,
    participantRows,
    reminderRows,
    teamRows,
  ] = await Promise.all([
    db
      .select()
      .from(bookings)
      .where(inArray(bookings.id, references.bookingIds)),
    db
      .select()
      .from(spaceBlocks)
      .where(inArray(spaceBlocks.id, references.blockIds)),
    db.select().from(spaces).where(inArray(spaces.id, references.spaceIds)),
    db.select().from(floors).where(inArray(floors.id, references.floorIds)),
    db
      .select()
      .from(branches)
      .where(inArray(branches.id, references.branchIds)),
    db
      .select({
        id: users.id,
        email: users.email,
        emailVerified: users.emailVerified,
      })
      .from(users)
      .where(inArray(users.email, references.userEmails)),
    db
      .select()
      .from(bookingParticipants)
      .where(inArray(bookingParticipants.bookingId, references.bookingIds)),
    db
      .select({ id: notifications.id, bookingId: notifications.bookingId })
      .from(notifications)
      .where(
        and(
          inArray(notifications.bookingId, references.bookingIds),
          eq(notifications.type, "booking_reminder"),
        ),
      ),
    references.teamIds.length
      ? db
          .select({ id: teams.id })
          .from(teams)
          .where(inArray(teams.id, references.teamIds))
      : [],
  ]);
  return {
    bookingRows,
    blockRows,
    spaceRows,
    floorRows,
    branchRows,
    userRows,
    participantRows,
    reminderRows,
    teamRows,
  };
}

export type Round2SeedState = Awaited<ReturnType<typeof readRound2SeedState>>;

export async function lockRound2SeedRows(
  input: {
    floorIds: string[];
    spaceIds: string[];
    users: BookingUserLock[];
    teamIds: string[];
    bookingIds: string[];
  },
  db: DalDatabase,
) {
  for (const id of [...input.floorIds].sort()) {
    const [row] = await db
      .select({ id: floors.id })
      .from(floors)
      .where(eq(floors.id, id))
      .for("update");
    if (!row) return false;
  }
  // 부모 공간 → 좌석 순서는 호출자가 정하고, 사용자 잠금은 최종 세기로 한 번씩만 잡는다.
  for (const id of input.spaceIds) {
    const [row] = await db
      .select({ id: spaces.id })
      .from(spaces)
      .where(eq(spaces.id, id))
      .for("update");
    if (!row) return false;
  }
  if (!(await lockBookingUsers(input.users, db))) return false;
  for (const id of [...input.teamIds].sort()) {
    const [row] = await db
      .select({ id: teams.id })
      .from(teams)
      .where(eq(teams.id, id))
      .for("update");
    if (!row) return false;
  }
  for (const id of [...input.bookingIds].sort()) {
    const [row] = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(eq(bookings.id, id))
      .for("update");
    if (!row) return false;
  }
  return true;
}

export async function fillRound2AttendeeCount(
  bookingId: string,
  attendeeCount: number,
  db: DalDatabase,
) {
  const [row] = await db
    .update(bookings)
    .set({ attendeeCount })
    .where(and(eq(bookings.id, bookingId), isNull(bookings.attendeeCount)))
    .returning({ id: bookings.id });
  return Boolean(row);
}

export async function hasRound2BlockOverlap(
  spaceIds: string[],
  during: TimeRange,
  db: DalDatabase,
) {
  const [row] = await db
    .select({ id: spaceBlocks.id })
    .from(spaceBlocks)
    .where(
      and(
        inArray(spaceBlocks.spaceId, spaceIds),
        sql`${spaceBlocks.during} && ${serializeTimeRange(during)}::tstzrange`,
      ),
    )
    .limit(1);
  return Boolean(row);
}
