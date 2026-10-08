import "server-only";

import { and, asc, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  chatRooms,
  chatRoomReads,
  chatSpaces,
  chatSpacePrefs,
  messages,
  teamMembers,
  teams,
  users,
} from "@/lib/db/schema";
import {
  activeSpaceMembership,
  loungeAccessFrom,
  readableRoomCondition,
  readableTeamSpace,
  sharesChatSpace,
  type SpaceAccessFacts,
} from "./chat-access";
import { firstUnreadSequence, unreadMentionCount } from "./chat-reads";
import type { DalDatabase } from "./database";
import { selectChatMessages } from "./chat-messages";
import type { UserStatus } from "@/features/people/status";
import { blockedBy } from "./people-blocks";

export function listChatNav(userId: string, database: DalDatabase = getDb()) {
  return database
    .select({
      spaceId: sql<string>`${chatSpaces.id}`.as("space_id"),
      spaceName: sql<string>`${teams.name}`.as("space_name"),
      roomId: sql<string | null>`${chatRooms.id}`.as("room_id"),
      roomName: sql<string | null>`${chatRooms.name}`.as("room_name"),
      unread: sql<boolean>`${firstUnreadSequence(userId)} is not null`.as(
        "unread",
      ),
      unreadMentions: unreadMentionCount(userId).as("unread_mentions"),
      roomMuted: sql<boolean>`coalesce(${chatRoomReads.muted}, false)`.as(
        "room_muted",
      ),
      spaceMuted: sql<boolean>`coalesce(${chatSpacePrefs.muted}, false)`.as(
        "space_muted",
      ),
    })
    .from(chatSpaces)
    .innerJoin(teams, eq(chatSpaces.teamId, teams.id))
    .innerJoin(teamMembers, eq(teamMembers.teamId, teams.id))
    .leftJoin(
      chatRooms,
      and(
        eq(chatRooms.spaceId, chatSpaces.id),
        eq(chatRooms.kind, "text"),
        isNull(chatRooms.archivedAt),
      ),
    )
    .leftJoin(
      chatSpacePrefs,
      and(
        eq(chatSpacePrefs.spaceId, chatSpaces.id),
        eq(chatSpacePrefs.userId, userId),
      ),
    )
    .leftJoin(
      chatRoomReads,
      and(
        eq(chatRoomReads.roomId, chatRooms.id),
        eq(chatRoomReads.userId, userId),
      ),
    )
    .where(readableTeamSpace(userId))
    .orderBy(
      asc(teams.name),
      asc(chatSpaces.id),
      asc(chatRooms.createdAt),
      asc(chatRooms.id),
    );
}

// 공간이 하나도 없는 사람도 자기 상태와 차단 목록을 받는다. SQL 문장은 늘리지 않는다.
export async function readChatNavigation(
  userId: string,
  database: DalDatabase = getDb(),
) {
  type Row = Awaited<ReturnType<typeof listChatNav>>[number];
  const navigation = listChatNav(userId, database).as("nav_rows");
  const [result] = await database
    .select({
      myStatus: sql<UserStatus>`${users.status}`,
      blockedUserIds: sql<
        string[]
      >`array(select b.blocked_id from user_blocks b where b.blocker_id = ${userId}::uuid order by b.blocked_id)`,
      rows: sql<Row[]>`coalesce((select jsonb_agg(jsonb_build_object(
      'spaceId', nav_rows.space_id, 'spaceName', nav_rows.space_name,
      'roomId', nav_rows.room_id, 'roomName', nav_rows.room_name,
      'unread', nav_rows.unread, 'unreadMentions', nav_rows.unread_mentions,
      'roomMuted', nav_rows.room_muted, 'spaceMuted', nav_rows.space_muted
    )) from ${navigation}), '[]'::jsonb)`,
    })
    .from(users)
    .where(eq(users.id, userId));
  return (
    result ?? { myStatus: "online" as const, blockedUserIds: [], rows: [] }
  );
}

export async function listRecentMessages(
  roomId: string,
  userId: string,
  database: DalDatabase = getDb(),
) {
  const rows = await selectChatMessages(userId, database)
    .where(eq(messages.roomId, roomId))
    .orderBy(desc(messages.seq))
    .limit(50);
  return rows.reverse();
}

export function listChatMembers(
  teamId: string,
  database: DalDatabase = getDb(),
  mentionAuthorId?: string,
) {
  return database
    .select({
      id: users.id,
      name: users.name,
      admin: sql<boolean>`${teamMembers.role} = 'admin'`,
      ...(mentionAuthorId
        ? {
            canMention: sql<boolean>`not ${blockedBy(sql`${users.id}`, sql`${mentionAuthorId}::uuid`)}`,
          }
        : {}),
    })
    .from(teamMembers)
    .innerJoin(users, eq(teamMembers.userId, users.id))
    .where(eq(teamMembers.teamId, teamId))
    .orderBy(asc(users.name), asc(users.id));
}

export async function listChannelMembers(
  space: SpaceAccessFacts & {
    spaceId: string | null;
    teamId: string | null;
    branchId: string | null;
  },
  viewerId: string,
  database: DalDatabase = getDb(),
  options: { roomId?: string; mentionAuthorId?: string } = {},
) {
  if (space.spaceKind === "team" && space.teamId)
    return listChatMembers(space.teamId, database, options.mentionAuthorId);
  if (!space.spaceId) return [];
  const staff = sql<boolean>`exists (select 1 from branch_staff member_staff
    where member_staff.branch_id = ${space.branchId}::uuid and member_staff.user_id = ${users.id})`;
  const regularAdmin = loungeAccessFrom({
    isStaff: false,
    roleSettings: space.roleSettings,
  }).isAdmin;
  const staffAdmin = loungeAccessFrom({
    isStaff: true,
    roleSettings: space.roleSettings,
  }).isAdmin;
  const admin =
    space.spaceKind === "branch"
      ? sql<boolean>`(${regularAdmin} or (${staffAdmin} and ${staff}))`
      : sql<boolean>`member.role in ('owner', 'admin')`;
  return database
    .select({
      id: users.id,
      name: users.name,
      admin,
      sharesSpace: sharesChatSpace(viewerId, sql`${users.id}`),
      ...(options.mentionAuthorId
        ? {
            canMention: sql<boolean>`not ${blockedBy(sql`${users.id}`, sql`${options.mentionAuthorId}::uuid`)}`,
          }
        : {}),
    })
    .from(users)
    .innerJoin(
      sql`chat_space_members member`,
      sql`member.user_id = ${users.id} and member.space_id = ${space.spaceId}::uuid`,
    )
    .where(
      and(
        activeSpaceMembership(sql`${users.id}`, sql`${space.spaceId}::uuid`),
        space.spaceKind === "branch" && options.roomId
          ? sql`(${admin} or ${users.id} in (
            select recent.author_id from (
              select author_id from messages where room_id = ${options.roomId}::uuid order by seq desc limit 50
            ) recent
          ))`
          : undefined,
      ),
    )
    .orderBy(asc(users.name), asc(users.id));
}

export async function listMessagesPage(
  roomId: string,
  userId: string,
  cursor: { before: number } | { after: number },
  database: DalDatabase = getDb(),
) {
  const before = "before" in cursor;
  const limit = before ? 50 : 200;
  // 방 메타데이터와 병렬로 실행되므로 이 SQL도 직접 소속을 확인한 행만 읽는다.
  const rows = await selectChatMessages(userId, database)
    .innerJoin(chatRooms, eq(messages.roomId, chatRooms.id))
    .where(
      and(
        eq(chatRooms.id, roomId),
        readableRoomCondition(userId),
        before
          ? lt(messages.seq, cursor.before)
          : gt(messages.seq, cursor.after),
      ),
    )
    .orderBy(before ? desc(messages.seq) : asc(messages.seq))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  return {
    messages: before ? page.reverse() : page,
    hasMore: rows.length > limit,
  };
}
