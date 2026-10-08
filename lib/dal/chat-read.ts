import "server-only";

import { and, asc, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  chatRooms,
  chatRoomReads,
  chatSpaces,
  messages,
  teamMembers,
  teams,
  users,
} from "@/lib/db/schema";
import { readableTeamSpace } from "./chat-access";
import { firstUnreadSequence } from "./chat-reads";
import type { DalDatabase } from "./database";

export function listChatNav(userId: string, database: DalDatabase = getDb()) {
  return database
    .select({
      spaceId: chatSpaces.id,
      spaceName: teams.name,
      roomId: chatRooms.id,
      roomName: chatRooms.name,
      unread: sql<boolean>`${firstUnreadSequence(userId)} is not null`,
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

export function chatMessageFields(userId: string) {
  return {
    id: messages.id,
    seq: messages.seq,
    authorId: messages.authorId,
    authorName: users.name,
    kind: messages.kind,
    body: messages.body,
    createdAt: messages.createdAt,
    clientId: sql<
      string | null
    >`case when ${messages.authorId} = ${userId} then ${messages.clientId} else null end`,
  };
}

export async function listRecentMessages(
  roomId: string,
  userId: string,
  database: DalDatabase = getDb(),
) {
  const rows = await database
    .select(chatMessageFields(userId))
    .from(messages)
    .leftJoin(users, eq(messages.authorId, users.id))
    .where(eq(messages.roomId, roomId))
    .orderBy(desc(messages.seq))
    .limit(50);
  return rows.reverse();
}

export function listChatMembers(
  teamId: string,
  database: DalDatabase = getDb(),
) {
  return database
    .select({
      id: users.id,
      name: users.name,
      admin: sql<boolean>`${teamMembers.role} = 'admin'`,
    })
    .from(teamMembers)
    .innerJoin(users, eq(teamMembers.userId, users.id))
    .where(eq(teamMembers.teamId, teamId))
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
  const rows = await database
    .select(chatMessageFields(userId))
    .from(messages)
    .innerJoin(chatRooms, eq(messages.roomId, chatRooms.id))
    .innerJoin(chatSpaces, eq(chatRooms.spaceId, chatSpaces.id))
    .innerJoin(teams, eq(chatSpaces.teamId, teams.id))
    .innerJoin(teamMembers, eq(teamMembers.teamId, teams.id))
    .leftJoin(users, eq(messages.authorId, users.id))
    .where(
      and(
        eq(chatRooms.id, roomId),
        eq(chatRooms.kind, "text"),
        readableTeamSpace(userId),
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
