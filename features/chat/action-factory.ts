import {
  createAction,
  type ActionDependencies,
} from "@/lib/actions/create-action";
import { ActionError } from "@/lib/actions/result";
import { canReadRoom } from "@/lib/dal/chat-access";
import { advanceRoomRead } from "@/lib/dal/chat-reads";
import type { DalDatabase, TransactionDatabase } from "@/lib/dal/database";
import {
  createMemoryRateLimiter,
  type RateLimiter,
} from "@/lib/rate-limit/memory";
import { roomChannel } from "@/lib/realtime/channels";
import type { RealtimePublisher } from "@/lib/realtime/types";
import { getRealtimePublisher } from "@/lib/realtime/server";
import { markRoomReadSchema } from "./schema";
import { createMessageActions } from "./message-actions";
import { createReactionActions } from "./reaction-actions";
import { createMuteActions } from "./mute-actions";
import { createDirectActions } from "./direct-actions";
import { createSendActions } from "./send-actions";
import { createGroupActions } from "./group-actions";

const limiter = createMemoryRateLimiter();
export type ChatActionDependencies = Partial<ActionDependencies> & {
  database?: DalDatabase & TransactionDatabase;
  now?: () => Date;
  limiter?: RateLimiter;
  publisher?: RealtimePublisher;
};

export function createChatActions(dependencies: ChatActionDependencies = {}) {
  return {
    ...createDirectActions(dependencies),
    ...createGroupActions(dependencies),
    ...createSendActions(dependencies, dependencies.limiter ?? limiter),
    ...createMuteActions(dependencies),
    ...createMessageActions(dependencies, dependencies.limiter ?? limiter),
    ...createReactionActions(dependencies, dependencies.limiter ?? limiter),
    markRoomRead: createAction(
      {
        input: markRoomReadSchema,
        authorize: "none",
        async handler({ session, input }) {
          const room = await canReadRoom(
            session.userId,
            input.roomId,
            dependencies.database,
          );
          if (!room) throw new ActionError("NOT_FOUND");
          const cursor = await advanceRoomRead(
            {
              ...input,
              userId: session.userId,
              now: dependencies.now?.() ?? new Date(),
            },
            dependencies.database,
          );
          if (!cursor) throw new ActionError("NOT_FOUND");
          if (
            room.kind === "dm" &&
            room.directMembership?.mine === "active" &&
            cursor.advanced
          ) {
            try {
              await (dependencies.publisher ?? getRealtimePublisher()).publish(
                roomChannel(room.id),
                {
                  type: "room.read",
                  roomId: room.id,
                  userId: session.userId,
                  seq: cursor.lastReadSeq,
                },
              );
            } catch {
              (dependencies.logError ?? console.error)(
                "Chat realtime publication failed.",
              );
            }
          }
          return { lastReadSeq: cursor.lastReadSeq };
        },
      },
      dependencies,
    ),
  };
}
