import "server-only";

import { and, asc, eq, isNull, max, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "@/lib/db/client";
import {
  accessGrants,
  bookings,
  branches,
  branchStaff,
  floorPlans,
  floors,
  spaces,
  users,
} from "@/lib/db/schema";
import type { FloorPlanDocument } from "@/lib/floor-plan/types";
import type { AccessScope } from "@/lib/permissions/types";
import type { DalDatabase } from "./database";

function currentSource() {
  return or(
    eq(floorPlans.status, "draft"),
    and(
      eq(floorPlans.status, "published"),
      eq(floorPlans.id, floors.publishedPlanId),
    ),
  );
}
function assignedFloor(floorId: string, userId: string) {
  return sql`exists (
    select 1 from ${floors} as assigned_floor
    inner join ${branchStaff} as assigned_staff
      on assigned_staff.branch_id = assigned_floor.branch_id
    where assigned_floor.id = ${floorId} and assigned_staff.user_id = ${userId}
  )`;
}
export async function getPlanEditorFloor(
  floorId: string,
  db: DalDatabase = getDb(),
) {
  const [row] = await db
    .select({
      id: floors.id,
      name: floors.name,
      branchId: branches.id,
      branchName: branches.name,
      timezone: branches.timezone,
      access: floors.access,
      publishedPlanId: floors.publishedPlanId,
      allowedTeamIds: sql<string[]>`array(
      select ${accessGrants.teamId} from ${accessGrants}
      where ${accessGrants.targetType} = 'floor' and ${accessGrants.targetId} = ${floors}.id
      order by ${accessGrants.teamId}
    )`,
    })
    .from(floors)
    .innerJoin(branches, eq(branches.id, floors.branchId))
    .where(eq(floors.id, floorId));
  return row ?? null;
}
export function listPlanEditorSources(
  floorId: string,
  userId: string,
  db: DalDatabase = getDb(),
) {
  return db
    .select({
      planId: floorPlans.id,
      version: floorPlans.version,
      status: floorPlans.status,
      revision: floorPlans.revision,
      document: floorPlans.document,
      updatedAt: floorPlans.updatedAt,
      updatedByName: users.name,
    })
    .from(floorPlans)
    .innerJoin(floors, eq(floors.id, floorPlans.floorId))
    .innerJoin(
      branchStaff,
      and(
        eq(branchStaff.branchId, floors.branchId),
        eq(branchStaff.userId, userId),
      ),
    )
    .leftJoin(users, eq(users.id, floorPlans.updatedBy))
    .where(and(eq(floorPlans.floorId, floorId), currentSource()))
    .orderBy(asc(floorPlans.version));
}
export function listPlanEditorSpaces(
  floorId: string,
  userId: string,
  db: DalDatabase = getDb(),
  now?: Date,
) {
  const sameFloor = eq(spaces.floorId, floorId);
  // 타 층 참조는 오류를 구분하는 식별자만 남긴다. 이름·부모·허용 팀은 읽지 않는다.
  return db
    .select({
      id: spaces.id,
      futureBookingCount: now
        ? sql<number>`case when ${sameFloor} and ${spaces.type} = 'desk'
        and exists(select 1 from ${floorPlans} inner join ${floors} on ${floors}.published_plan_id = ${floorPlans}.id
          cross join lateral jsonb_array_elements(${floorPlans}.document -> 'seats') as published_seat(value)
          where ${floors}.id = ${floorId} and ${floorPlans}.floor_id = ${floorId} and ${floorPlans}.status = 'published'
            and lower(published_seat.value ->> 'spaceId') = ${spaces}.id::text)
        then (select count(*)::int from ${bookings} where ${bookings}.space_id = ${spaces}.id
          and ${bookings}.status = 'confirmed' and upper(${bookings}.during) > ${now.toISOString()}::timestamptz)
        else 0 end`
        : sql<number>`0`,
      floorId: spaces.floorId,
      parentId: sql<
        string | null
      >`case when ${sameFloor} then ${spaces.parentId} else null end`,
      type: sql<
        typeof spaces.$inferSelect.type
      >`case when ${sameFloor} then ${spaces.type} else 'meeting_room'::space_type end`,
      name: sql<string>`case when ${sameFloor} then ${spaces.name} else '다른 층의 공간' end`,
      capacity: sql<
        number | null
      >`case when ${sameFloor} then ${spaces.capacity} else null end`,
      bookable: sql<boolean>`case when ${sameFloor} then ${spaces.bookable} else false end`,
      amenities: sql<
        string[]
      >`case when ${sameFloor} then ${spaces.amenities} else array[]::text[] end`,
      archived: sql<boolean>`case when ${sameFloor} then ${spaces.archivedAt} is not null else false end`,
      access: sql<AccessScope | null>`case when ${sameFloor} then ${spaces.access} else null end`,
      allowedTeamIds: sql<string[]>`case when ${sameFloor} then array(
      select ${accessGrants.teamId} from ${accessGrants}
      where ${accessGrants.targetType} = 'space' and ${accessGrants.targetId} = ${spaces}.id
      order by ${accessGrants.teamId}
    ) else array[]::uuid[] end`,
    })
    .from(spaces)
    .where(
      and(
        assignedFloor(floorId, userId),
        or(
          and(sameFloor, isNull(spaces.archivedAt)),
          sql`exists (
        select 1 from ${floorPlans} inner join ${floors} on ${floors}.id = ${floorPlans}.floor_id
        cross join lateral jsonb_array_elements(
          (${floorPlans}.document -> 'spaces') || (${floorPlans}.document -> 'seats')
        ) as referenced_shape(value)
        where ${floorPlans}.floor_id = ${floorId}
          and (${floorPlans}.status = 'draft' or (
            ${floorPlans}.status = 'published' and ${floorPlans}.id = ${floors}.published_plan_id
          )) and lower(referenced_shape.value ->> 'spaceId') = ${spaces}.id::text
      )`,
        ),
      ),
    )
    .orderBy(asc(spaces.id));
}
export function listAdminPlanFloors(
  branchId: string,
  userId: string,
  db: DalDatabase = getDb(),
) {
  const published = alias(floorPlans, "admin_published_plan");
  const draft = alias(floorPlans, "admin_draft_plan");
  return db
    .select({
      id: floors.id,
      name: floors.name,
      published: {
        planId: published.id,
        version: published.version,
        publishedAt: published.publishedAt,
      },
      draft: {
        planId: draft.id,
        version: draft.version,
        updatedAt: draft.updatedAt,
        updatedByName: users.name,
      },
    })
    .from(floors)
    .innerJoin(
      branchStaff,
      and(
        eq(branchStaff.branchId, floors.branchId),
        eq(branchStaff.userId, userId),
      ),
    )
    .leftJoin(
      published,
      and(
        eq(published.id, floors.publishedPlanId),
        eq(published.floorId, floors.id),
        eq(published.status, "published"),
      ),
    )
    .leftJoin(
      draft,
      and(eq(draft.floorId, floors.id), eq(draft.status, "draft")),
    )
    .leftJoin(users, eq(users.id, draft.updatedBy))
    .where(eq(floors.branchId, branchId))
    .orderBy(asc(floors.sortOrder), asc(floors.level), asc(floors.id));
}
export async function lockFloorPlanDraft(floorId: string, db: DalDatabase) {
  const [row] = await db
    .select({
      id: floorPlans.id,
      floorId: floorPlans.floorId,
      version: floorPlans.version,
      revision: floorPlans.revision,
    })
    .from(floorPlans)
    .where(and(eq(floorPlans.floorId, floorId), eq(floorPlans.status, "draft")))
    .for("update");
  return row ?? null;
}
export async function getFloorPlanDraftBase(floorId: string, db: DalDatabase) {
  const [row] = await db
    .select({
      id: floors.id,
      branchId: floors.branchId,
      publishedPlanId: floors.publishedPlanId,
      backgroundImage: floorPlans.backgroundImage,
    })
    .from(floors)
    .leftJoin(
      floorPlans,
      and(
        eq(floorPlans.id, floors.publishedPlanId),
        eq(floorPlans.floorId, floors.id),
        eq(floorPlans.status, "published"),
      ),
    )
    .where(eq(floors.id, floorId));
  return row ?? null;
}
export async function nextFloorPlanVersion(floorId: string, db: DalDatabase) {
  const [row] = await db
    .select({ version: max(floorPlans.version) })
    .from(floorPlans)
    .where(eq(floorPlans.floorId, floorId));
  return (row?.version ?? 0) + 1;
}
export async function insertFloorPlanDraft(
  input: {
    floorId: string;
    version: number;
    document: FloorPlanDocument;
    backgroundImage: string | null;
    userId: string;
    now: Date;
  },
  db: DalDatabase,
) {
  const [row] = await db
    .insert(floorPlans)
    .values({
      floorId: input.floorId,
      version: input.version,
      status: "draft",
      document: input.document,
      backgroundImage: input.backgroundImage,
      createdBy: input.userId,
      revision: 1,
      updatedAt: input.now,
      updatedBy: input.userId,
      createdAt: input.now,
    })
    .returning({
      planId: floorPlans.id,
      version: floorPlans.version,
      revision: floorPlans.revision,
    });
  if (!row) throw new Error("Plan draft insertion returned no row.");
  return row;
}
export async function updateFloorPlanDraft(
  input: {
    planId: string;
    revision: number;
    document: FloorPlanDocument;
    userId: string;
    now: Date;
  },
  db: DalDatabase,
) {
  const [row] = await db
    .update(floorPlans)
    .set({
      document: input.document,
      revision: sql`${floorPlans.revision} + 1`,
      updatedAt: input.now,
      updatedBy: input.userId,
    })
    .where(
      and(
        eq(floorPlans.id, input.planId),
        eq(floorPlans.status, "draft"),
        eq(floorPlans.revision, input.revision),
      ),
    )
    .returning({
      planId: floorPlans.id,
      version: floorPlans.version,
      revision: floorPlans.revision,
    });
  return row ?? null;
}
