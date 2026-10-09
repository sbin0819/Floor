import "server-only";

import { and, eq, inArray, like, sql } from "drizzle-orm";
import type { DalDatabase } from "@/lib/dal/database";
import { branches, spacePhotos, spaces } from "@/lib/db/schema";
import { SeedError } from "@/lib/seed/errors";
import type { SeedPhotoData } from "@/lib/seed/photos";

export async function syncSeedSpacePhotos(
  spaceIds: string[],
  photos: SeedPhotoData["spacePhotos"],
  db: DalDatabase,
) {
  if (!spaceIds.length) return;
  // 전체 시드의 트랜잭션 안에서 사진 액션과 같은 공간 잠금을 잡는다.
  await db
    .select({ id: spaces.id })
    .from(spaces)
    .where(inArray(spaces.id, spaceIds))
    .orderBy(spaces.id)
    .for("update");
  const existing = await db
    .select()
    .from(spacePhotos)
    .where(inArray(spacePhotos.spaceId, spaceIds))
    .orderBy(spacePhotos.spaceId, spacePhotos.sortOrder);
  const seedIds = new Map(
    existing
      .filter(({ path }) => path.startsWith("/seed/"))
      .map(({ id, spaceId, sortOrder }) => [`${spaceId}:${sortOrder}`, id]),
  );
  const shifts: { id: string; sortOrder: number }[] = [];
  for (const spaceId of spaceIds) {
    const seed = photos.filter((photo) => photo.spaceId === spaceId);
    const preserved = existing.filter(
      (photo) => photo.spaceId === spaceId && !photo.path.startsWith("/seed/"),
    );
    if (seed.length + preserved.length > 10)
      throw new SeedError(
        "시드 사진과 보존할 사진이 10장을 넘어요. 사진을 지우지 않았어요.",
      );
    const occupied = new Set(seed.map(({ sortOrder }) => sortOrder));
    let nextOrder = 0;
    for (const photo of preserved) {
      let sortOrder = Math.max(photo.sortOrder, nextOrder);
      while (occupied.has(sortOrder)) sortOrder++;
      if (sortOrder > 9)
        throw new SeedError("보존할 사진의 순서를 안전하게 옮길 수 없어요.");
      if (sortOrder !== photo.sortOrder)
        shifts.push({ id: photo.id, sortOrder });
      nextOrder = sortOrder + 1;
    }
  }
  await db
    .delete(spacePhotos)
    .where(
      and(
        inArray(spacePhotos.spaceId, spaceIds),
        like(spacePhotos.path, "/seed/%"),
      ),
    );
  if (shifts.length) {
    const values = sql.join(
      shifts.map(
        ({ id, sortOrder }) => sql`(${id}::uuid, ${sortOrder}::integer)`,
      ),
      sql`, `,
    );
    await db
      .update(spacePhotos)
      .set({ sortOrder: sql`photo_order.sort_order` })
      .from(sql`(values ${values}) as photo_order(id, sort_order)`)
      .where(eq(spacePhotos.id, sql`photo_order.id`));
  }
  if (photos.length)
    await db
      .insert(spacePhotos)
      .values(
        photos.map((photo) => ({
          ...photo,
          id: seedIds.get(`${photo.spaceId}:${photo.sortOrder}`),
        })),
      );
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
