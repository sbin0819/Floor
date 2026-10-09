import "server-only";

import { sql, type SQL } from "drizzle-orm";
import type { ReportSummary } from "@/features/admin/reports-types";

export function branchReportScope(
  branchId: string | SQL,
  roomId: SQL,
): SQL<boolean> {
  return sql<boolean>`exists(select 1 from chat_rooms scope_room
    left join chat_spaces scope_space on scope_space.id = scope_room.space_id
    left join bookings scope_booking on scope_booking.id = scope_room.booking_id
    left join spaces scope_booking_space on scope_booking_space.id = scope_booking.space_id
    left join floors scope_floor on scope_floor.id = scope_booking_space.floor_id
    where scope_room.id = ${roomId} and (
      (scope_space.kind = 'branch' and scope_space.branch_id = ${branchId}::uuid)
      or (scope_room.kind = 'meeting' and scope_floor.branch_id = ${branchId}::uuid)))`;
}

export function openBranchReportSummary(
  branchId: string | SQL,
): SQL<ReportSummary> {
  return sql<ReportSummary>`(select jsonb_build_object('count', count(distinct open_report.message_id)::int,
    'oldestAt', min(open_report.created_at))
    from reports open_report join messages open_message on open_message.id = open_report.message_id
    where open_report.resolved_at is null and open_report.message_id is not null
      and ${branchReportScope(branchId, sql`open_message.room_id`)})`;
}
