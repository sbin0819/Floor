import "server-only";

import { cache } from "react";
import { and, asc, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  announcements,
  bookingParticipants,
  bookings,
  branches,
  branchStaff,
  chatRooms,
  chatSpaceMembers,
  chatSpaces,
  floors,
  spaces,
} from "@/lib/db/schema";
import type {
  AnnouncementAudience,
  AnnouncementFloor,
  LoungeAvailability,
} from "@/features/admin/announcement-types";
import type { DalDatabase } from "./database";

type OperatorScope = { branchId: string; operatorId: string };
function assigned(input: OperatorScope) {
  return sql`exists(select 1 from ${branchStaff} where ${branchStaff.branchId} = ${input.branchId}::uuid and ${branchStaff.userId} = ${input.operatorId}::uuid)`;
}
async function readBranch(
  input: OperatorScope,
  database: DalDatabase = getDb(),
) {
  const rows = await database
    .select({
      branch: {
        id: branches.id,
        name: branches.name,
        timezone: branches.timezone,
      },
      floor: { id: floors.id },
      space: { id: spaces.id },
    })
    .from(branches)
    .leftJoin(floors, eq(floors.branchId, branches.id))
    .leftJoin(spaces, eq(spaces.floorId, floors.id))
    .where(and(eq(branches.id, input.branchId), assigned(input)));
  if (!rows[0]) return null;
  const targets = new Map<string, { id: string; spaces: { id: string }[] }>();
  for (const row of rows) {
    if (!row.floor) continue;
    let floor = targets.get(row.floor.id);
    if (!floor) {
      floor = { ...row.floor, spaces: [] };
      targets.set(row.floor.id, floor);
    }
    if (row.space) floor.spaces.push(row.space);
  }
  return { branch: rows[0].branch, floors: [...targets.values()] };
}
const cachedBranch = cache((operatorId: string, branchId: string) =>
  readBranch({ operatorId, branchId }),
);

export function readAnnouncementBranch(
  input: OperatorScope & { audience?: AnnouncementAudience | null },
  database?: DalDatabase,
) {
  // 목록과 RSC 미리보기의 같은 지점 메타데이터만 요청 안에서 공유해요.
  return database === undefined
    ? cachedBranch(input.operatorId, input.branchId)
    : readBranch(input, database);
}

export async function listAnnouncementFloors(
  input: OperatorScope,
  database: DalDatabase = getDb(),
): Promise<AnnouncementFloor[]> {
  const rows = await database
    .select({
      floor: { id: floors.id, name: floors.name },
      space: { id: spaces.id, name: spaces.name, type: spaces.type },
    })
    .from(floors)
    .leftJoin(spaces, eq(spaces.floorId, floors.id))
    .where(and(eq(floors.branchId, input.branchId), assigned(input)))
    .orderBy(
      asc(floors.sortOrder),
      asc(floors.level),
      asc(floors.id),
      asc(spaces.name),
      asc(spaces.id),
    );
  const result = new Map<string, AnnouncementFloor>();
  for (const row of rows) {
    let floor = result.get(row.floor.id);
    if (!floor) {
      floor = { ...row.floor, spaces: [] };
      result.set(floor.id, floor);
    }
    if (row.space) floor.spaces.push(row.space);
  }
  return [...result.values()];
}
export type LoungeAvailabilityDetails = LoungeAvailability & {
  spaceId: string | null;
  roomId: string | null;
};
async function readLoungeAvailability(
  input: OperatorScope,
  database: DalDatabase = getDb(),
): Promise<LoungeAvailabilityDetails> {
  const [row] = await database
    .select({
      spaceId: chatSpaces.id,
      roomId: sql<
        string | null
      >`(select r.id from ${chatRooms} r where r.space_id = ${chatSpaces}.id and r.kind = 'text' and r.name = '공지' and r.admin_only and r.archived_at is null order by r.created_at, r.id limit 1)`,
      status: sql<
        "active" | "banned" | null
      >`(select m.status from ${chatSpaceMembers} m where m.space_id = ${chatSpaces}.id and m.user_id = ${input.operatorId}::uuid)`,
      memberCount: sql<number>`(select count(*)::int from ${chatSpaceMembers} m where m.space_id = ${chatSpaces}.id and m.status = 'active')`,
      joinedCount: sql<number>`(select count(*)::int from ${chatSpaceMembers} m join ${chatSpaces} s on s.id = m.space_id where m.user_id = ${input.operatorId}::uuid and m.status = 'active' and s.kind in ('branch','community') and s.deleted_at is null)`,
    })
    .from(chatSpaces)
    .where(
      and(
        eq(chatSpaces.branchId, input.branchId),
        eq(chatSpaces.kind, "branch"),
        isNull(chatSpaces.deletedAt),
        assigned(input),
      ),
    )
    .limit(1);
  const reason: LoungeAvailability["reason"] = !row?.roomId
    ? "missing_channel"
    : row.status === "banned"
      ? "banned"
      : row.status !== "active" && row.joinedCount >= 100
        ? "space_limit"
        : null;
  return {
    available: reason === null,
    reason,
    memberCount: row?.memberCount ?? 0,
    spaceId: row?.spaceId ?? null,
    roomId: row?.roomId ?? null,
  };
}
const cachedLounge = cache((operatorId: string, branchId: string) =>
  readLoungeAvailability({ operatorId, branchId }),
);
export function loungeAvailability(
  input: OperatorScope,
  database?: DalDatabase,
) {
  return database === undefined
    ? cachedLounge(input.operatorId, input.branchId)
    : readLoungeAvailability(input, database);
}

export type AnnouncementRecipientsInput = OperatorScope & {
  floorId: string | null;
  spaceId: string | null;
  start: Date;
  end: Date;
};
function recipientQuery(input: AnnouncementRecipientsInput) {
  const floor = input.floorId ? sql`and f.id = ${input.floorId}::uuid` : sql``;
  const space = input.spaceId
    ? sql`and (s.id = ${input.spaceId}::uuid or (
    s.parent_id = ${input.spaceId}::uuid and s.type = 'desk'
    and exists(select 1 from ${spaces} area where area.id = ${input.spaceId}::uuid and area.type = 'desk_area' and area.floor_id = s.floor_id)))`
    : sql``;
  // 종료된 예약도 그날의 공지를 받아야 하므로 현재 시각으로 범위를 더 줄이지 않아요.
  return sql`with matching as (
    select b.id, b.user_id from ${bookings} b
      join ${spaces} s on s.id = b.space_id join ${floors} f on f.id = s.floor_id
    where f.branch_id = ${input.branchId}::uuid and b.status = 'confirmed'
      and b.during && tstzrange(${input.start.toISOString()}::timestamptz, ${input.end.toISOString()}::timestamptz, '[)')
      and ${assigned(input)} ${floor} ${space}
  ), recipients as (
    select user_id from matching
    union select p.user_id from ${bookingParticipants} p join matching m on m.id = p.booking_id
  ) select user_id from recipients where user_id <> ${input.operatorId}::uuid`;
}
export async function announcementRecipients(
  input: AnnouncementRecipientsInput,
  database: DalDatabase = getDb(),
): Promise<string[]> {
  const rows = await database
    .select({ userId: sql<string>`audience.user_id` })
    .from(sql`(${recipientQuery(input)}) audience`)
    .orderBy(asc(sql`audience.user_id`));
  return rows.map((row) => row.userId);
}
export async function countAnnouncementRecipients(
  input: AnnouncementRecipientsInput,
  database: DalDatabase = getDb(),
) {
  const [result] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(sql`(${recipientQuery(input)}) audience`);
  return result?.count ?? 0;
}
export function listAnnouncementRows(
  input: OperatorScope & { cutoff: Date; now: Date },
  database: DalDatabase = getDb(),
) {
  return database
    .select({
      id: announcements.id,
      title: announcements.title,
      createdAt: announcements.createdAt,
      lounge: sql<boolean>`${announcements.loungeMessageId} is not null`,
      audience: sql<boolean>`${announcements.audience} is not null`,
      recipientCount: announcements.recipientCount,
    })
    .from(announcements)
    .where(
      and(
        eq(announcements.branchId, input.branchId),
        assigned(input),
        gte(announcements.createdAt, input.cutoff),
        lte(announcements.createdAt, input.now),
      ),
    )
    .orderBy(desc(announcements.createdAt), desc(announcements.id));
}
