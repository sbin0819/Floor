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
      document: sql<FloorPlanDocument>`jsonb_set(
        ${floorPlans.document} - 'background', '{seats}',
        coalesce((select jsonb_agg(seat.value - 'label' order by seat.ordinality)
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
