import "server-only";

import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  chatRoomReads,
  chatRooms,
  chatSpaces,
  chatSpacePrefs,
  teamMembers,
  teams,
  users,
} from "@/lib/db/schema";
import { alias } from "drizzle-orm/pg-core";
import { toAvatar, type AvatarSource } from "@/lib/avatar";
import { avatarColumns, avatarJson } from "./avatar";
import { firstUnreadSequence, unreadMentionCount } from "./chat-reads";
import type { DalDatabase } from "./database";
import { blockedBetween, blockedBy } from "./people-blocks";
import { callSnapshot, serializeCall } from "./call-sql";
import {
  loungeAccessFrom,
  type LoungeRoleSettings,
} from "@/lib/permissions/lounge";
export { loungeAccessFrom } from "@/lib/permissions/lounge";

export type SpaceRole = "member" | "admin" | "owner";
export type SpaceAccessFacts = {
  spaceKind: "team" | "branch" | "community" | null;
  teamRole: "member" | "admin" | null;
  memberRole: SpaceRole | null;
  isStaff: boolean;
  roleSettings: LoungeRoleSettings;
};

export const chatSpaceName = sql<string>`case ${chatSpaces}.kind
  when 'team' then (select name from teams where id = ${chatSpaces}.team_id)
  when 'branch' then (select name from branches where id = ${chatSpaces}.branch_id)
  else ${chatSpaces}.name end`;
export const chatSpaceKindOrder = sql<number>`case ${chatSpaces.kind}
  when 'team' then 0 when 'branch' then 1 else 2 end`;

export function activeSpaceMembership(
  userId: string | SQL,
  spaceId: SQL = sql`${chatSpaces.id}`,
) {
  return sql<boolean>`exists (select 1 from chat_space_members active_member
    join chat_spaces active_space on active_space.id = active_member.space_id
    where active_member.space_id = ${spaceId} and active_member.user_id = ${userId}::uuid
      and active_member.status = 'active' and active_space.deleted_at is null)`;
}

export function readableSpaceCondition(
  userId: string | SQL,
  spaceId: SQL = sql`${chatSpaces.id}`,
) {
  return sql<boolean>`exists (select 1 from chat_spaces readable_space
    where readable_space.id = ${spaceId} and readable_space.deleted_at is null and (
      (readable_space.kind = 'team' and exists (select 1 from team_members team_member
        where team_member.team_id = readable_space.team_id and team_member.user_id = ${userId}::uuid))
      or (readable_space.kind in ('branch', 'community') and ${activeSpaceMembership(userId, sql`readable_space.id`)})
    ))`;
}

export function sharedMembershipSpace(
  me: string | SQL,
  other: SQL,
  kinds: readonly ("branch" | "community")[] = ["community"],
) {
  const allowed = kinds.length
    ? sql.join(
        kinds.map((kind) => sql`${kind}`),
        sql`, `,
      )
    : sql`null`;
  return sql<boolean>`exists (select 1 from chat_spaces shared_space
    where shared_space.kind in (${allowed})
      and ${activeSpaceMembership(me, sql`shared_space.id`)}
      and ${activeSpaceMembership(other, sql`shared_space.id`)})`;
}

export function sharesChatSpace(me: string, other: SQL) {
  return sql<boolean>`(exists (select 1 from chat_spaces s
    inner join team_members mine on mine.team_id = s.team_id and mine.user_id = ${me}::uuid
    inner join team_members peer on peer.team_id = s.team_id and peer.user_id = ${other}
    where s.kind = 'team' and s.deleted_at is null)
    or ${sharedMembershipSpace(me, other)})`;
}

// 같은 SQL로 가져온 역할 원재료를 목록·방·관리 조회가 함께 해석한다.
// 단일 테이블 SELECT에서도 상관 컬럼의 테이블명이 생략되지 않게 명시한다.
export function spaceAccessFields(userId: string | SQL) {
  return {
    spaceKind: chatSpaces.kind,
    teamRole: sql<
      "member" | "admin" | null
    >`(select m.role from team_members m where m.team_id = ${chatSpaces}.team_id and m.user_id = ${userId}::uuid)`,
    memberRole: sql<SpaceRole | null>`(select m.role from chat_space_members m where m.space_id = ${chatSpaces}.id and m.user_id = ${userId}::uuid and ${activeSpaceMembership(userId)})`,
    isStaff: sql<boolean>`exists (select 1 from branch_staff staff where staff.branch_id = ${chatSpaces}.branch_id and staff.user_id = ${userId}::uuid)`,
    roleSettings: sql<LoungeRoleSettings>`coalesce((select jsonb_object_agg(setting.role, setting.permissions) from role_settings setting where setting.branch_id = ${chatSpaces}.branch_id), '{}'::jsonb)`,
  };
}

export function spaceRoleFrom(facts: SpaceAccessFacts): SpaceRole | null {
  if (facts.spaceKind === "team") return facts.teamRole;
  if (!facts.memberRole) return null;
  if (facts.spaceKind === "community") return facts.memberRole;
  return loungeAccessFrom(facts).isAdmin ? "admin" : "member";
}

export function isSpaceAdmin(role: SpaceRole | null) {
  return role === "admin" || role === "owner";
}

export async function lockMessageSpace(
  spaceId: string | null,
  database: DalDatabase,
) {
  if (spaceId === null) return;
  // 내보내기·나가기·스페이스 삭제의 FOR UPDATE와 직렬화한다. 사용자 잠금 다음, 방 잠금 이전이다.
  await database
    .select({ id: chatSpaces.id })
    .from(chatSpaces)
    .where(eq(chatSpaces.id, spaceId))
    .for("key share");
}

// 같은 JOIN 조건을 조회와 액션·토큰에 사용한다. 운영자 권한은 팀 소속을 대신하지 않는다.
export function readableTeamSpace(userId: string) {
  return and(
    eq(chatSpaces.kind, "team"),
    isNull(chatSpaces.deletedAt),
    eq(teamMembers.userId, userId),
  );
}

export function readableRoomCondition(
  userId: string | SQL,
  roomId = sql`${chatRooms.id}`,
) {
  return sql<boolean>`exists (select 1 from chat_rooms readable_room
    where readable_room.id = ${roomId} and (
      (readable_room.kind in ('text', 'voice') and ${readableSpaceCondition(userId, sql`readable_room.space_id`)}) or (readable_room.kind = 'dm' and exists (
        select 1 from chat_room_members m where m.room_id = readable_room.id and m.user_id = ${userId}::uuid and m.status in ('active', 'requested')
      )) or (readable_room.kind = 'group_dm' and exists (
        select 1 from chat_room_members m where m.room_id = readable_room.id and m.user_id = ${userId}::uuid and m.status = 'active'
      )) or (readable_room.kind = 'meeting' and exists (
        select 1 from bookings b where b.id = readable_room.booking_id and
          (b.user_id = ${userId}::uuid or exists (
            select 1 from booking_participants p where p.booking_id = b.id and p.user_id = ${userId}::uuid
          ))
      ))
    ))`;
}

export async function canReadRoom(
  userId: string,
  roomId: string,
  database: DalDatabase = getDb(),
  now = new Date(),
) {
  return readRoom(userId, eq(chatRooms.id, roomId), database, now);
}

export function canReadMeeting(
  userId: string,
  bookingId: string,
  database: DalDatabase = getDb(),
  now = new Date(),
) {
  return readRoom(
    userId,
    and(eq(chatRooms.bookingId, bookingId), eq(chatRooms.kind, "meeting"))!,
    database,
    now,
  );
}

async function readRoom(
  userId: string,
  target: SQL,
  database: DalDatabase,
  now: Date,
) {
  const snapshot = callSnapshot(
    userId,
    sql`${chatRooms.id}`,
    sql`${chatSpaces.kind}`,
    now,
    database,
  );
  const [room] = await database
    .select({
      id: chatRooms.id,
      viewer: { ...avatarColumns(users), name: users.name },
      call: snapshot.call,
      kind: chatRooms.kind,
      spaceId: chatSpaces.id,
      spaceName: sql<
        string | null
      >`case when ${chatSpaces.kind} = 'team' then ${teams.name}
        when ${chatSpaces.kind} = 'branch' then (select b.name from branches b where b.id = ${chatSpaces.branchId})
        else ${chatSpaces.name} end`,
      branchId: chatSpaces.branchId,
      teamId: teams.id,
      name: chatRooms.name,
      topic: chatRooms.topic,
      adminOnly: chatRooms.adminOnly,
      voiceCapacity: chatRooms.voiceCapacity,
      archivedAt: chatRooms.archivedAt,
      lastSeq: chatRooms.lastSeq,
      lastReadSeq: chatRoomReads.lastReadSeq,
      firstUnreadSeq: firstUnreadSequence(userId),
      unreadMentions: unreadMentionCount(userId),
      roomMuted: sql<boolean>`coalesce(${chatRoomReads.muted}, false)`,
      spaceMuted: sql<boolean>`coalesce(${chatSpacePrefs.muted}, false)`,
      ...spaceAccessFields(userId),
      booking: sql<{
        id: string;
        userId: string;
        title: string | null;
        status: "confirmed" | "cancelled";
        attendeeCount: number | null;
        start: string;
        end: string;
        spaceName: string;
        floorName: string;
        branchName: string;
        timezone: string;
      } | null>`(select json_build_object(
        'id', b.id, 'userId', b.user_id, 'title', b.title, 'status', b.status,
        'attendeeCount', b.attendee_count, 'start', lower(b.during), 'end', upper(b.during),
        'spaceName', s.name, 'floorName', f.name, 'branchName', branch.name, 'timezone', branch.timezone
      ) from bookings b inner join spaces s on s.id = b.space_id
        inner join floors f on f.id = s.floor_id inner join branches branch on branch.id = f.branch_id
        where b.id = ${chatRooms.bookingId} and ${chatRooms.kind} = 'meeting')`,
      peer: sql<{
        userId: string;
        name: string;
        username: string | null;
        sharesSpace: boolean;
        avatar: AvatarSource;
      } | null>`(
        select json_build_object('userId', u.id, 'name', u.name, 'username', u.username, 'sharesSpace', ${sharesChatSpace(userId, sql`u.id`)}, 'avatar', ${avatarJson(alias(users, "u"))})
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
    .innerJoin(users, eq(users.id, userId))
    .leftJoin(chatSpaces, eq(chatRooms.spaceId, chatSpaces.id))
    .leftJoinLateral(snapshot, sql`true`)
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
    .where(and(target, readableRoomCondition(userId)))
    .limit(1);
  return room
    ? {
        ...room,
        viewer: {
          id: room.viewer.id,
          name: room.viewer.name,
          avatar: toAvatar(room.viewer),
        },
        peer: room.peer
          ? { ...room.peer, avatar: toAvatar(room.peer.avatar) }
          : null,
        call: serializeCall(room.call),
        role: spaceRoleFrom(room),
      }
    : null;
}

export async function canReadSpace(
  userId: string,
  spaceId: string,
  database: DalDatabase = getDb(),
) {
  const [space] = await database
    .select({
      id: chatSpaces.id,
      teamId: chatSpaces.teamId,
      branchId: chatSpaces.branchId,
      ...spaceAccessFields(userId),
    })
    .from(chatSpaces)
    .where(and(eq(chatSpaces.id, spaceId), readableSpaceCondition(userId)))
    .limit(1);
  return space ? { ...space, role: spaceRoleFrom(space) } : null;
}

export async function spaceRoleOf(
  userId: string,
  spaceId: string,
  database?: DalDatabase,
) {
  return (await canReadSpace(userId, spaceId, database))?.role ?? null;
}

export function writableRoom(
  room: NonNullable<Awaited<ReturnType<typeof canReadRoom>>>,
  now?: Date,
) {
  if (room.kind === "meeting")
    return (
      room.booking !== null &&
      meetingReadOnlyReason(room.booking, now ?? new Date()) === null
    );
  return (
    room.archivedAt === null &&
    (room.spaceKind !== "branch" ||
      (room.adminOnly
        ? loungeAccessFrom(room).isAdmin
        : loungeAccessFrom(room).canWrite)) &&
    (room.kind === "dm"
      ? room.directMembership !== null &&
        room.directMembership.peer !== "left" &&
        !room.peerBlocked
      : room.kind === "group_dm" || !room.adminOnly || isSpaceAdmin(room.role))
  );
}

export function meetingReadOnlyReason(
  booking: { status: "confirmed" | "cancelled"; end: string },
  now: Date,
): "cancelled" | "ended" | null {
  if (booking.status === "cancelled") return "cancelled";
  return now.getTime() >= new Date(booking.end).getTime() + 86_400_000
    ? "ended"
    : null;
}

export async function canWriteRoom(
  userId: string,
  roomId: string,
  database?: DalDatabase,
  now?: Date,
) {
  const room = await canReadRoom(userId, roomId, database);
  const instant = now ?? new Date();
  return {
    room,
    canWrite: room !== null && writableRoom(room, instant),
    readOnlyReason: room?.booking
      ? meetingReadOnlyReason(room.booking, instant)
      : null,
  };
}

export async function canReactRoom(
  userId: string,
  roomId: string,
  database?: DalDatabase,
  now?: Date,
) {
  const room = await canReadRoom(userId, roomId, database);
  return {
    room,
    canReact:
      room !== null &&
      room.archivedAt === null &&
      (room.spaceKind !== "branch" || loungeAccessFrom(room).canWrite) &&
      (room.kind !== "meeting" || writableRoom(room, now)) &&
      (room.kind !== "dm" || (room.peerActive && !room.peerBlocked)),
  };
}
