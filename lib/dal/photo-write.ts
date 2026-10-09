import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";
import type { DalDatabase } from "@/lib/dal";
import { getDb } from "@/lib/db/client";
import { spacePhotos } from "@/lib/db/schema";

const projection = {
  id: spacePhotos.id,
  spaceId: spacePhotos.spaceId,
  path: spacePhotos.path,
  alt: spacePhotos.alt,
  sortOrder: spacePhotos.sortOrder,
};
export async function readPhotoSpaceId(
  photoId: string,
  database: DalDatabase = getDb(),
) {
  const [row] = await database
    .select({ spaceId: spacePhotos.spaceId })
    .from(spacePhotos)
    .where(eq(spacePhotos.id, photoId));
  return row?.spaceId ?? null;
}
export async function readPhotoForMutation(
  photoId: string,
  database: DalDatabase = getDb(),
) {
  const [row] = await database
    .select({
      id: spacePhotos.id,
      spaceId: spacePhotos.spaceId,
      pathMatches: sql<boolean>`${spacePhotos.path} = '/api/space-photos/' || ${spacePhotos.id}::text || '.webp'`,
    })
    .from(spacePhotos)
    .where(eq(spacePhotos.id, photoId));
  return row ?? null;
}
export function listPhotosForMutation(
  spaceId: string,
  database: DalDatabase = getDb(),
) {
  return database
    .select(projection)
    .from(spacePhotos)
    .where(eq(spacePhotos.spaceId, spaceId))
    .orderBy(asc(spacePhotos.sortOrder), asc(spacePhotos.id));
}
export async function insertSpacePhoto(
  input: {
    id: string;
    spaceId: string;
    path: string;
    alt: string;
    sortOrder: number;
  },
  database: DalDatabase,
) {
  const [row] = await database
    .insert(spacePhotos)
    .values(input)
    .returning({ id: spacePhotos.id });
  return row ?? null;
}
export async function writeSpacePhotoOrder(
  spaceId: string,
  photoIds: readonly string[],
  database: DalDatabase,
) {
  if (photoIds.length === 0) return [];
  const values = sql.join(
    photoIds.map((id, index) => sql`(${id}::uuid, ${index}::integer)`),
    sql`, `,
  );
  return database
    .update(spacePhotos)
    .set({ sortOrder: sql`ordered.sort_order` })
    .from(sql`(values ${values}) as ordered(id, sort_order)`)
    .where(
      and(
        eq(spacePhotos.spaceId, spaceId),
        sql`${spacePhotos.id} = ordered.id`,
      ),
    )
    .returning({ id: spacePhotos.id });
}
export async function writeSpacePhotoAlt(
  input: { photoId: string; spaceId: string; alt: string },
  database: DalDatabase,
) {
  const [row] = await database
    .update(spacePhotos)
    .set({ alt: input.alt })
    .where(
      and(
        eq(spacePhotos.id, input.photoId),
        eq(spacePhotos.spaceId, input.spaceId),
      ),
    )
    .returning({ id: spacePhotos.id });
  return row ?? null;
}
export async function removeSpacePhoto(
  input: { photoId: string; spaceId: string },
  database: DalDatabase,
) {
  const [row] = await database
    .delete(spacePhotos)
    .where(
      and(
        eq(spacePhotos.id, input.photoId),
        eq(spacePhotos.spaceId, input.spaceId),
      ),
    )
    .returning(projection);
  return row ?? null;
}
