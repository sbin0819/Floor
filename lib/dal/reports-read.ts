import "server-only";

import { cache } from "react";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "@/lib/db/client";
import { branches, branchStaff, users } from "@/lib/db/schema";
import type { AvatarSource } from "@/lib/avatar";
import type {
  BranchReportGroup,
  ReportResolution,
  ReportSummary,
} from "@/features/admin/reports-types";
import type { DalDatabase } from "./database";
import { avatarJson } from "./avatar";
import {
  branchReportScope,
  openBranchReportSummary,
} from "./branch-report-scope";

type Scope = { branchId: string; userId: string };
function assigned(scope: Scope) {
  return sql`exists(select 1 from branch_staff report_staff where report_staff.branch_id = ${scope.branchId}::uuid and report_staff.user_id = ${scope.userId}::uuid)`;
}
async function readBranch(
  userId: string,
  branchId: string,
  db: DalDatabase = getDb(),
) {
  const [row] = await db
    .select({
      id: branches.id,
      name: branches.name,
      timezone: branches.timezone,
      loungeSpaceId: sql<
        string | null
      >`(select id from chat_spaces where kind = 'branch' and branch_id = ${branches.id})`,
    })
    .from(branches)
    .innerJoin(
      branchStaff,
      and(
        eq(branchStaff.branchId, branches.id),
        eq(branchStaff.userId, userId),
      ),
    )
    .where(eq(branches.id, branchId));
  return row ?? null;
}
const cachedBranch = cache((userId: string, branchId: string) =>
  readBranch(userId, branchId),
);
export function readReportBranch(scope: Scope, db?: DalDatabase) {
  return db === undefined
    ? cachedBranch(scope.userId, scope.branchId)
    : readBranch(scope.userId, scope.branchId, db);
}
export async function readOpenReportSummary(
  scope: Scope,
  db: DalDatabase = getDb(),
): Promise<ReportSummary> {
  const [row] = await db
    .select({ summary: openBranchReportSummary(scope.branchId) })
    .from(branches)
    .where(and(eq(branches.id, scope.branchId), assigned(scope)));
  return row?.summary ?? { count: 0, oldestAt: null };
}
function names(messageId: SQL, authorId: SQL, authorName: SQL) {
  return sql`coalesce((select jsonb_object_agg(named.id, named.name)
    from message_mentions mention join users named on named.id = mention.user_id
    where mention.message_id = ${messageId}), '{}'::jsonb)
    || case when ${authorId} is null then '{}'::jsonb else jsonb_build_object(${authorId}, ${authorName}) end`;
}
export type BranchReportRow = {
  messageId: string;
  roomKind: BranchReportGroup["roomKind"];
  roomName: string | null;
  spaceName: string | null;
  bookingStart: string | null;
  authorId: string;
  authorName: string;
  authorUsername: string | null;
  authorAvatar: AvatarSource;
  authorIsStaff: boolean;
  body: string;
  deleted: boolean;
  names: Record<string, string>;
  count: number;
  oldestAt: string;
  details: string[];
  reasons: BranchReportGroup["reasons"];
  context: {
    authorName: string;
    body: string;
    names: Record<string, string>;
  }[];
  resolution: ReportResolution | null;
  resolvedByName: string | null;
  resolvedAt: string | null;
};
export function listBranchReportGroups(
  input: Scope & { tab: "open" | "resolved"; cutoff: Date; now: Date },
  db: DalDatabase = getDb(),
) {
  const filter =
    input.tab === "open"
      ? sql`r.resolved_at is null`
      : sql`r.resolved_at >= ${input.cutoff.toISOString()}::timestamptz and r.resolved_at <= ${input.now.toISOString()}::timestamptz`;
  const order =
    input.tab === "open"
      ? sql`oldest_at, message_id`
      : sql`resolved_at desc, message_id, resolved_by, resolution`;
  const limit = input.tab === "resolved" ? sql`limit 50` : sql``;
  return db.select({ row: sql<BranchReportRow>`to_jsonb(result)` }).from(sql`(
    with scoped as (
      select r.id, r.message_id, r.reason, r.detail, r.created_at, r.resolved_at, r.resolved_by, r.resolution
      from reports r join messages m on m.id = r.message_id
      where r.message_id is not null and ${filter}
        and ${branchReportScope(input.branchId, sql`m.room_id`)} and ${assigned(input)}
    ), grouped as (
      select message_id, resolved_at, resolved_by, resolution, count(*)::int as count, min(created_at) as oldest_at,
        coalesce(array_agg(detail order by created_at, id) filter(where detail is not null and detail <> ''), array[]::text[]) as details,
        jsonb_build_array(
          jsonb_build_object('reason','spam','count',count(*) filter(where reason = 'spam')),
          jsonb_build_object('reason','harassment','count',count(*) filter(where reason = 'harassment')),
          jsonb_build_object('reason','inappropriate','count',count(*) filter(where reason = 'inappropriate')),
          jsonb_build_object('reason','other','count',count(*) filter(where reason = 'other'))
        ) as reasons
      from scoped group by message_id, resolved_at, resolved_by, resolution
      order by ${order} ${limit}
    )
    select g.message_id as "messageId", room.kind as "roomKind", room.name as "roomName",
      booked_space.name as "spaceName", lower(booking.during) as "bookingStart",
      u.id as "authorId", u.name as "authorName", u.username as "authorUsername", ${avatarJson(alias(users, "u"))} as "authorAvatar",
      exists(select 1 from branch_staff author_staff where author_staff.user_id = u.id and author_staff.branch_id = ${input.branchId}::uuid) as "authorIsStaff",
      case when m.deleted_at is null then m.body else '' end as body, m.deleted_at is not null as deleted,
      ${names(sql`m.id`, sql`u.id`, sql`u.name`)} as names,
      g.count, g.oldest_at as "oldestAt", g.details, g.reasons,
      case when room.kind = 'meeting' then '[]'::jsonb else coalesce((select jsonb_agg(context_row order by context_row.seq) from (
        select previous.seq, previous_author.name as "authorName", previous.body,
          ${names(sql`previous.id`, sql`previous_author.id`, sql`previous_author.name`)} as names
        from messages previous join users previous_author on previous_author.id = previous.author_id
        where previous.room_id = room.id and previous.seq < m.seq and previous.kind = 'text' and previous.deleted_at is null
        order by previous.seq desc limit 2
      ) context_row), '[]'::jsonb) end as context,
      g.resolution, resolver.name as "resolvedByName", g.resolved_at as "resolvedAt"
    from grouped g join messages m on m.id = g.message_id
    join chat_rooms room on room.id = m.room_id join users u on u.id = m.author_id
    left join bookings booking on booking.id = room.booking_id
    left join spaces booked_space on booked_space.id = booking.space_id
    left join users resolver on resolver.id = g.resolved_by
    order by ${input.tab === "open" ? sql`g.oldest_at, g.message_id` : sql`g.resolved_at desc, g.message_id, g.resolved_by, g.resolution`}
  ) result`);
}
