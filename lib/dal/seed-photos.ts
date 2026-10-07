import "server-only";

import { and, eq, inArray, not, or, sql } from "drizzle-orm";
import type { DalDatabase } from "@/lib/dal/database";
import { branches, spacePhotos } from "@/lib/db/schema";
import type { SeedPhotoData } from "@/lib/seed/photos";

export async function syncSeedSpacePhotos(
  spaceIds: string[],
  photos: SeedPhotoData["spacePhotos"],
  db: DalDatabase,
) {
  if (!spaceIds.length) return;
  const retained = photos.map(({ spaceId, sortOrder }) =>
    and(eq(spacePhotos.spaceId, spaceId), eq(spacePhotos.sortOrder, sortOrder)),
  );
  await db
    .delete(spacePhotos)
    .where(
      and(
        inArray(spacePhotos.spaceId, spaceIds),
        retained.length ? not(or(...retained)!) : undefined,
      ),
    );
  if (photos.length)
    await db
      .insert(spacePhotos)
      .values(photos)
      .onConflictDoUpdate({
        target: [spacePhotos.spaceId, spacePhotos.sortOrder],
        set: { path: sql`excluded.path`, alt: sql`excluded.alt` },
      });
}

export async function syncSeedBranchCovers(
  branchIds: string[],
  covers: SeedPhotoData["branchCovers"],
  db: DalDatabase,
) {
  const byBranch = new Map(covers.map((cover) => [cover.branchId, cover]));
  for (const branchId of branchIds) {
    const cover = byBranch.get(branchId);
    await db
      .update(branches)
      .set({
        coverPhotoPath: cover?.path ?? null,
        coverPhotoAlt: cover?.alt ?? null,
      })
      .where(eq(branches.id, branchId));
  }
}
