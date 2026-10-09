import "server-only";

import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "@/lib/db/client";
import {
  bookings,
  branchStaff,
  chatRooms,
  chatSpaceMembers,
  chatSpaces,
  floors,
  messages,
  reports,
  spaces,
} from "@/lib/db/schema";
import type { ReportResolution } from "@/features/admin/report-schema";
import { branchReportScope } from "./branch-report-scope";
import type { DalDatabase } from "./database";

export async function readReportTarget(
  messageId: string,
  operatorId: string,
  database: DalDatabase = getDb(),
) {
  const bookingSpace = alias(spaces, "report_booking_space");
  const bookingFloor = alias(floors, "report_booking_floor");
  const branchId = sql<string>`case when ${chatSpaces.kind} = 'branch' then ${chatSpaces.branchId}
    when ${chatRooms.kind} = 'meeting' then ${bookingFloor.branchId} end`;
  const [row] = await database
    .select({
      messageId: messages.id,
      authorId: messages.authorId,
      roomId: chatRooms.id,
      roomKind: chatRooms.kind,
      spaceId: chatRooms.spaceId,
      branchId,
      authorIsStaff: sql<boolean>`exists (select 1 from ${branchStaff}
        where ${branchStaff}.branch_id = ${branchId} and ${branchStaff}.user_id = ${messages.authorId})`,
    })
    .from(messages)
    .innerJoin(chatRooms, eq(chatRooms.id, messages.roomId))
    .leftJoin(chatSpaces, eq(chatSpaces.id, chatRooms.spaceId))
    .leftJoin(bookings, eq(bookings.id, chatRooms.bookingId))
    .leftJoin(bookingSpace, eq(bookingSpace.id, bookings.spaceId))
    .leftJoin(bookingFloor, eq(bookingFloor.id, bookingSpace.floorId))
    .where(
      and(
        eq(messages.id, messageId),
        eq(messages.kind, "text"),
        isNotNull(messages.authorId),
        branchReportScope(branchId, sql`${chatRooms.id}`),
        sql`exists (select 1 from ${branchStaff} where ${branchStaff}.branch_id = ${branchId}
          and ${branchStaff}.user_id = ${operatorId}::uuid)`,
      ),
    );
  return row?.authorId ? { ...row, authorId: row.authorId } : null;
}

export async function lockReportSpace(
  input: { spaceId: string; branchId: string; ban: boolean },
  database: DalDatabase,
) {
  const [row] = await database
    .select({ id: chatSpaces.id })
    .from(chatSpaces)
    .where(
      and(
        eq(chatSpaces.id, input.spaceId),
        eq(chatSpaces.kind, "branch"),
        eq(chatSpaces.branchId, input.branchId),
      ),
    )
    .for(input.ban ? "update" : "key share");
  return !!row;
}

export async function lockReportMember(
  spaceId: string,
  userId: string,
  database: DalDatabase,
) {
  await database
    .select({ userId: chatSpaceMembers.userId })
    .from(chatSpaceMembers)
    .where(
      and(
        eq(chatSpaceMembers.spaceId, spaceId),
        eq(chatSpaceMembers.userId, userId),
      ),
    )
    .for("update");
}

export async function lockOpenMessageReports(
  messageId: string,
  database: DalDatabase,
) {
  return database
    .select({ id: reports.id })
    .from(reports)
    .where(and(eq(reports.messageId, messageId), isNull(reports.resolvedAt)))
    .orderBy(reports.id)
    .for("update");
}

export async function resolveMessageReports(
  input: {
    ids: readonly string[];
    messageId: string;
    operatorId: string;
    resolution: ReportResolution;
    now: Date;
  },
  database: DalDatabase,
) {
  if (!input.ids.length) return [];
  return database
    .update(reports)
    .set({
      resolvedAt: input.now,
      resolvedBy: input.operatorId,
      resolution: input.resolution,
    })
    .where(
      and(
        inArray(reports.id, [...input.ids]),
        eq(reports.messageId, input.messageId),
        isNull(reports.resolvedAt),
      ),
    )
    .returning({ id: reports.id });
}
