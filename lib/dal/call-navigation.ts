import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { chatRooms, chatSpaces, users } from "@/lib/db/schema";
import type { CallView, MyCall } from "@/features/calls/types";
import { readableRoomCondition } from "./chat-access";
import { callSnapshot } from "./call-sql";
import type { DalDatabase } from "./database";

type NavigationRoom = {
  id: string;
  spaceId: string | null;
  kind: "text" | "voice" | "dm" | "group_dm" | "meeting";
  name: string | null;
  capacity: number | null;
  call: CallView | null;
};

export async function readCallNavigation(
  userId: string,
  now: Date,
  database: DalDatabase = getDb(),
) {
  const snapshot = callSnapshot(
    userId,
    sql`${chatRooms.id}`,
    sql`${chatSpaces.kind}`,
    now,
    database,
    true,
  );
  const rooms = database
    .select({
      id: chatRooms.id,
      spaceId: chatRooms.spaceId,
      kind: chatRooms.kind,
      name: chatRooms.name,
      capacity: chatRooms.voiceCapacity,
      call: snapshot.call,
    })
    .from(chatRooms)
    .leftJoin(chatSpaces, eq(chatSpaces.id, chatRooms.spaceId))
    .leftJoinLateral(snapshot, sql`true`)
    .where(
      and(
        isNull(chatRooms.archivedAt),
        readableRoomCondition(userId),
        sql`(${chatRooms.kind} = 'voice' or ${snapshot.call} is not null)`,
      ),
    )
    .orderBy(chatRooms.createdAt, chatRooms.id)
    .as("accessible_calls");
  const [row] = await database
    .select({
      rooms: sql<
        NavigationRoom[]
      >`coalesce((select jsonb_agg(jsonb_build_object(
      'id', accessible_calls.id, 'spaceId', accessible_calls.space_id, 'kind', accessible_calls.kind,
      'name', accessible_calls.name, 'capacity', accessible_calls.voice_capacity, 'call', accessible_calls.call
    )) from ${rooms}), '[]'::jsonb)`,
      myCall: sql<MyCall | null>`(select jsonb_build_object(
      'participantId', mine.id, 'sessionId', session.id, 'roomId', session.room_id,
      'kind', session.kind, 'joinedAt', mine.joined_at,
      'stale', mine.last_seen_at <= ${new Date(now.getTime() - 120_000)}::timestamptz
    ) from call_participants mine join call_sessions session on session.id = mine.session_id
      where mine.user_id = ${userId}::uuid and mine.left_at is null limit 1)`,
    })
    .from(users)
    .where(eq(users.id, userId));
  return row ?? { rooms: [], myCall: null };
}
