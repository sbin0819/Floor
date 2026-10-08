import { createAction } from "@/lib/actions/create-action";
import { ActionError } from "@/lib/actions/result";
import { canReactRoom } from "@/lib/dal/chat-access";
import { findMessageTarget } from "@/lib/dal/chat-message-write";
import { setMessageReaction } from "@/lib/dal/chat-reactions";
import { lockRoomForMessage, lockUsersForKeyShare } from "@/lib/dal/chat-write";
import { withTransaction } from "@/lib/dal/database";
import type { RateLimiter } from "@/lib/rate-limit/memory";
import { roomChannel } from "@/lib/realtime/channels";
import { getRealtimePublisher } from "@/lib/realtime/server";
import type { ChatActionDependencies } from "./action-factory";
import { reactionEmojis } from "./types";
import { z } from "zod";

const schema = z.strictObject({
  messageId: z.uuid(),
  emoji: z.enum(reactionEmojis),
  on: z.boolean(),
});

export function createReactionActions(
  dependencies: ChatActionDependencies,
  limiter: RateLimiter,
) {
  return {
    setReaction: createAction(
      {
        input: schema,
        authorize: "none",
        async handler({ session, input }) {
          if (
            !limiter.consume(`chat:reaction:${session.userId}`, 30, 10_000)
              .allowed
          )
            throw new ActionError("LIMIT_EXCEEDED", {
              message: "reaction_rate",
            });
          const target = await findMessageTarget(
            input.messageId,
            dependencies.database,
          );
          if (!target) throw new ActionError("NOT_FOUND");
          const now = dependencies.now?.() ?? new Date();
          const access = await canReactRoom(
            session.userId,
            target.roomId,
            dependencies.database,
            now,
          );
          if (!access.room) throw new ActionError("NOT_FOUND");
          if (!access.canReact) throw new ActionError("FORBIDDEN");
          if (target.kind === "system") throw new ActionError("INVALID_INPUT");
          const result = await withTransaction(async (tx) => {
            await lockUsersForKeyShare([session.userId], tx);
            await lockRoomForMessage(target.roomId, tx);
            const current = await canReactRoom(
              session.userId,
              target.roomId,
              tx,
              now,
            );
            if (!current.room) throw new ActionError("NOT_FOUND");
            if (!current.canReact) throw new ActionError("FORBIDDEN");
            return setMessageReaction(
              {
                ...input,
                userId: session.userId,
                now,
              },
              tx,
            );
          }, dependencies.database);
          if (result.changed)
            try {
              await (dependencies.publisher ?? getRealtimePublisher()).publish(
                roomChannel(target.roomId),
                {
                  type: "reaction.changed",
                  roomId: target.roomId,
                  messageId: input.messageId,
                  emoji: input.emoji,
                  userId: session.userId,
                  added: input.on,
                  count: result.count,
                },
              );
            } catch {
              (dependencies.logError ?? console.error)(
                "Chat realtime publication failed.",
              );
            }
          return { count: result.count, mine: result.mine };
        },
      },
      dependencies,
    ),
  };
}
