import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import type { DalDatabase } from "@/lib/dal/database";
import { getDb } from "@/lib/db/client";
import { spacePhotos } from "@/lib/db/schema";
import type { Photo } from "@/lib/photos/schema";

export async function listSpaceCoverPhotos(
  spaceIds: string[],
  database?: DalDatabase,
): Promise<(Photo & { spaceId: string })[]> {
  if (spaceIds.length === 0) return [];
  return (database ?? getDb())
    .select({
      spaceId: spacePhotos.spaceId,
      path: spacePhotos.path,
      alt: spacePhotos.alt,
    })
    .from(spacePhotos)
    .where(
      and(inArray(spacePhotos.spaceId, spaceIds), eq(spacePhotos.sortOrder, 0)),
    )
    .orderBy(asc(spacePhotos.spaceId));
}

export async function listSpacePhotos(
  spaceId: string,
  database?: DalDatabase,
): Promise<Photo[]> {
  return (database ?? getDb())
    .select({ path: spacePhotos.path, alt: spacePhotos.alt })
    .from(spacePhotos)
    .where(eq(spacePhotos.spaceId, spaceId))
    .orderBy(asc(spacePhotos.sortOrder));
}
