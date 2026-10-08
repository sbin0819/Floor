export type RealtimeEvent =
  | {
      type: "room.activity";
      spaceId: string | null;
      bookingId: string | null;
      roomKind: ChatRoomKind;
      preview: {
        messageId: string;
        authorName: string | null;
        excerpt: string;
      } | null;
      roomId: string;
      seq: number;
      authorId: string | null;
    }
  | { type: "room.read"; roomId: string; userId: string; seq: number }
  | { type: "friend.changed" }
  | { type: "notifications.changed" }
  | { type: "room.changed"; roomId: string }
  | { type: "realtime.reauth" }
  | { type: "status.changed"; status: "online" | "away" | "dnd" }
  | { type: "booking.changed"; spaceId: string }
  | { type: "space.status_changed"; spaceId: string }
  | { type: "plan.published"; floorId: string; version: number }
  | {
      type: "message.created";
      roomId: string;
      id: string;
      seq: number;
      authorId: string | null;
      authorName: string | null;
      clientId: string | null;
      kind: "text" | "system";
      systemData: SystemMessageData | null;
      body: string;
      createdAt: string;
      replyTo: ChatReply | null;
      mentions: ChatMention[];
      mentionsEveryone: boolean;
      editedAt: null;
      deletedAt: null;
      reactions: [];
    }
  | {
      type: "message.updated";
      roomId: string;
      id: string;
      seq: number;
      body: string;
      mentions: ChatMention[];
      mentionsEveryone: boolean;
      editedAt: string;
    }
  | { type: "message.deleted"; roomId: string; id: string; seq: number }
  | {
      type: "reaction.changed";
      roomId: string;
      messageId: string;
      emoji: ReactionEmoji;
      userId: string;
      added: boolean;
      count: number;
    }
  | {
      type: "mention.created";
      spaceId: string | null;
      bookingId: string | null;
      roomKind: ChatRoomKind;
      roomId: string;
      roomName: string;
      messageId: string;
      seq: number;
      authorName: string;
      excerpt: string;
    };

export type RealtimeItem = { channel: string; event: RealtimeEvent };

export interface RealtimePublisher {
  publish(channel: string, event: RealtimeEvent): Promise<void>;
  publishMany(items: readonly RealtimeItem[]): Promise<void>;
}

export interface RealtimeSubscriber {
  subscribe(
    channel: string,
    onEvent: (event: RealtimeEvent) => void,
  ): () => void;
}
import type {
  ChatMention,
  ChatRoomKind,
  ChatReply,
  ReactionEmoji,
} from "@/features/chat/types";
import type { SystemMessageData } from "@/features/chat/system-messages";
