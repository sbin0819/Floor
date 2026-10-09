import "server-only";

import { and, eq, ne, sql } from "drizzle-orm";
import type { AdminSpacePhoto } from "@/features/admin/space-detail-types";
import type { TeamOption } from "@/features/admin/types";
import { getDb } from "@/lib/db/client";
import { branches, branchStaff, floors, spaces } from "@/lib/db/schema";
import type { DalDatabase } from "./database";

type Scope = {
  branchId: string;
  floorId: string;
  spaceId: string;
  userId: string;
};
function target(scope: Scope) {
  return and(
    eq(spaces.id, scope.spaceId),
    eq(floors.id, scope.floorId),
    eq(branches.id, scope.branchId),
    ne(spaces.type, "desk"),
  );
}
function assigned(userId: string) {
  return and(
    eq(branchStaff.branchId, branches.id),
    eq(branchStaff.userId, userId),
  );
}

export async function readAdminSpaceIdentity(
  scope: Scope,
  db: DalDatabase = getDb(),
) {
  const [row] = await db
    .select({ id: spaces.id, floorId: floors.id, branchId: branches.id })
    .from(spaces)
    .innerJoin(floors, eq(floors.id, spaces.floorId))
    .innerJoin(branches, eq(branches.id, floors.branchId))
    .innerJoin(branchStaff, assigned(scope.userId))
    .where(target(scope));
  return row ?? null;
}

export async function readAdminSpaceDetail(
  scope: Scope,
  db: DalDatabase = getDb(),
) {
  const [row] = await db
    .select({
      branch: {
        id: branches.id,
        name: branches.name,
        address: branches.address,
        timezone: branches.timezone,
        openHours: branches.openHours,
      },
      floor: {
        id: floors.id,
        name: floors.name,
        level: floors.level,
        sortOrder: floors.sortOrder,
        access: floors.access,
      },
      space: {
        id: spaces.id,
        floorId: spaces.floorId,
        name: spaces.name,
        type: spaces.type,
        capacity: spaces.capacity,
        bookable: spaces.bookable,
        amenities: spaces.amenities,
        access: spaces.access,
        archivedAt: spaces.archivedAt,
      },
      floorTeams: sql<
        TeamOption[]
      >`coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name, t.id)
      from access_grants grant_row join teams t on t.id = grant_row.team_id and t.deleted_at is null
      where grant_row.target_type = 'floor' and grant_row.target_id = ${floors.id}), '[]'::jsonb)`,
      spaceTeams: sql<
        TeamOption[]
      >`coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name, t.id)
      from access_grants grant_row join teams t on t.id = grant_row.team_id and t.deleted_at is null
      where grant_row.target_type = 'space' and grant_row.target_id = ${spaces.id}), '[]'::jsonb)`,
      deskCount: sql<number>`(select count(*)::int from spaces desk where desk.parent_id = ${spaces.id} and desk.type = 'desk' and desk.archived_at is null)`,
      photos: sql<
        AdminSpacePhoto[]
      >`coalesce((select jsonb_agg(jsonb_build_object('id', photo.id, 'path', photo.path, 'alt', photo.alt, 'sortOrder', photo.sort_order) order by photo.sort_order, photo.id)
      from space_photos photo where photo.space_id = ${spaces.id}), '[]'::jsonb)`,
    })
    .from(spaces)
    .innerJoin(floors, eq(floors.id, spaces.floorId))
    .innerJoin(branches, eq(branches.id, floors.branchId))
    .innerJoin(branchStaff, assigned(scope.userId))
    .where(target(scope));
  return row ?? null;
}
