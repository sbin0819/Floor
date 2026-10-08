import { z } from "zod";
import { ActionError } from "@/lib/actions/result";
import { requireSession } from "@/lib/auth/session";
import type { Session } from "@/lib/auth/types";
import type { DalDatabase } from "@/lib/dal/database";
import {
  canReadRoom,
  canReadMeeting,
  meetingReadOnlyReason,
  writableRoom,
} from "@/lib/dal/chat-access";
import {
  listMeetingMembers,
  listMeetingNav,
} from "@/lib/dal/chat-meeting-read";
import {
  listChatMembers,
  readChatNavigation,
  listRecentMessages,
  listMessagesPage,
} from "@/lib/dal/chat-read";
import {
  createMemoryRateLimiter,
  RateLimitError,
  type RateLimiter,
} from "@/lib/rate-limit/memory";
import { messagePageQuerySchema } from "./schema";
import type {
  ChannelView,
  ChatSpaceNav,
  ChatNav,
  DirectMessageView,
  RoomMessagesPage,
  MeetingView,
} from "./types";
import { listDirectMembers, listDirectNav } from "@/lib/dal/direct";
import { serializeChatMessage } from "@/lib/dal/chat-messages";
import { requestCooldownMs } from "@/lib/dal/direct-requests";
import { listGroupMembers } from "@/lib/dal/group-dm";
import { groupDisplayName } from "./group-name";

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
        messages: page.messages.map(serializeChatMessage),
        hasMore: page.hasMore,
        lastSeq: room.lastSeq,
        lastReadSeq: room.lastReadSeq,
        firstUnreadSeq: room.firstUnreadSeq,
        peerReadSeq: room.kind === "dm" ? room.peerReadSeq : null,
      };
    },
    async getMyChatNav(): Promise<ChatNav> {
      const session = await readSession();
      const now = dependencies.now?.() ?? new Date();
      const [navigation, directRows, meetingRows] = await Promise.all([
        readChatNavigation(session.userId, dependencies.database),
        listDirectNav(session.userId, dependencies.database),
        listMeetingNav(session.userId, now, dependencies.database),
      ]);
      const spaces = new Map<string, ChatSpaceNav>();
      for (const row of navigation.rows) {
        let space = spaces.get(row.spaceId);
        if (!space) {
          space = {
            id: row.spaceId,
            kind: "team",
            name: row.spaceName,
            initial: Array.from(row.spaceName)[0] ?? "",
            unread: false,
            muted: row.spaceMuted,
            unreadMentions: 0,
            channels: [],
          };
          spaces.set(space.id, space);
        }
        if (row.roomId && row.roomName) {
          space.channels.push({
            id: row.roomId,
            name: row.roomName,
            unread: row.unread,
            muted: row.roomMuted,
            unreadMentions: row.unreadMentions,
          });
          space.unread ||= row.unread && !row.roomMuted && !row.spaceMuted;
          space.unreadMentions += row.unreadMentions;
        }
      }
      return {
        now: now.toISOString(),
        meetings: meetingRows.map(({ during, ...row }) => ({
          ...row,
          start: during.start.toISOString(),
          end: during.end.toISOString(),
          phase:
            now < during.start
              ? "upcoming"
              : now < during.end
                ? "ongoing"
                : "ended",
        })),
        myStatus: navigation.myStatus,
        blockedUserIds: navigation.blockedUserIds,
        spaces: [...spaces.values()],
        directMessages: directRows.map((row) => ({
          roomId: row.roomId,
          lastSeq: row.lastSeq,
          muted: row.muted,
          unreadCount: row.unreadCount,
          unreadMentions: row.unreadMentions,
          ...(row.kind === "dm"
            ? { kind: "dm" as const, other: row.other! }
            : {
                kind: "group_dm" as const,
                name: row.name,
                memberCount: row.memberCount,
                members: row.members,
              }),
          lastMessageAt: row.lastMessageAt!.toISOString(),
          unread: row.unreadCount > 0,
        })),
      };
    },
    async getMeetingView(bookingId: string): Promise<MeetingView | null> {
      const session = await readSession();
      if (!z.uuid().safeParse(bookingId).success) return null;
      const now = dependencies.now?.() ?? new Date();
      const room = await canReadMeeting(
        session.userId,
        bookingId,
        dependencies.database,
      );
      if (!room?.booking) return null;
      const [messages, members] = await Promise.all([
        listRecentMessages(room.id, session.userId, dependencies.database),
        listMeetingMembers(bookingId, session.userId, dependencies.database),
      ]);
      const { userId, ...booking } = room.booking;
      const isBooker = userId === session.userId;
      return {
        room: {
          id: room.id,
          lastSeq: room.lastSeq,
          muted: room.roomMuted,
          unreadMentions: room.unreadMentions,
        },
        booking: {
          ...booking,
          start: new Date(booking.start).toISOString(),
          end: new Date(booking.end).toISOString(),
        },
        user: { id: session.userId, name: session.name },
        members: members.map(
          ({ id, name, username, isBooker, sharesSpace }) => ({
            userId: id,
            name,
            username,
            isBooker,
            sharesSpace,
          }),
        ),
        messages: messages.map(serializeChatMessage),
        lastReadSeq: room.lastReadSeq,
        firstUnreadSeq: room.firstUnreadSeq,
        canWrite: writableRoom(room, now),
        readOnlyReason: meetingReadOnlyReason(booking, now),
        isBooker,
        canEditBooking:
          isBooker &&
          booking.status === "confirmed" &&
          now.getTime() < new Date(booking.end).getTime(),
        now: now.toISOString(),
      };
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
      if (
        !room ||
        room.kind !== "text" ||
        room.spaceId !== spaceId.toLowerCase() ||
        !room.teamId ||
        !room.spaceName
      )
        return null;
      const [messages, members] = await Promise.all([
        listRecentMessages(roomId, session.userId, dependencies.database),
        listChatMembers(room.teamId, dependencies.database),
      ]);
      return {
        space: {
          id: room.spaceId,
          name: room.spaceName,
          muted: room.spaceMuted,
        },
        room: {
          id: room.id,
          name: room.name!,
          topic: room.topic,
          archived: room.archivedAt !== null,
          adminOnly: room.adminOnly,
          lastSeq: room.lastSeq,
          muted: room.roomMuted,
          unreadMentions: room.unreadMentions,
        },
        user: { id: session.userId, name: session.name },
        messages: messages.map(serializeChatMessage),
        members,
        lastReadSeq: room.lastReadSeq,
        firstUnreadSeq: room.firstUnreadSeq,
        canWrite: writableRoom(room),
        now: (dependencies.now?.() ?? new Date()).toISOString(),
      };
    },
    async getDirectMessageView(
      roomId: string,
    ): Promise<DirectMessageView | null> {
      const session = await readSession();
      if (!z.uuid().safeParse(roomId).success) return null;
      const room = await canReadRoom(
        session.userId,
        roomId,
        dependencies.database,
      );
      if (!room || (room.kind !== "dm" && room.kind !== "group_dm"))
        return null;
      if (room.kind === "group_dm") {
        const [messages, members] = await Promise.all([
          listRecentMessages(roomId, session.userId, dependencies.database),
          listGroupMembers(roomId, session.userId, dependencies.database),
        ]);
        return {
          kind: "group_dm",
          room: {
            id: room.id,
            archived: room.archivedAt !== null,
            lastSeq: room.lastSeq,
            muted: room.roomMuted,
            unreadMentions: room.unreadMentions,
          },
          name: room.name,
          displayName: groupDisplayName(
            room.name,
            members
              .filter((member) => member.userId !== session.userId)
              .map((member) => member.name),
          ),
          user: { id: session.userId, name: session.name },
          members,
          messages: messages.map(serializeChatMessage),
          lastReadSeq: room.lastReadSeq,
          firstUnreadSeq: room.firstUnreadSeq,
          canWrite: writableRoom(room),
          now: (dependencies.now?.() ?? new Date()).toISOString(),
        };
      }
      if (!room.peer) return null;
      const [messages, members] = await Promise.all([
        listRecentMessages(roomId, session.userId, dependencies.database),
        listDirectMembers(roomId, dependencies.database),
      ]);
      const now = dependencies.now?.() ?? new Date();
      const membership = room.directMembership;
      return {
        kind: "dm",
        blockedByMe: room.blockedByMe,
        request:
          membership?.mine === "requested"
            ? { role: "recipient" }
            : membership &&
                (membership.peer === "requested" ||
                  membership.peer === "declined")
              ? {
                  role: "sender",
                  sentCount:
                    new Date(membership.statusChangedAt).getTime() <=
                    now.getTime() - requestCooldownMs
                      ? 0
                      : membership.sentCount,
                }
              : null,
        room: {
          id: room.id,
          archived: room.archivedAt !== null,
          lastSeq: room.lastSeq,
          muted: room.roomMuted,
          unreadMentions: room.unreadMentions,
        },
        other: room.peer,
        user: { id: session.userId, name: session.name },
        members,
        messages: messages.map(serializeChatMessage),
        lastReadSeq: room.lastReadSeq,
        firstUnreadSeq: room.firstUnreadSeq,
        peerReadSeq: room.peerReadSeq,
        canWrite: writableRoom(room),
        now: now.toISOString(),
      };
    },
  };
}
