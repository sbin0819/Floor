import { z } from "zod";
import { ActionError } from "@/lib/actions/result";
import { requireSession } from "@/lib/auth/session";
import type { Session } from "@/lib/auth/types";
import type { DalDatabase } from "@/lib/dal/database";
import { canReadRoom, writableRoom } from "@/lib/dal/chat-access";
import {
  listChatMembers,
  listChatNav,
  listRecentMessages,
  listMessagesPage,
} from "@/lib/dal/chat-read";
import {
  createMemoryRateLimiter,
  RateLimitError,
  type RateLimiter,
} from "@/lib/rate-limit/memory";
import { messagePageQuerySchema } from "./schema";
import type { ChannelView, ChatSpaceNav, RoomMessagesPage } from "./types";

const pageLimiter = createMemoryRateLimiter();

export type ChatQueryDependencies = {
  database?: DalDatabase;
  requireSession?: () => Promise<Session>;
  now?: () => Date;
  limiter?: RateLimiter;
};

export function createChatQueries(dependencies: ChatQueryDependencies = {}) {
  const readSession = dependencies.requireSession ?? requireSession;
  return {
    async getRoomMessagesPage(
      roomId: string,
      query: unknown,
    ): Promise<RoomMessagesPage> {
      const session = await readSession();
      const input =
        query instanceof URLSearchParams
          ? Object.fromEntries(
              [...new Set(query.keys())].map((key) => {
                const values = query.getAll(key);
                return [key, values.length === 1 ? values[0] : values];
              }),
            )
          : query;
      const parsed = messagePageQuerySchema.safeParse(input);
      if (!parsed.success) throw new ActionError("INVALID_INPUT");
      const rate = (dependencies.limiter ?? pageLimiter).consume(
        `chat:page:${session.userId}`,
        60,
        60_000,
      );
      if (!rate.allowed) throw new RateLimitError(rate.retryAfter);
      if (!z.uuid().safeParse(roomId).success)
        throw new ActionError("NOT_FOUND");
      const [room, page] = await Promise.all([
        canReadRoom(session.userId, roomId, dependencies.database),
        listMessagesPage(
          roomId,
          session.userId,
          parsed.data,
          dependencies.database,
        ),
      ]);
      if (!room) throw new ActionError("NOT_FOUND");
      return {
        messages: page.messages.map((message) => ({
          ...message,
          createdAt: message.createdAt.toISOString(),
        })),
        hasMore: page.hasMore,
        lastSeq: room.lastSeq,
        lastReadSeq: room.lastReadSeq,
        firstUnreadSeq: room.firstUnreadSeq,
      };
    },
    async getMyChatNav(): Promise<ChatSpaceNav[]> {
      const session = await readSession();
      const rows = await listChatNav(session.userId, dependencies.database);
      const spaces = new Map<string, ChatSpaceNav>();
      for (const row of rows) {
        let space = spaces.get(row.spaceId);
        if (!space) {
          space = {
            id: row.spaceId,
            kind: "team",
            name: row.spaceName,
            initial: Array.from(row.spaceName)[0] ?? "",
            unread: false,
            channels: [],
          };
          spaces.set(space.id, space);
        }
        if (row.roomId && row.roomName) {
          space.channels.push({
            id: row.roomId,
            name: row.roomName,
            unread: row.unread,
          });
          space.unread ||= row.unread;
        }
      }
      return [...spaces.values()];
    },
    async getChannelView(
      spaceId: string,
      roomId: string,
    ): Promise<ChannelView | null> {
      const session = await readSession();
      if (
        !z.uuid().safeParse(spaceId).success ||
        !z.uuid().safeParse(roomId).success
      )
        return null;
      const room = await canReadRoom(
        session.userId,
        roomId,
        dependencies.database,
      );
      if (!room || room.spaceId !== spaceId.toLowerCase()) return null;
      const [messages, members] = await Promise.all([
        listRecentMessages(roomId, session.userId, dependencies.database),
        listChatMembers(room.teamId, dependencies.database),
      ]);
      return {
        space: { id: room.spaceId, name: room.spaceName },
        room: {
          id: room.id,
          name: room.name!,
          topic: room.topic,
          archived: room.archivedAt !== null,
          adminOnly: room.adminOnly,
          lastSeq: room.lastSeq,
        },
        user: { id: session.userId, name: session.name },
        messages: messages.map((message) => ({
          ...message,
          createdAt: message.createdAt.toISOString(),
        })),
        members,
        lastReadSeq: room.lastReadSeq,
        firstUnreadSeq: room.firstUnreadSeq,
        canWrite: writableRoom(room),
        now: (dependencies.now?.() ?? new Date()).toISOString(),
      };
    },
  };
}
