import "server-only";
import { eq } from "drizzle-orm";
import { callSessions } from "@/lib/db/schema";
import {
  withTransaction,
  type DalDatabase,
  type TransactionDatabase,
} from "./database";
import { readCallParticipant, readCallParticipants } from "./call-read";
import { lockCallUser, touchCallParticipant } from "./call-write";
import { isCurrentParticipant } from "./call-write";
import { callEvents } from "./call-events";
import type { RealtimeItem } from "@/lib/realtime/types";
import { lockRoomForMessage } from "./chat-write";

export async function confirmCallParticipant(
  input: { participantId: string; userId: string; roomId: string; now: Date },
  database?: DalDatabase & TransactionDatabase,
) {
  const rejected = { confirmed: false, events: [] as RealtimeItem[] };
  return withTransaction(async (tx) => {
    await lockCallUser(input.userId, tx);
    await lockRoomForMessage(input.roomId, tx);
    const participant = await readCallParticipant(input.participantId, tx);
    if (
      !participant ||
      participant.roomId !== input.roomId ||
      participant.userId !== input.userId ||
      participant.leftAt !== null ||
      participant.endedAt !== null
    )
      return rejected;
    const [session] = await tx
      .select({ endedAt: callSessions.endedAt })
      .from(callSessions)
      .where(eq(callSessions.id, participant.sessionId))
      .for("update");
    if (!session || session.endedAt !== null) return rejected;
    await readCallParticipants(participant.sessionId, tx, true);
    const confirmed = await touchCallParticipant(
      input.userId,
      input.participantId,
      input.now,
      tx,
    );
    return {
      confirmed,
      events:
        confirmed && !isCurrentParticipant(participant, input.now)
          ? await callEvents(input.roomId, input.now, [], tx)
          : [],
    };
  }, database);
}
