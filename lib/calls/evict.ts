import type { CallDependencies } from "@/features/calls/service";
import { canStayInCall } from "@/lib/dal/call-access";
import { callEvents } from "@/lib/dal/call-events";
import { readCallUsers } from "@/lib/dal/call-evict";
import { readMyCallParticipant } from "@/lib/dal/call-read";
import { closeCallParticipant, lockCallUser } from "@/lib/dal/call-write";
import { lockRoomForMessage } from "@/lib/dal/chat-write";
import { withTransaction } from "@/lib/dal/database";
import { getRealtimePublisher } from "@/lib/realtime/server";
import { getLiveKitServer } from "./livekit-server";

export async function evictCalls(
  userId: string,
  dependencies: CallDependencies = {},
) {
  const log = dependencies.logError ?? console.error;
  try {
    const livekit =
      dependencies.livekit === undefined
        ? getLiveKitServer()
        : dependencies.livekit;
    if (!livekit) return;
    const now = dependencies.now?.() ?? new Date();
    const result = await withTransaction(async (tx) => {
      await lockCallUser(userId, tx);
      const participant = await readMyCallParticipant(userId, tx);
      if (!participant) return null;
      await lockRoomForMessage(participant.roomId, tx);
      if (await canStayInCall(userId, participant.roomId, tx)) return null;
      const closed = await closeCallParticipant(
        participant.id,
        participant.sessionId,
        now,
        tx,
      );
      if (!closed.changed) return null;
      return {
        participant,
        events: await callEvents(participant.roomId, now, closed.messages, tx),
      };
    }, dependencies.database);
    if (!result) return;
    try {
      await livekit.removeParticipant(
        `call:${result.participant.roomId}`,
        result.participant.id,
      );
    } catch {
      log("Call participant removal failed.");
    }
    try {
      await (dependencies.publisher ?? getRealtimePublisher()).publishMany(
        result.events,
      );
    } catch {
      log("Call realtime publication failed.");
    }
  } catch {
    log("Call eviction failed.");
  }
}

export async function evictTargetCalls(
  target: { roomId: string } | { spaceId: string },
  dependencies: CallDependencies = {},
) {
  try {
    if (
      !(dependencies.livekit === undefined
        ? getLiveKitServer()
        : dependencies.livekit)
    )
      return;
    const userIds = await readCallUsers(target, dependencies.database);
    await Promise.all(
      userIds.map((userId) => evictCalls(userId, dependencies)),
    );
  } catch {
    (dependencies.logError ?? console.error)("Call eviction failed.");
  }
}
