import "server-only";

import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  ne,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { DalDatabase } from "@/lib/dal/database";
import { getDb } from "@/lib/db/client";
import {
  accessGrants,
  bookings,
  branches,
  floors,
  spacePhotos,
  spaces,
} from "@/lib/db/schema";

export async function listMyWeekBookings(
  { userId, start, end }: { userId: string; start: Date; end: Date },
  database: DalDatabase = getDb(),
) {
  const area = alias(spaces, "week_desk_area");
  return database
    .select({
      id: bookings.id,
      during: bookings.during,
      timezone: branches.timezone,
      branchId: branches.id,
      floorId: floors.id,
      spaceId: sql<string>`case when ${spaces.type} = 'desk' then ${area.id} else ${spaces.id} end`,
      spaceName: sql<string>`case when ${spaces.type} = 'desk' then ${area.name} else ${spaces.name} end`,
    })
    .from(bookings)
    .innerJoin(spaces, eq(spaces.id, bookings.spaceId))
    .leftJoin(
      area,
      and(
        eq(spaces.type, "desk"),
        eq(area.id, spaces.parentId),
        eq(area.type, "desk_area"),
        eq(area.floorId, spaces.floorId),
      ),
    )
    .innerJoin(floors, eq(floors.id, spaces.floorId))
    .innerJoin(branches, eq(branches.id, floors.branchId))
    .where(
      and(
        eq(bookings.userId, userId),
        eq(bookings.status, "confirmed"),
        sql`lower(${bookings.during}) >= ${start.toISOString()}::timestamptz`,
        sql`lower(${bookings.during}) < ${end.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(asc(sql`lower(${bookings.during})`), asc(bookings.id));
}

export async function listMySpaceBookingCounts(
  { userId, since }: { userId: string; since: Date },
  database: DalDatabase = getDb(),
) {
  return database
    .select({
      spaceId: bookings.spaceId,
      bookingCount: count(),
      latestStart: sql<string>`max(lower(${bookings.during}))`,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.userId, userId),
        eq(bookings.status, "confirmed"),
        sql`lower(${bookings.during}) >= ${since.toISOString()}::timestamptz`,
      ),
    )
    .groupBy(bookings.spaceId)
    .orderBy(
      desc(count()),
      desc(sql`max(lower(${bookings.during}))`),
      asc(bookings.spaceId),
    );
}

export async function listFrequentSpaceAccess(
  spaceIds: string[],
  database: DalDatabase = getDb(),
) {
  if (!spaceIds.length) return [];
  const floorGrants = alias(accessGrants, "frequent_floor_grants");
  const spaceGrants = alias(accessGrants, "frequent_space_grants");
  // 이름과 사진은 읽지 않고 허용 대상의 교집합을 먼저 판정한다.
  const rows = await database
    .select({
      id: spaces.id,
      access: spaces.access,
      floor: { branchId: floors.branchId, access: floors.access },
      floorTeamId: floorGrants.teamId,
      spaceTeamId: spaceGrants.teamId,
    })
    .from(spaces)
    .innerJoin(floors, eq(floors.id, spaces.floorId))
    .leftJoin(
      floorGrants,
      and(
        eq(floorGrants.targetType, "floor"),
        eq(floorGrants.targetId, floors.id),
      ),
    )
    .leftJoin(
      spaceGrants,
      and(
        eq(spaceGrants.targetType, "space"),
        eq(spaceGrants.targetId, spaces.id),
      ),
    )
    .where(
      and(
        inArray(spaces.id, spaceIds),
        eq(spaces.bookable, true),
        isNull(spaces.archivedAt),
        ne(spaces.type, "desk"),
      ),
    );
  const grouped = new Map<
    string,
    Pick<(typeof rows)[number], "id" | "access"> & {
      allowedTeamIds: string[];
      floor: (typeof rows)[number]["floor"] & { allowedTeamIds: string[] };
    }
  >();
  for (const { id, access, floor, floorTeamId, spaceTeamId } of rows) {
    let row = grouped.get(id);
    if (!row) {
      row = {
        id,
        access,
        allowedTeamIds: [],
        floor: { ...floor, allowedTeamIds: [] },
      };
      grouped.set(id, row);
    }
    if (floorTeamId && !row.floor.allowedTeamIds.includes(floorTeamId))
      row.floor.allowedTeamIds.push(floorTeamId);
    if (spaceTeamId && !row.allowedTeamIds.includes(spaceTeamId))
      row.allowedTeamIds.push(spaceTeamId);
  }
  return [...grouped.values()];
}

export async function getFrequentSpaceCards(
  allowedSpaceIds: string[],
  database: DalDatabase = getDb(),
) {
  if (!allowedSpaceIds.length) return [];
  return database
    .select({
      id: spaces.id,
      name: spaces.name,
      type: spaces.type,
      floorId: floors.id,
      floorName: floors.name,
      branchId: branches.id,
      branchName: branches.name,
      timezone: branches.timezone,
      photo: { path: spacePhotos.path, alt: spacePhotos.alt },
    })
    .from(spaces)
    .innerJoin(floors, eq(floors.id, spaces.floorId))
    .innerJoin(branches, eq(branches.id, floors.branchId))
    .leftJoin(
      spacePhotos,
      and(eq(spacePhotos.spaceId, spaces.id), eq(spacePhotos.sortOrder, 0)),
    )
    .where(
      and(
        inArray(spaces.id, allowedSpaceIds),
        eq(spaces.bookable, true),
        isNull(spaces.archivedAt),
        ne(spaces.type, "desk"),
      ),
    );
}
