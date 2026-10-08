import {
  createAction,
  type ActionDependencies,
} from "@/lib/actions/create-action";
import { ActionError } from "@/lib/actions/result";
import { canReadRoom, canWriteRoom } from "@/lib/dal/chat-access";
import { advanceRoomRead } from "@/lib/dal/chat-reads";
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
import { roomChannel } from "@/lib/realtime/channels";
import type { RealtimePublisher } from "@/lib/realtime/types";
import { getRealtimePublisher } from "@/lib/realtime/server";
import { markRoomReadSchema, sendMessageSchema } from "./schema";
import type { ChatMessage } from "./types";

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
          const now = dependencies.now?.() ?? new Date();
          const result = await withTransaction(async (transaction) => {
            await chatWrite.lockMessageAuthor(session.userId, transaction);
            await chatWrite.lockRoomForMessage(input.roomId, transaction);
            await requireWritable(session.userId, input.roomId, transaction);
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
              return { message: existing, inserted: false };
            }
            const message = await chatWrite.insertChatMessage(
              { ...input, authorId: session.userId, now },
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
            return { message, inserted: true };
          }, dependencies.database);
          const message: ChatMessage = {
            id: result.message.id,
            seq: result.message.seq,
            authorId: result.message.authorId,
            authorName: session.name,
            kind: result.message.kind,
            body: result.message.body,
            clientId: result.message.clientId,
            createdAt: result.message.createdAt.toISOString(),
          };
          if (result.inserted) {
            try {
              await (dependencies.publisher ?? getRealtimePublisher()).publish(
                roomChannel(input.roomId),
                { type: "message.created", roomId: input.roomId, ...message },
              );
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
