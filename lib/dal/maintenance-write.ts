import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  bookingParticipants,
  bookings,
  branches,
  floors,
  spaceBlocks,
  spaces,
  teams,
  users,
} from "@/lib/db/schema";
import type { DalDatabase } from "./database";
import { teamDisplayName } from "./team-name";
import { maintenanceOverlapCondition } from "./maintenance-read";

export async function getMaintenanceBlock(
  blockId: string,
  database: DalDatabase = getDb(),
) {
  const [row] = await database
    .select()
    .from(spaceBlocks)
    .where(eq(spaceBlocks.id, blockId))
    .limit(1);
  return row ?? null;
}

// 공간 잠금 뒤 모든 예약·참석자를 모아 뒤늦게 사용자를 역순으로 잠그지 않는다.
export function listMaintenanceBookings(
  {
    spaceId,
    isDeskArea,
    start,
    end,
    now,
  }: {
    spaceId: string;
    isDeskArea: boolean;
    start: Date;
    end: Date;
    now: Date;
  },
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
    })
    .from(bookings)
    .innerJoin(spaces, eq(spaces.id, bookings.spaceId))
    .innerJoin(floors, eq(floors.id, spaces.floorId))
    .innerJoin(branches, eq(branches.id, floors.branchId))
    .innerJoin(users, eq(users.id, bookings.userId))
    .leftJoin(teams, eq(teams.id, bookings.teamId))
    .where(
      maintenanceOverlapCondition({ spaceId, isDeskArea, start, end, now }),
    )
    .orderBy(asc(bookings.id));
}

export async function listMaintenanceParticipants(
  ids: readonly string[],
  database: DalDatabase,
) {
  if (!ids.length) return [];
  return database
    .select({
      bookingId: bookingParticipants.bookingId,
      userId: bookingParticipants.userId,
    })
    .from(bookingParticipants)
    .where(inArray(bookingParticipants.bookingId, [...ids]));
}

export async function lockMaintenanceBookings(
  ids: readonly string[],
  database: DalDatabase,
) {
  if (!ids.length) return;
  await database
    .select({ id: bookings.id })
    .from(bookings)
    .where(inArray(bookings.id, [...ids]))
    .orderBy(asc(bookings.id))
    .for("update");
}

export async function insertMaintenance(
  input: typeof spaceBlocks.$inferInsert,
  database: DalDatabase,
) {
  const [row] = await database.insert(spaceBlocks).values(input).returning();
  return row;
}

export async function updateUpcomingMaintenance(
  blockId: string,
  input: { during: { start: Date; end: Date }; reason: string },
  now: Date,
  database: DalDatabase,
) {
  const [row] = await database
    .update(spaceBlocks)
    .set(input)
    .where(
      and(
        eq(spaceBlocks.id, blockId),
        sql`lower(${spaceBlocks.during}) > ${now.toISOString()}::timestamptz`,
      ),
    )
    .returning();
  return row ?? null;
}

export async function deleteUpcomingMaintenance(
  blockId: string,
  now: Date,
  database: DalDatabase,
) {
  const [row] = await database
    .delete(spaceBlocks)
    .where(
      and(
        eq(spaceBlocks.id, blockId),
        sql`lower(${spaceBlocks.during}) > ${now.toISOString()}::timestamptz`,
      ),
    )
    .returning();
  return row ?? null;
}

export async function endCurrentMaintenance(
  blockId: string,
  now: Date,
  database: DalDatabase,
) {
  const current = await getMaintenanceBlock(blockId, database);
  if (!current) return null;
  const condition = and(
    eq(spaceBlocks.id, blockId),
    sql`lower(${spaceBlocks.during}) <= ${now.toISOString()}::timestamptz`,
    sql`upper(${spaceBlocks.during}) > ${now.toISOString()}::timestamptz`,
  );
  const end = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  if (end <= current.during.start) {
    const [row] = await database
      .delete(spaceBlocks)
      .where(condition)
      .returning();
    return row ?? null;
  }
  const [row] = await database
    .update(spaceBlocks)
    .set({ during: { start: current.during.start, end } })
    .where(condition)
    .returning();
  return row ?? null;
}
