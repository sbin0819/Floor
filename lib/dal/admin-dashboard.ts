import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "@/lib/db/client";
import {
  bookings,
  branchStaff,
  floorPlans,
  floors,
  spaceBlocks,
  spaces,
  teams,
  users,
} from "@/lib/db/schema";
import type { UtilizationRange } from "@/features/admin/utilization";
import type { ReportSummary } from "@/features/admin/reports-types";
import type { DalDatabase } from "./database";
import { avatarColumns } from "./avatar";
import { teamDisplayName } from "./team-name";
import { openBranchReportSummary } from "./branch-report-scope";

type DashboardScope = {
  branchId: string;
  userId: string;
  floorId?: string | null;
  canReadReports?: boolean;
};
function assigned(scope: DashboardScope) {
  return sql`exists(select 1 from ${branchStaff} where ${branchStaff.userId} = ${scope.userId}::uuid and ${branchStaff.branchId} = ${scope.branchId}::uuid)`;
}
function inScope(scope: DashboardScope) {
  return and(
    eq(floors.branchId, scope.branchId),
    scope.floorId ? eq(floors.id, scope.floorId) : undefined,
    assigned(scope),
  );
}

export function listDashboardFloors(
  scope: DashboardScope,
  database: DalDatabase = getDb(),
) {
  return database
    .select({
      id: floors.id,
      name: floors.name,
      level: floors.level,
      plan: { id: floorPlans.id, version: floorPlans.version },
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
    .where(inScope({ ...scope, floorId: null }))
    .orderBy(asc(floors.sortOrder), asc(floors.level), asc(floors.id));
}

export function listDashboardSpaceScope(
  scope: DashboardScope,
  database: DalDatabase = getDb(),
) {
  return database
    .select({
      id: spaces.id,
      floorId: spaces.floorId,
      parentId: spaces.parentId,
      type: spaces.type,
      bookable: spaces.bookable,
      archivedAt: spaces.archivedAt,
    })
    .from(spaces)
    .innerJoin(floors, eq(floors.id, spaces.floorId))
    .where(inScope(scope));
}

export function readDashboardUtilization(
  {
    scope,
    spaceIds,
    current,
    previous,
  }: {
    scope: DashboardScope;
    spaceIds: readonly string[];
    current: readonly UtilizationRange[];
    previous: readonly UtilizationRange[];
  },
  database: DalDatabase = getDb(),
) {
  const ranges = JSON.stringify([
    ...current.map((range) => ({ ...range, period: "current" })),
    ...previous.map((range) => ({ ...range, period: "previous" })),
  ]);
  // 운영 구간은 TypeScript의 시간대 규칙으로 만든다. 점검의 합집합을 먼저
  // 빼야 구역·좌석 점검의 교집합을 두 번 빼거나 예약률이 100%를 넘지 않는다.
  return database.select({
    id: sql<string>`utilization.id`,
    name: sql<string>`utilization.name`,
    operatingMinutes: sql<number>`utilization.operating_minutes`,
    bookedMinutes: sql<number>`utilization.booked_minutes`,
    previousOperatingMinutes: sql<number>`utilization.previous_operating_minutes`,
    previousBookedMinutes: sql<number>`utilization.previous_booked_minutes`,
  }).from(sql`(
    with periods(period) as (values ('current'), ('previous')),
    openings as (
      select p.period, coalesce(range_agg(tstzrange(r.start::timestamptz, r.end::timestamptz, '[)'))
        filter (where r.start is not null), '{}'::tstzmultirange) as ranges
      from periods p left join jsonb_to_recordset(${ranges}::jsonb)
        as r(period text, start text, "end" text) on r.period = p.period
      group by p.period
    ),
    selected as (
      select s.id, s.name, s.parent_id, s.type from spaces s inner join floors f on f.id = s.floor_id
      where s.id in (select jsonb_array_elements_text(${JSON.stringify(spaceIds)}::jsonb)::uuid)
        and f.branch_id = ${scope.branchId}::uuid and ${assigned(scope)}
    ),
    measures as (
      select s.id, s.name, o.period,
        coalesce((select sum(extract(epoch from upper(v) - lower(v))) / 60 from unnest(a.ranges) v), 0)::float8 as operating_minutes,
        coalesce((select sum(extract(epoch from upper(v) - lower(v))) / 60 from unnest(a.ranges * b.ranges) v), 0)::float8 as booked_minutes
      from selected s cross join openings o
      cross join lateral (
        select o.ranges - coalesce(range_agg(bl.during), '{}'::tstzmultirange) as ranges
        from space_blocks bl where (bl.space_id = s.id or (s.type = 'desk' and bl.space_id = s.parent_id)) and bl.during && o.ranges
      ) a
      cross join lateral (
        select coalesce(range_agg(bk.during), '{}'::tstzmultirange) as ranges
        from bookings bk where bk.space_id = s.id and bk.status = 'confirmed' and bk.during && o.ranges
      ) b
    )
    select id, name,
      max(operating_minutes) filter (where period = 'current') as operating_minutes,
      max(booked_minutes) filter (where period = 'current') as booked_minutes,
      max(operating_minutes) filter (where period = 'previous') as previous_operating_minutes,
      max(booked_minutes) filter (where period = 'previous') as previous_booked_minutes
    from measures group by id, name
  ) utilization`);
}

export async function readDashboardCards(
  scope: DashboardScope,
  day: UtilizationRange,
  now: Date,
  database: DalDatabase = getDb(),
) {
  const current = now.toISOString();
  const [row] = await database
    .select({
      bookingCount: sql<number>`count(*)::int`,
      ongoingCount: sql<number>`count(*) filter (where ${bookings.during} @> ${current}::timestamptz)::int`,
      remainingCount: sql<number>`count(*) filter (where lower(${bookings.during}) > ${current}::timestamptz)::int`,
      maintenanceCount: sql<number>`(select count(*)::int from space_blocks bl inner join spaces s on s.id = bl.space_id inner join floors f on f.id = s.floor_id
      where f.branch_id = ${scope.branchId}::uuid and (${scope.floorId ?? null}::uuid is null or f.id = ${scope.floorId ?? null}::uuid)
        and bl.during @> ${current}::timestamptz and ${assigned(scope)})`,
      reportSummary: scope.canReadReports
        ? sql<ReportSummary | null>`case when ${assigned(scope)} then ${openBranchReportSummary(scope.branchId)} else null end`
        : sql<null>`null`,
    })
    .from(bookings)
    .innerJoin(spaces, eq(spaces.id, bookings.spaceId))
    .innerJoin(floors, eq(floors.id, spaces.floorId))
    .where(
      and(
        inScope(scope),
        eq(bookings.status, "confirmed"),
        sql`lower(${bookings.during}) >= ${day.start}::timestamptz and lower(${bookings.during}) < ${day.end}::timestamptz`,
      ),
    );
  return row!;
}

const parent = alias(spaces, "parent_space");
function displayedSpaceName() {
  return sql<string>`case when ${spaces.type} = 'desk' then '좌석 ' || ${spaces.name} || coalesce(' · ' || ${parent.name}, '') else ${spaces.name} end`;
}
export function listDashboardUpcoming(
  scope: DashboardScope,
  now: Date,
  database: DalDatabase = getDb(),
) {
  return database
    .select({
      id: bookings.id,
      during: bookings.during,
      spaceName: displayedSpaceName(),
      floorName: floors.name,
      bookerName: users.name,
      bookerAvatar: avatarColumns(users),
      teamName: sql<string | null>`${teamDisplayName(teams)}`,
      attendeeCount: sql<number>`coalesce(${bookings.attendeeCount}, 1 + (select count(*)::int from booking_participants p where p.booking_id = ${bookings}.id))`,
    })
    .from(bookings)
    .innerJoin(spaces, eq(spaces.id, bookings.spaceId))
    .innerJoin(floors, eq(floors.id, spaces.floorId))
    .innerJoin(users, eq(users.id, bookings.userId))
    .leftJoin(teams, eq(teams.id, bookings.teamId))
    .leftJoin(parent, eq(parent.id, spaces.parentId))
    .where(
      and(
        inScope(scope),
        eq(bookings.status, "confirmed"),
        sql`lower(${bookings.during}) >= ${now.toISOString()}::timestamptz and lower(${bookings.during}) < ${new Date(now.getTime() + 2 * 60 * 60_000).toISOString()}::timestamptz`,
      ),
    )
    .orderBy(sql`lower(${bookings.during})`, asc(bookings.id))
    .limit(4);
}

export function listDashboardMaintenance(
  scope: DashboardScope,
  now: Date,
  until: Date,
  database: DalDatabase = getDb(),
) {
  return database
    .select({
      id: spaceBlocks.id,
      during: spaceBlocks.during,
      reason: spaceBlocks.reason,
      spaceName: displayedSpaceName(),
      floorName: floors.name,
    })
    .from(spaceBlocks)
    .innerJoin(spaces, eq(spaces.id, spaceBlocks.spaceId))
    .innerJoin(floors, eq(floors.id, spaces.floorId))
    .leftJoin(parent, eq(parent.id, spaces.parentId))
    .where(
      and(
        inScope(scope),
        sql`upper(${spaceBlocks.during}) > ${now.toISOString()}::timestamptz and lower(${spaceBlocks.during}) < ${until.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(
      sql`case when lower(${spaceBlocks.during}) <= ${now.toISOString()}::timestamptz then 0 else 1 end`,
      sql`lower(${spaceBlocks.during})`,
      asc(spaceBlocks.id),
    );
}
