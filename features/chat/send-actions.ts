import { createAction } from "@/lib/actions/create-action";
import { ActionError } from "@/lib/actions/result";
import { lockMessageSpace } from "@/lib/dal/chat-access";
import * as writes from "@/lib/dal/chat-write";
import { directPeerAccess } from "@/lib/dal/direct-permission";
import {
  createEmptyDirectRoom,
  findDirectRoom,
  initializeDirectMembers,
  requireRequestCapacity,
  renewMessageRequestNotification,
} from "@/lib/dal/direct-requests";
import { withTransaction } from "@/lib/dal/database";
import type { RateLimiter } from "@/lib/rate-limit/memory";
import { userChannel } from "@/lib/realtime/channels";
import { getRealtimePublisher } from "@/lib/realtime/server";
import type { RealtimeItem } from "@/lib/realtime/types";
import type { ChatActionDependencies } from "./action-factory";
import { extractMentions } from "./message-text";
import { sendMessageSchema, sendMessageRequestSchema } from "./schema";
import { requireWritable, sendLockedMessage } from "./send-message-core";

export function createSendActions(
  dependencies: ChatActionDependencies,
  limiter: RateLimiter,
) {
  const prepare = (userId: string, body: string) => {
    if (!limiter.consume(`chat:send:${userId}`, 10, 10_000).allowed)
      throw new ActionError("LIMIT_EXCEEDED", { message: "send_rate" });
    const parsed = extractMentions(body);
    if (parsed.exceedsLimit) throw new ActionError("INVALID_INPUT");
    return parsed;
  };
  const publish = async (events: RealtimeItem[]) => {
    if (!events.length) return;
    try {
      await (dependencies.publisher ?? getRealtimePublisher()).publishMany(
        events,
      );
    } catch {
      (dependencies.logError ?? console.error)(
        "Chat realtime publication failed.",
      );
    }
  };
  return {
    sendMessage: createAction(
      {
        input: sendMessageSchema,
        authorize: "none",
        async handler({ session, input }) {
          const parsed = prepare(session.userId, input.body);
          const now = dependencies.now?.() ?? new Date();
          const room = await requireWritable(
            session.userId,
            input.roomId,
            now,
            dependencies.database,
          );
          const result = await withTransaction(async (tx) => {
            if (room.kind === "dm" || input.attachmentIds.length)
              await writes.lockMessageUsers(
                session.userId,
                [
                  ...parsed.userIds,
                  ...(room.kind === "dm" ? [room.peer!.userId] : []),
                ],
                tx,
              );
            else
              await writes.lockUsersForKeyShare(
                [session.userId, ...parsed.userIds],
                tx,
              );
            await lockMessageSpace(room.spaceId, tx);
            await writes.lockRoomForMessage(input.roomId, tx);
            await requireWritable(session.userId, input.roomId, now, tx);
            return sendLockedMessage(
              input,
              session,
              now,
              tx,
              room.kind === "dm" ? { peerId: room.peer!.userId } : undefined,
            );
          }, dependencies.database);
          await publish(result.events);
          return result.message;
        },
      },
      dependencies,
    ),
    sendMessageRequest: createAction(
      {
        input: sendMessageRequestSchema,
        authorize: "none",
        async handler({ session, input }) {
          const parsed = prepare(session.userId, input.body);
          if (input.userId === session.userId)
            throw new ActionError("INVALID_INPUT");
          const now = dependencies.now?.() ?? new Date();
          const result = await withTransaction(async (tx) => {
            await writes.lockMessageUsers(
              session.userId,
              [...parsed.userIds, input.userId],
              tx,
            );
            const access = await directPeerAccess(
              session.userId,
              input.userId,
              tx,
            );
            if (!access.existsVerified) throw new ActionError("NOT_FOUND");
            if (access.blocked) throw new ActionError("FORBIDDEN");
            const found = await findDirectRoom(
              session.userId,
              input.userId,
              tx,
            );
            const target = found
              ? { roomId: found.id, created: false }
              : await createEmptyDirectRoom(
                  session.userId,
                  input.userId,
                  now,
                  tx,
                );
            await writes.lockRoomForMessage(target.roomId, tx);
            const initialEvents: RealtimeItem[] = [];
            if (target.created) {
              if (!access.related)
                await requireRequestCapacity(session.userId, now, tx);
              await initializeDirectMembers(
                {
                  roomId: target.roomId,
                  senderId: session.userId,
                  recipientId: input.userId,
                  requested: !access.related,
                  now,
                },
                tx,
              );
              if (!access.related) {
                await renewMessageRequestNotification(
                  {
                    userId: input.userId,
                    actorId: session.userId,
                    actorName: session.name,
                    now,
                  },
                  tx,
                );
                initialEvents.push({
                  channel: userChannel(input.userId),
                  event: { type: "notifications.changed" },
                });
              }
            }
            const sent = await sendLockedMessage(
              { ...input, roomId: target.roomId, attachmentIds: [] },
              session,
              now,
              tx,
              { peerId: input.userId, reopenDeclined: true, initialEvents },
            );
            return { ...sent, roomId: target.roomId };
          }, dependencies.database);
          await publish(result.events);
          return { roomId: result.roomId, message: result.message };
        },
      },
      dependencies,
    ),
  };
}
