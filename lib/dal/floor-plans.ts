import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import type { DalDatabase } from "@/lib/dal/database";
import { getDb } from "@/lib/db/client";
import { accessGrants, floorPlans, floors } from "@/lib/db/schema";
import type { FloorPlanDocument } from "@/lib/floor-plan/types";

export async function getFloorPlanWithAccess(
  planId: string,
  database: DalDatabase = getDb(),
) {
  const [row] = await database
    .select({
      branchId: floors.branchId,
      access: floors.access,
      allowedTeamIds: sql<string[]>`array(
        select ${accessGrants.teamId} from ${accessGrants}
        where ${accessGrants.targetType} = 'floor'
          and ${accessGrants.targetId} = ${floors}.id
        order by ${accessGrants.teamId}
      )`,
      // 편집 전용 정보는 DB에서부터 제외한다. 좌석 이름은 39 이후의 문서도 보호한다.
      document: sql<FloorPlanDocument>`jsonb_build_object(
        'schema', ${floorPlans.document} -> 'schema',
        'unit', ${floorPlans.document} -> 'unit',
        'bounds', ${floorPlans.document} -> 'bounds',
        'walls', ${floorPlans.document} -> 'walls',
        'openings', ${floorPlans.document} -> 'openings',
        'spaces', ${floorPlans.document} -> 'spaces',
        'fixtures', ${floorPlans.document} -> 'fixtures',
        'seats', coalesce((select jsonb_agg(jsonb_build_object(
          'id', seat.value -> 'id', 'spaceId', seat.value -> 'spaceId',
          'at', seat.value -> 'at', 'size', seat.value -> 'size',
          'rotation', seat.value -> 'rotation'
        ) order by seat.ordinality)
          from jsonb_array_elements(${floorPlans.document} -> 'seats')
            with ordinality as seat(value, ordinality)), '[]'::jsonb)
      )`,
    })
    .from(floorPlans)
    .innerJoin(floors, eq(floors.id, floorPlans.floorId))
    .where(
      and(
        eq(floorPlans.id, planId),
        inArray(floorPlans.status, ["published", "archived"]),
      ),
    )
    .limit(1);
  return row ?? null;
}
