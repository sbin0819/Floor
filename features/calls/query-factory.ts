import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { callsEnabled } from "@/lib/calls/livekit-server";
import { canReadRoom } from "@/lib/dal/chat-access";
import { joinableCall } from "@/lib/dal/call-access";
import type { ChatQueryDependencies } from "@/features/chat/query-factory";

export function createCallQueries(dependencies: ChatQueryDependencies = {}) {
  return {
    async getVoiceChannelView(spaceId: string, roomId: string) {
      const user = await (dependencies.requireSession ?? requireSession)();
      if (
        !z.uuid().safeParse(spaceId).success ||
        !z.uuid().safeParse(roomId).success
      )
        return null;
      const now = dependencies.now?.() ?? new Date();
      const room = await canReadRoom(
        user.userId,
        roomId,
        dependencies.database,
        now,
      );
      if (
        !room ||
        room.kind !== "voice" ||
        room.spaceId !== spaceId.toLowerCase() ||
        !room.spaceName ||
        !room.name
      )
        return null;
      return {
        space: {
          id: room.spaceId,
          name: room.spaceName,
          kind: room.spaceKind!,
        },
        room: {
          id: room.id,
          name: room.name,
          capacity: room.voiceCapacity!,
          archived: room.archivedAt !== null,
        },
        user: { id: user.userId, name: user.name },
        call: room.call
          ? {
              ...room.call,
              startedAt: new Date(room.call.startedAt).toISOString(),
            }
          : null,
        canCall:
          (dependencies.callsEnabled ?? callsEnabled()) &&
          joinableCall(room, now),
        now: now.toISOString(),
      };
    },
  };
}
