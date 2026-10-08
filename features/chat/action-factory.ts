import {
  createAction,
  type ActionDependencies,
} from "@/lib/actions/create-action";
import { ActionError } from "@/lib/actions/result";
import { canReadRoom, canWriteRoom } from "@/lib/dal/chat-access";
import { advanceRoomRead } from "@/lib/dal/chat-reads";
import { listChatMembers } from "@/lib/dal/chat-read";
import { getChatMessage } from "@/lib/dal/chat-messages";
import * as chatWrite from "@/lib/dal/chat-write";
import {
  withTransaction,
  type DalDatabase,
  type TransactionDatabase,
} from "@/lib/dal/database";
import {
  createMemoryRateLimiter,
  type RateLimiter,
} from "@/lib/rate-limit/memory";
import {
  roomChannel,
  spaceChannel,
  userChannel,
} from "@/lib/realtime/channels";
import type { RealtimeEvent, RealtimePublisher } from "@/lib/realtime/types";
import { getRealtimePublisher } from "@/lib/realtime/server";
import { markRoomReadSchema, sendMessageSchema } from "./schema";
import type { ChatMessage } from "./types";
import { excerptOf, extractMentions } from "./message-text";

const limiter = createMemoryRateLimiter();
export type ChatActionDependencies = Partial<ActionDependencies> & {
  database?: DalDatabase & TransactionDatabase;
  now?: () => Date;
  limiter?: RateLimiter;
  publisher?: RealtimePublisher;
};

async function requireWritable(
  userId: string,
  roomId: string,
  database?: DalDatabase,
) {
  const access = await canWriteRoom(userId, roomId, database);
  if (!access.room) throw new ActionError("NOT_FOUND");
  if (!access.canWrite) throw new ActionError("FORBIDDEN");
  return access.room;
}

export function createChatActions(dependencies: ChatActionDependencies = {}) {
  return {
    markRoomRead: createAction(
      {
        input: markRoomReadSchema,
        authorize: "none",
        async handler({ session, input }) {
          if (
            !(await canReadRoom(
              session.userId,
              input.roomId,
              dependencies.database,
            ))
          )
            throw new ActionError("NOT_FOUND");
          const cursor = await advanceRoomRead(
            {
              ...input,
              userId: session.userId,
              now: dependencies.now?.() ?? new Date(),
            },
            dependencies.database,
          );
          if (!cursor) throw new ActionError("NOT_FOUND");
          return cursor;
        },
      },
      dependencies,
    ),
    sendMessage: createAction(
      {
        input: sendMessageSchema,
        authorize: "none",
        async handler({ session, input }): Promise<ChatMessage> {
          if (
            !(dependencies.limiter ?? limiter).consume(
              `chat:send:${session.userId}`,
              10,
              10_000,
            ).allowed
          )
            throw new ActionError("LIMIT_EXCEEDED", { message: "send_rate" });
          await requireWritable(
            session.userId,
            input.roomId,
            dependencies.database,
          );
          const parsed = extractMentions(input.body);
          if (parsed.exceedsLimit) throw new ActionError("INVALID_INPUT");
          const now = dependencies.now?.() ?? new Date();
          const result = await withTransaction(async (transaction) => {
            await chatWrite.lockUsersForKeyShare(
              [...new Set([session.userId, ...parsed.userIds])].sort(),
              transaction,
            );
            await chatWrite.lockRoomForMessage(input.roomId, transaction);
            const room = await requireWritable(
              session.userId,
              input.roomId,
              transaction,
            );
            const existing = await chatWrite.findClientMessage(
              input.roomId,
              input.clientId,
              transaction,
            );
            if (existing) {
              if (existing.authorId !== session.userId)
                throw new ActionError("INVALID_INPUT");
              await advanceRoomRead(
                {
                  roomId: input.roomId,
                  userId: session.userId,
                  seq: existing.seq,
                  now,
                },
                transaction,
              );
              const message = await getChatMessage(
                existing.id,
                input.roomId,
                session.userId,
                transaction,
              );
              if (!message) throw new ActionError("INTERNAL");
              return {
                message,
                inserted: false,
                spaceId: room.spaceId,
                roomName: room.name,
                recipients: [] as string[],
                names: new Map<string, string>(),
              };
            }
            if (
              input.replyToId &&
              !(await getChatMessage(
                input.replyToId,
                input.roomId,
                session.userId,
                transaction,
              ))
            )
              throw new ActionError("INVALID_INPUT");
            const members = await listChatMembers(room.teamId, transaction);
            const names = new Map(
              members.map((member) => [member.id, member.name]),
            );
            const mentions = parsed.userIds.filter(
              (id) => id !== session.userId && names.has(id),
            );
            const mentionsEveryone = parsed.everyone && room.role === "admin";
            const message = await chatWrite.insertChatMessage(
              { ...input, mentionsEveryone, authorId: session.userId, now },
              transaction,
            );
            await chatWrite.insertMessageMentions(
              message.id,
              mentions,
              now,
              transaction,
            );
            await advanceRoomRead(
              {
                roomId: input.roomId,
                userId: session.userId,
                seq: message.seq,
                now,
              },
              transaction,
            );
            const saved = await getChatMessage(
              message.id,
              input.roomId,
              session.userId,
              transaction,
            );
            if (!saved) throw new ActionError("INTERNAL");
            return {
              message: saved,
              inserted: true,
              spaceId: room.spaceId,
              roomName: room.name,
              names,
              recipients: mentionsEveryone
                ? members
                    .filter((member) => member.id !== session.userId)
                    .map((member) => member.id)
                : mentions,
            };
          }, dependencies.database);
          const message = result.message;
          if (result.inserted) {
            const events: { channel: string; event: RealtimeEvent }[] = [
              {
                channel: roomChannel(input.roomId),
                event: {
                  type: "message.created",
                  roomId: input.roomId,
                  ...message,
                  editedAt: null,
                  deletedAt: null,
                  reactions: [],
                },
              },
              {
                channel: spaceChannel(result.spaceId),
                event: {
                  type: "room.activity",
                  spaceId: result.spaceId,
                  roomId: input.roomId,
                  seq: message.seq,
                  authorId: message.authorId,
                },
              },
            ];
            for (const recipient of result.recipients)
              events.push({
                channel: userChannel(recipient),
                event: {
                  type: "mention.created",
                  spaceId: result.spaceId,
                  roomId: input.roomId,
                  roomName: result.roomName ?? "채널",
                  messageId: message.id,
                  seq: message.seq,
                  authorName: session.name ?? "알 수 없는 사용자",
                  excerpt: excerptOf(message.body, result.names),
                },
              });
            try {
              await (
                dependencies.publisher ?? getRealtimePublisher()
              ).publishMany(events);
            } catch {
              (dependencies.logError ?? console.error)(
                "Chat realtime publication failed.",
              );
            }
          }
          return message;
        },
      },
      dependencies,
    ),
  };
}
