import "server-only";

import { and, eq, or } from "drizzle-orm";

import type { DalDatabase } from "@/lib/dal/database";
import { getDb } from "@/lib/db/client";
import { accessGrants, floors, spaces } from "@/lib/db/schema";

export async function getSpaceForAccess(
  spaceId: string,
  database: DalDatabase = getDb(),
) {
  const [record] = await database
    .select({ space: spaces, floor: floors })
    .from(spaces)
    .innerJoin(floors, eq(spaces.floorId, floors.id))
    .where(eq(spaces.id, spaceId))
    .limit(1);
  if (!record) return null;

  const grants = await database
    .select({
      targetType: accessGrants.targetType,
      teamId: accessGrants.teamId,
    })
    .from(accessGrants)
    .where(
      or(
        and(
          eq(accessGrants.targetType, "floor"),
          eq(accessGrants.targetId, record.floor.id),
        ),
        and(
          eq(accessGrants.targetType, "space"),
          eq(accessGrants.targetId, record.space.id),
        ),
      ),
    );

  return {
    ...record.space,
    allowedTeamIds: grants
      .filter((grant) => grant.targetType === "space")
      .map((grant) => grant.teamId),
    floor: {
      ...record.floor,
      allowedTeamIds: grants
        .filter((grant) => grant.targetType === "floor")
        .map((grant) => grant.teamId),
    },
  };
}
