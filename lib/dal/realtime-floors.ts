import "server-only";

import { eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { isPermissionKey, type Role } from "@/lib/permissions/keys";
import type {
  FloorForAccess,
  PermissionContext,
} from "@/lib/permissions/types";
import type { DalDatabase } from "./database";

export async function readRealtimeFloorAccess(
  userId: string,
  database: DalDatabase = getDb(),
) {
  // 방 세 개와 스페이스 조회에 병렬로 붙여도 한 단계의 문장 수를 넘기지 않는다.
  const [row] = await database
    .select({
      teams: sql<PermissionContext["teams"]>`coalesce((
        select jsonb_agg(jsonb_build_object('teamId', m.team_id, 'role', m.role) order by m.team_id)
        from team_members m inner join teams t on t.id = m.team_id
        where m.user_id = ${userId}::uuid and t.deleted_at is null
      ), '[]'::jsonb)`,
      staffBranchIds: sql<string[]>`array(
        select staff.branch_id from branch_staff staff
        where staff.user_id = ${userId}::uuid order by staff.branch_id
      )`,
      settings: sql<
        { branchId: string; role: Role; permissions: string[] }[]
      >`coalesce((
        select jsonb_agg(jsonb_build_object('branchId', r.branch_id, 'role', r.role, 'permissions', r.permissions))
        from role_settings r
      ), '[]'::jsonb)`,
      floors: sql<(FloorForAccess & { id: string })[]>`coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', f.id, 'branchId', f.branch_id, 'access', f.access,
          'allowedTeamIds', array(select g.team_id from access_grants g
            where g.target_type = 'floor' and g.target_id = f.id order by g.team_id)
        ) order by b.name, b.id, f.sort_order, f.level, f.id)
        from floors f inner join branches b on b.id = f.branch_id
      ), '[]'::jsonb)`,
    })
    .from(users)
    .where(eq(users.id, userId));
  const context: PermissionContext = {
    userId,
    teams: row?.teams ?? [],
    staffBranchIds: row?.staffBranchIds ?? [],
    roleSettings: {},
  };
  for (const setting of row?.settings ?? [])
    (context.roleSettings[setting.branchId] ??= {})[setting.role] =
      setting.permissions.filter(isPermissionKey);
  return { context, floors: row?.floors ?? [] };
}
