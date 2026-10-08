import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  chatRoomReads,
  chatRooms,
  chatSpaces,
  teamMembers,
  teams,
} from "@/lib/db/schema";
import { firstUnreadSequence } from "./chat-reads";
import type { DalDatabase } from "./database";

// 같은 JOIN 조건을 조회와 액션·토큰에 사용한다. 운영자 권한은 팀 소속을 대신하지 않는다.
export function readableTeamSpace(userId: string) {
  return and(
    eq(chatSpaces.kind, "team"),
    isNull(chatSpaces.deletedAt),
    eq(teamMembers.userId, userId),
  );
}

export async function canReadRoom(
  userId: string,
  roomId: string,
  database: DalDatabase = getDb(),
) {
  const [room] = await database
    .select({
      id: chatRooms.id,
      spaceId: chatSpaces.id,
      spaceName: teams.name,
      teamId: teams.id,
      name: chatRooms.name,
      topic: chatRooms.topic,
      adminOnly: chatRooms.adminOnly,
      archivedAt: chatRooms.archivedAt,
      lastSeq: chatRooms.lastSeq,
      lastReadSeq: chatRoomReads.lastReadSeq,
      firstUnreadSeq: firstUnreadSequence(userId),
      role: teamMembers.role,
    })
    .from(chatRooms)
    .innerJoin(chatSpaces, eq(chatRooms.spaceId, chatSpaces.id))
    .innerJoin(teams, eq(chatSpaces.teamId, teams.id))
    .innerJoin(teamMembers, eq(teamMembers.teamId, teams.id))
    .leftJoin(
      chatRoomReads,
      and(
        eq(chatRoomReads.roomId, chatRooms.id),
        eq(chatRoomReads.userId, userId),
      ),
    )
    .where(
      and(
        eq(chatRooms.id, roomId),
        eq(chatRooms.kind, "text"),
        readableTeamSpace(userId),
      ),
    )
    .limit(1);
  return room ?? null;
}

export async function canReadSpace(
  userId: string,
  spaceId: string,
  database: DalDatabase = getDb(),
) {
  const [space] = await database
    .select({ id: chatSpaces.id, teamId: teams.id })
    .from(chatSpaces)
    .innerJoin(teams, eq(chatSpaces.teamId, teams.id))
    .innerJoin(teamMembers, eq(teamMembers.teamId, teams.id))
    .where(and(eq(chatSpaces.id, spaceId), readableTeamSpace(userId)))
    .limit(1);
  return space ?? null;
}

export function writableRoom(
  room: NonNullable<Awaited<ReturnType<typeof canReadRoom>>>,
) {
  return room.archivedAt === null && (!room.adminOnly || room.role === "admin");
}

export async function canWriteRoom(
  userId: string,
  roomId: string,
  database?: DalDatabase,
) {
  const room = await canReadRoom(userId, roomId, database);
  return { room, canWrite: room !== null && writableRoom(room) };
}
