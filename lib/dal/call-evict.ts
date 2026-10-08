import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { callParticipants, callSessions, chatRooms } from "@/lib/db/schema";
import type { DalDatabase } from "./database";

export async function readCallUsers(
  target: { roomId: string } | { spaceId: string },
  database: DalDatabase = getDb(),
) {
  const rows = await database
    .select({ userId: callParticipants.userId })
    .from(callParticipants)
    .innerJoin(callSessions, eq(callSessions.id, callParticipants.sessionId))
    .innerJoin(chatRooms, eq(chatRooms.id, callSessions.roomId))
    .where(
      and(
        isNull(callParticipants.leftAt),
        "roomId" in target
          ? eq(chatRooms.id, target.roomId)
          : eq(chatRooms.spaceId, target.spaceId),
      ),
    );
  return rows.map(({ userId }) => userId);
}
