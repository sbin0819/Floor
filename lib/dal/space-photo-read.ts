import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { floors, spacePhotos, spaces } from "@/lib/db/schema";
import type { DalDatabase } from "./database";

export async function readSpacePhotoAccess(
  photoId: string,
  userId: string,
  db: DalDatabase = getDb(),
) {
  const [row] = await db
    .select({
      id: spacePhotos.id,
      type: spaces.type,
      archivedAt: spaces.archivedAt,
      access: spaces.access,
      allowedTeamIds: sql<
        string[]
      >`array(select team_id from access_grants where target_type = 'space' and target_id = ${spaces.id})`,
      floor: { branchId: floors.branchId, access: floors.access },
      floorTeamIds: sql<
        string[]
      >`array(select team_id from access_grants where target_type = 'floor' and target_id = ${floors.id})`,
      ownBooking: sql<boolean>`exists(select 1 from bookings where space_id = ${spaces.id} and user_id = ${userId}::uuid)`,
    })
    .from(spacePhotos)
    .innerJoin(spaces, eq(spaces.id, spacePhotos.spaceId))
    .innerJoin(floors, eq(floors.id, spaces.floorId))
    .where(
      and(
        eq(spacePhotos.id, photoId),
        eq(spacePhotos.path, `/api/space-photos/${photoId}.webp`),
      ),
    );
  return row
    ? { ...row, floor: { ...row.floor, allowedTeamIds: row.floorTeamIds } }
    : null;
}
