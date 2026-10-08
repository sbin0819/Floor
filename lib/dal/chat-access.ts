import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  chatRoomReads,
  chatRooms,
  chatSpaces,
  chatSpacePrefs,
  teamMembers,
  teams,
} from "@/lib/db/schema";
import { firstUnreadSequence, unreadMentionCount } from "./chat-reads";
import type { DalDatabase } from "./database";
import { blockedBetween, blockedBy } from "./people-blocks";
import { sharesChatSpace } from "./group-dm";

// 같은 JOIN 조건을 조회와 액션·토큰에 사용한다. 운영자 권한은 팀 소속을 대신하지 않는다.
export function readableTeamSpace(userId: string) {
  return and(
    eq(chatSpaces.kind, "team"),
    isNull(chatSpaces.deletedAt),
    eq(teamMembers.userId, userId),
  );
}

export function readableRoomCondition(
  userId: string,
  roomId = sql`${chatRooms.id}`,
) {
  return sql<boolean>`exists (select 1 from chat_rooms readable_room
    where readable_room.id = ${roomId} and (
      (readable_room.kind = 'text' and exists (
        select 1 from chat_spaces s inner join team_members m on m.team_id = s.team_id
        where s.id = readable_room.space_id and s.kind = 'team' and s.deleted_at is null and m.user_id = ${userId}::uuid
      )) or (readable_room.kind = 'dm' and exists (
        select 1 from chat_room_members m where m.room_id = readable_room.id and m.user_id = ${userId}::uuid and m.status in ('active', 'requested')
      )) or (readable_room.kind = 'group_dm' and exists (
        select 1 from chat_room_members m where m.room_id = readable_room.id and m.user_id = ${userId}::uuid and m.status = 'active'
      ))
    ))`;
}

export async function canReadRoom(
  userId: string,
  roomId: string,
  database: DalDatabase = getDb(),
) {
  const [room] = await database
    .select({
      id: chatRooms.id,
      kind: chatRooms.kind,
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
      unreadMentions: unreadMentionCount(userId),
      roomMuted: sql<boolean>`coalesce(${chatRoomReads.muted}, false)`,
      spaceMuted: sql<boolean>`coalesce(${chatSpacePrefs.muted}, false)`,
      role: teamMembers.role,
      peer: sql<{
        userId: string;
        name: string;
        username: string | null;
        sharesSpace: boolean;
      } | null>`(
        select json_build_object('userId', u.id, 'name', u.name, 'username', u.username, 'sharesSpace', ${sharesChatSpace(userId, sql`u.id`)})
        from users u where ${chatRooms.kind} = 'dm' and u.id = case when ${chatRooms.dmLowUserId} = ${userId} then ${chatRooms.dmHighUserId} else ${chatRooms.dmLowUserId} end
      )`,
      peerActive: sql<boolean>`exists (select 1 from chat_room_members m where m.room_id = ${chatRooms.id} and m.user_id = case when ${chatRooms.dmLowUserId} = ${userId} then ${chatRooms.dmHighUserId} else ${chatRooms.dmLowUserId} end and m.status = 'active')`,
      directMembership: sql<{
        mine: "active" | "requested" | "declined" | "left";
        peer: "active" | "requested" | "declined" | "left";
        statusChangedAt: string;
        sentCount: number;
      } | null>`(select json_build_object('mine', mine.status, 'peer', peer.status,
        'statusChangedAt', peer.status_changed_at, 'sentCount', (
          select count(*)::int from messages sent where sent.room_id = ${chatRooms.id}
          and sent.author_id = ${userId}::uuid and sent.created_at >= peer.requested_at
        )) from chat_room_members mine inner join chat_room_members peer on peer.room_id = mine.room_id and peer.user_id <> mine.user_id
        where mine.room_id = ${chatRooms.id} and mine.user_id = ${userId}::uuid and ${chatRooms.kind} = 'dm')`,
      peerBlocked: blockedBetween(
        sql`${userId}::uuid`,
        sql`case when ${chatRooms.dmLowUserId} = ${userId} then ${chatRooms.dmHighUserId} else ${chatRooms.dmLowUserId} end`,
      ),
      blockedByMe: blockedBy(
        sql`${userId}::uuid`,
        sql`case when ${chatRooms.dmLowUserId} = ${userId} then ${chatRooms.dmHighUserId} else ${chatRooms.dmLowUserId} end`,
      ),
      peerReadSeq:
        sql<number>`coalesce((select r.last_read_seq from chat_room_reads r inner join chat_room_members m on m.room_id = r.room_id and m.user_id = r.user_id and m.status = 'active' where r.room_id = ${chatRooms.id} and r.user_id = case when ${chatRooms.dmLowUserId} = ${userId} then ${chatRooms.dmHighUserId} else ${chatRooms.dmLowUserId} end), 0)`.mapWith(
          Number,
        ),
    })
    .from(chatRooms)
    .leftJoin(chatSpaces, eq(chatRooms.spaceId, chatSpaces.id))
    .leftJoin(teams, eq(chatSpaces.teamId, teams.id))
    .leftJoin(
      teamMembers,
      and(eq(teamMembers.teamId, teams.id), eq(teamMembers.userId, userId)),
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
    .where(and(eq(chatRooms.id, roomId), readableRoomCondition(userId)))
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
  return (
    room.archivedAt === null &&
    (room.kind === "dm"
      ? room.directMembership !== null &&
        room.directMembership.peer !== "left" &&
        !room.peerBlocked
      : room.kind === "group_dm" || !room.adminOnly || room.role === "admin")
  );
}

export async function canWriteRoom(
  userId: string,
  roomId: string,
  database?: DalDatabase,
) {
  const room = await canReadRoom(userId, roomId, database);
  return { room, canWrite: room !== null && writableRoom(room) };
}

export async function canReactRoom(
  userId: string,
  roomId: string,
  database?: DalDatabase,
) {
  const room = await canReadRoom(userId, roomId, database);
  return {
    room,
    canReact:
      room !== null &&
      room.archivedAt === null &&
      (room.kind !== "dm" || (room.peerActive && !room.peerBlocked)),
  };
}
