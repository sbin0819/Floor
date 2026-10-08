import "server-only";

import { and, asc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  callParticipants,
  callSessions,
  chatRooms,
  chatSpaces,
  users,
} from "@/lib/db/schema";
import type { DalDatabase } from "./database";

export function activeCallParticipant(
  now: Date,
  fields: { leftAt: SQL; lastSeenAt: SQL } = {
    leftAt: sql`${callParticipants.leftAt}`,
    lastSeenAt: sql`${callParticipants.lastSeenAt}`,
  },
) {
  return and(
    isNull(fields.leftAt),
    sql`${fields.lastSeenAt} > ${new Date(now.getTime() - 120_000)}::timestamptz`,
  )!;
}

export async function readCallParticipant(
  id: string,
  database: DalDatabase = getDb(),
) {
  const [row] = await database
    .select({
      ...participantFields,
      roomId: callSessions.roomId,
      kind: callSessions.kind,
      endedAt: callSessions.endedAt,
    })
    .from(callParticipants)
    .innerJoin(callSessions, eq(callSessions.id, callParticipants.sessionId))
    .where(eq(callParticipants.id, id));
  return row ?? null;
}

const participantFields = {
  id: callParticipants.id,
  userId: callParticipants.userId,
  sessionId: callParticipants.sessionId,
  joinedAt: callParticipants.joinedAt,
  leftAt: callParticipants.leftAt,
  lastSeenAt: callParticipants.lastSeenAt,
};

export async function readMyCallParticipant(
  userId: string,
  database: DalDatabase = getDb(),
) {
  const [row] = await database
    .select({ ...participantFields, roomId: callSessions.roomId })
    .from(callParticipants)
    .innerJoin(callSessions, eq(callSessions.id, callParticipants.sessionId))
    .where(
      and(eq(callParticipants.userId, userId), isNull(callParticipants.leftAt)),
    );
  return row ?? null;
}

export async function readCallRoom(roomId: string, database: DalDatabase) {
  const [room] = await database
    .select({
      id: chatRooms.id,
      kind: chatRooms.kind,
      spaceId: chatRooms.spaceId,
      bookingId: chatRooms.bookingId,
      spaceKind: chatSpaces.kind,
      dmLowUserId: chatRooms.dmLowUserId,
      dmHighUserId: chatRooms.dmHighUserId,
    })
    .from(chatRooms)
    .leftJoin(chatSpaces, eq(chatSpaces.id, chatRooms.spaceId))
    .where(eq(chatRooms.id, roomId));
  return room ?? null;
}

export async function readOpenCall(
  roomId: string,
  database: DalDatabase,
  lock = false,
) {
  const query = database
    .select()
    .from(callSessions)
    .where(and(eq(callSessions.roomId, roomId), isNull(callSessions.endedAt)));
  const [session] = await (lock ? query.for("update") : query);
  return session ?? null;
}

export async function readSessionRoom(
  sessionId: string,
  database: DalDatabase,
) {
  const [row] = await database
    .select({ roomId: callSessions.roomId })
    .from(callSessions)
    .where(eq(callSessions.id, sessionId));
  return row ?? null;
}

export function readCallParticipants(
  sessionId: string,
  database: DalDatabase,
  lock = false,
) {
  const query = database
    .select(participantFields)
    .from(callParticipants)
    .where(eq(callParticipants.sessionId, sessionId))
    .orderBy(asc(callParticipants.id));
  return lock ? query.for("update") : query;
}

export function readActiveCallPeople(
  sessionId: string,
  now: Date,
  database: DalDatabase,
) {
  return database
    .select({ userId: users.id, name: users.name })
    .from(callParticipants)
    .innerJoin(users, eq(users.id, callParticipants.userId))
    .where(
      and(
        eq(callParticipants.sessionId, sessionId),
        activeCallParticipant(now),
      ),
    )
    .orderBy(asc(users.name), asc(users.id))
    .limit(25);
}

export async function readCallAudience(roomId: string, database: DalDatabase) {
  const rows = await database.select({ userId: sql<string>`recipient.user_id` })
    .from(sql`(
    select member.user_id from chat_room_members member join chat_rooms room on room.id = member.room_id
    where room.id = ${roomId}::uuid and room.kind in ('dm', 'group_dm') and member.status = 'active'
    union select booking.user_id from chat_rooms room join bookings booking on booking.id = room.booking_id
    where room.id = ${roomId}::uuid
    union select member.user_id from chat_rooms room join booking_participants member on member.booking_id = room.booking_id
    where room.id = ${roomId}::uuid
  ) recipient`);
  return rows.map((row) => row.userId);
}
