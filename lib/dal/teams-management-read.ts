import "server-only";

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "@/lib/db/client";
import {
  accessGrants,
  bookings,
  branches,
  chatSpaces,
  floors,
  spaces,
  teamMembers,
  teams,
  users,
} from "@/lib/db/schema";
import { avatarColumns } from "./avatar";
import { toAvatar } from "@/lib/avatar";
import type { DalDatabase } from "./database";
import type { TeamBookingView } from "@/features/teams/types";
import { teamDisplayName } from "./team-name";

// 병렬로 읽더라도 소속 없는 사람의 예약은 SQL에서 반환하지 않는다.
function memberOfTeam(teamId: string, userId: string) {
  return sql`exists (select 1 from teams visible_team join team_members viewer on viewer.team_id = visible_team.id
    where visible_team.id = ${teamId}::uuid and visible_team.deleted_at is null and viewer.user_id = ${userId}::uuid)`;
}

export async function readTeamPageHeader(
  teamId: string,
  now: Date,
  database: DalDatabase = getDb(),
) {
  const [row] = await database
    .select({
      id: teams.id,
      name: teamDisplayName(teams),
      homeBranchName: branches.name,
      space: { id: chatSpaces.id, iconColor: chatSpaces.iconColor },
      upcomingBookingCount: sql<number>`(select count(*)::int from bookings b where b.team_id = ${teams.id} and b.status = 'confirmed' and upper(b.during) > ${now.toISOString()}::timestamptz)`,
    })
    .from(teams)
    .leftJoin(branches, eq(branches.id, teams.homeBranchId))
    .leftJoin(
      chatSpaces,
      and(
        eq(chatSpaces.teamId, teams.id),
        eq(chatSpaces.kind, "team"),
        isNull(chatSpaces.deletedAt),
      ),
    )
    .where(and(eq(teams.id, teamId), isNull(teams.deletedAt)));
  return row ?? null;
}

export async function readTeamSettings(
  teamId: string,
  database: DalDatabase = getDb(),
) {
  const [row] = await database
    .select({
      homeBranchId: teams.homeBranchId,
      headcount: teams.headcount,
      contactPhone: teams.contactPhone,
    })
    .from(teams)
    .where(and(eq(teams.id, teamId), isNull(teams.deletedAt)));
  return row ?? null;
}

export async function listPublicTeamMembers(
  teamId: string,
  database: DalDatabase = getDb(),
) {
  const rows = await database
    .select({
      userId: users.id,
      name: users.name,
      username: users.username,
      avatar: avatarColumns(users),
      role: teamMembers.role,
      title: teamMembers.title,
    })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(and(eq(teamMembers.teamId, teamId), isNull(teams.deletedAt)))
    .orderBy(asc(teamMembers.role), asc(users.name), asc(users.id));
  return rows.map(({ avatar, ...row }) => ({
    ...row,
    avatar: toAvatar(avatar),
  }));
}

export async function readTeamBookingRows(
  input: {
    teamId: string;
    userId: string;
    view: TeamBookingView;
    branchId?: string;
    now: Date;
  },
  database: DalDatabase = getDb(),
) {
  const area = alias(spaces, "team_booking_area");
  const now = input.now.toISOString();
  const cutoff = sql`(((${now}::timestamptz at time zone ${branches.timezone})::date - 30)::timestamp at time zone ${branches.timezone})`;
  const condition =
    input.view === "upcoming"
      ? sql`${bookings.status} = 'confirmed' and upper(${bookings.during}) > ${now}::timestamptz`
      : input.view === "past"
        ? sql`${bookings.status} = 'confirmed' and upper(${bookings.during}) <= ${now}::timestamptz and lower(${bookings.during}) >= ${cutoff}`
        : sql`${bookings.status} = 'cancelled' and ${bookings.cancelledAt} >= ${cutoff}`;
  const rows = await database
    .select({
      id: bookings.id,
      userId: bookings.userId,
      teamId: bookings.teamId,
      during: bookings.during,
      title: bookings.title,
      kind: sql<
        "time" | "desk"
      >`case when ${spaces.type} = 'desk' then 'desk' else 'time' end`,
      spaceName: spaces.name,
      floorName: floors.name,
      branchName: branches.name,
      branchId: branches.id,
      timezone: branches.timezone,
      restricted: sql<boolean>`${floors.access} = 'teams' or coalesce(${area.access}, ${spaces.access}) = 'teams'`,
      booker: { id: users.id, name: users.name },
      avatar: avatarColumns(users),
      participantCount: sql<number>`(select count(*)::int from booking_participants p where p.booking_id = ${bookings.id})`,
      canChat: sql<boolean>`${spaces.type} <> 'desk' and (${bookings.userId} = ${input.userId}::uuid or exists (select 1 from booking_participants p where p.booking_id = ${bookings.id} and p.user_id = ${input.userId}::uuid))`,
    })
    .from(bookings)
    .innerJoin(spaces, eq(spaces.id, bookings.spaceId))
    .leftJoin(area, and(eq(spaces.type, "desk"), eq(area.id, spaces.parentId)))
    .innerJoin(floors, eq(floors.id, spaces.floorId))
    .innerJoin(branches, eq(branches.id, floors.branchId))
    .innerJoin(users, eq(users.id, bookings.userId))
    .where(
      and(
        eq(bookings.teamId, input.teamId),
        memberOfTeam(input.teamId, input.userId),
        condition,
        input.branchId ? eq(branches.id, input.branchId) : undefined,
      ),
    )
    .orderBy(
      input.view === "upcoming"
        ? asc(sql`lower(${bookings.during})`)
        : input.view === "cancelled"
          ? desc(bookings.cancelledAt)
          : desc(sql`lower(${bookings.during})`),
      asc(bookings.id),
    )
    .limit(100);
  return rows.map(({ avatar, booker, ...row }) => ({
    ...row,
    restricted: Boolean(row.restricted),
    booker: { ...booker, avatar: toAvatar(avatar) },
  }));
}

export function listTeamBookingBranches(
  teamId: string,
  userId: string,
  database: DalDatabase = getDb(),
) {
  return database
    .select({ id: branches.id, name: branches.name })
    .from(bookings)
    .innerJoin(spaces, eq(spaces.id, bookings.spaceId))
    .innerJoin(floors, eq(floors.id, spaces.floorId))
    .innerJoin(branches, eq(branches.id, floors.branchId))
    .where(and(eq(bookings.teamId, teamId), memberOfTeam(teamId, userId)))
    .groupBy(branches.id, branches.name)
    .orderBy(asc(branches.name), asc(branches.id));
}

export async function readTeamRemovalPreview(
  teamId: string,
  userId: string,
  now: Date,
  database: DalDatabase = getDb(),
) {
  const condition = and(
    eq(bookings.teamId, teamId),
    eq(bookings.userId, userId),
    eq(bookings.status, "confirmed"),
    sql`lower(${bookings.during}) > ${now.toISOString()}::timestamptz`,
  );
  const rows = await database
    .select({
      id: bookings.id,
      during: bookings.during,
      spaceName: spaces.name,
      floorName: floors.name,
      branchName: branches.name,
      timezone: branches.timezone,
      count: sql<number>`count(*) over()::int`,
    })
    .from(bookings)
    .innerJoin(spaces, eq(spaces.id, bookings.spaceId))
    .innerJoin(floors, eq(floors.id, spaces.floorId))
    .innerJoin(branches, eq(branches.id, floors.branchId))
    .where(condition)
    .orderBy(asc(sql`lower(${bookings.during})`), asc(bookings.id))
    .limit(1);
  return { bookingCount: rows[0]?.count ?? 0, firstBooking: rows[0] ?? null };
}

export async function readTeamDeleteCounts(
  teamId: string,
  now: Date,
  database: DalDatabase = getDb(),
) {
  const [row] = await database
    .select({
      memberCount: sql<number>`(select count(*)::int from team_members m where m.team_id = ${teamId}::uuid)`,
      inviteCount: sql<number>`(select count(*)::int from team_invites i where i.team_id = ${teamId}::uuid and i.accepted_at is null and i.declined_at is null and i.revoked_at is null)`,
      requestCount: sql<number>`(select count(*)::int from team_join_requests r where r.team_id = ${teamId}::uuid and r.status = 'pending')`,
      bookingCount: sql<number>`(select count(*)::int from bookings b where b.team_id = ${teamId}::uuid and b.status = 'confirmed' and lower(b.during) > ${now.toISOString()}::timestamptz)`,
    })
    .from(teams)
    .where(and(eq(teams.id, teamId), isNull(teams.deletedAt)));
  return row ?? null;
}

export function listTeamAccessGrants(
  teamId: string,
  database: DalDatabase = getDb(),
) {
  return database
    .select({
      targetType: accessGrants.targetType,
      floorId: floors.id,
      spaceId: spaces.id,
      branchName: branches.name,
      floorName: floors.name,
      spaceName: spaces.name,
    })
    .from(accessGrants)
    .leftJoin(
      spaces,
      and(
        eq(accessGrants.targetType, "space"),
        eq(spaces.id, accessGrants.targetId),
      ),
    )
    .innerJoin(
      floors,
      sql`${floors.id} = case when ${accessGrants.targetType} = 'floor' then ${accessGrants.targetId} else ${spaces.floorId} end`,
    )
    .innerJoin(branches, eq(branches.id, floors.branchId))
    .where(eq(accessGrants.teamId, teamId))
    .orderBy(
      asc(branches.name),
      asc(floors.sortOrder),
      asc(spaces.name),
      asc(accessGrants.id),
    );
}
