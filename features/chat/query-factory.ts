import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import type { Session } from "@/lib/auth/types";
import type { DalDatabase } from "@/lib/dal/database";
import { canReadRoom, writableRoom } from "@/lib/dal/chat-access";
import {
  listChatMembers,
  listChatNav,
  listRecentMessages,
} from "@/lib/dal/chat-read";
import type { ChannelView, ChatSpaceNav } from "./types";

export type ChatQueryDependencies = {
  database?: DalDatabase;
  requireSession?: () => Promise<Session>;
  now?: () => Date;
};

export function createChatQueries(dependencies: ChatQueryDependencies = {}) {
  const readSession = dependencies.requireSession ?? requireSession;
  return {
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
