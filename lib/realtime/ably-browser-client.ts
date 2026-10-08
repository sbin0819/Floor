import type { ConnectionState, TokenRequest } from "ably";
import { z } from "zod";

import { reactionEmojis } from "@/features/chat/types";
import { parseSystemMessageData } from "@/features/chat/system-messages";
import type { RealtimeEvent } from "@/lib/realtime/types";

export interface RealtimeTokenInput {
  rooms: string[];
  spaces?: string[];
}

export class RealtimeTokenError extends Error {
  constructor(readonly status: number) {
    super("실시간 인증을 완료하지 못했어요.");
  }
}

const tokenRequestSchema = z.object({
  capability: z.string(),
  clientId: z.string().optional(),
  keyName: z.string(),
  mac: z.string(),
  nonce: z.string(),
  timestamp: z.number(),
  ttl: z.number().optional(),
});

export async function fetchRealtimeToken(
  input: RealtimeTokenInput,
): Promise<TokenRequest> {
  const response = await fetch("/api/realtime/token", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new RealtimeTokenError(response.status);
  const parsed = tokenRequestSchema.safeParse(await response.json());
  if (!parsed.success) throw new RealtimeTokenError(502);
  return parsed.data;
}

const mentionSchema = z.object({ userId: z.string(), name: z.string() });
const replySchema = z.object({
  id: z.string(),
  authorName: z.string().nullable(),
  excerpt: z.string(),
  deleted: z.boolean(),
});

const eventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("friend.changed") }),
  z.object({ type: z.literal("notifications.changed") }),
  z.object({ type: z.literal("room.changed"), roomId: z.string() }),
  z.object({ type: z.literal("space.changed"), spaceId: z.string() }),
  z.object({ type: z.literal("realtime.reauth") }),
  z.object({
    type: z.literal("status.changed"),
    status: z.enum(["online", "away", "dnd"]),
  }),
  z.object({
    type: z.literal("room.read"),
    roomId: z.string(),
    userId: z.string(),
    seq: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("room.activity"),
    spaceId: z.string().nullable(),
    bookingId: z.string().nullable(),
    roomKind: z.enum(["text", "voice", "dm", "group_dm", "meeting"]),
    preview: z
      .object({
        messageId: z.string(),
        authorName: z.string().nullable(),
        excerpt: z.string(),
      })
      .nullable(),
    roomId: z.string(),
    seq: z.number().int().positive(),
    authorId: z.string().nullable(),
  }),
  z.object({ type: z.literal("booking.changed"), spaceId: z.string() }),
  z.object({ type: z.literal("space.status_changed"), spaceId: z.string() }),
  z.object({
    type: z.literal("plan.published"),
    floorId: z.string(),
    version: z.number(),
  }),
  z.object({
    type: z.literal("message.created"),
    roomId: z.string(),
    id: z.string(),
    seq: z.number().int().positive(),
    authorId: z.string().nullable(),
    authorName: z.string().nullable(),
    clientId: z.string().nullable(),
    kind: z.enum(["text", "system"]),
    systemData: z.unknown().transform(parseSystemMessageData),
    body: z.string(),
    createdAt: z.string(),
    replyTo: replySchema.nullable(),
    mentions: z.array(mentionSchema),
    mentionsEveryone: z.boolean(),
    editedAt: z.null(),
    deletedAt: z.null(),
    reactions: z.tuple([]),
  }),
  z.object({
    type: z.literal("message.updated"),
    roomId: z.string(),
    id: z.string(),
    seq: z.number().int().positive(),
    body: z.string(),
    mentions: z.array(mentionSchema),
    mentionsEveryone: z.boolean(),
    editedAt: z.string(),
  }),
  z.object({
    type: z.literal("message.deleted"),
    roomId: z.string(),
    id: z.string(),
    seq: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("reaction.changed"),
    roomId: z.string(),
    messageId: z.string(),
    emoji: z.enum(reactionEmojis),
    userId: z.string(),
    added: z.boolean(),
    count: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("mention.created"),
    spaceId: z.string().nullable(),
    bookingId: z.string().nullable(),
    roomKind: z.enum(["text", "voice", "dm", "group_dm", "meeting"]),
    roomId: z.string(),
    roomName: z.string(),
    messageId: z.string(),
    seq: z.number().int().positive(),
    authorName: z.string(),
    excerpt: z.string(),
  }),
]);

export interface BrowserConnectionChange {
  previous: ConnectionState;
  current: ConnectionState;
}

export interface BrowserChannel {
  presence: BrowserPresence;
  subscribe(listener: (event: RealtimeEvent) => void): Promise<void>;
  unsubscribe(listener: (event: RealtimeEvent) => void): void;
  onAttached(listener: (resumed: boolean) => void): () => void;
  detach(): Promise<void>;
}

export type PresenceMember = {
  clientId: string;
  connectionId: string;
  timestamp: number;
  data: unknown;
};

export interface BrowserPresence {
  get(): Promise<PresenceMember[]>;
  subscribe(listener: () => void): Promise<void>;
  unsubscribe(listener: () => void): void;
  enter(data: Record<string, unknown>): Promise<void>;
  update(data: Record<string, unknown>): Promise<void>;
  leave(): Promise<void>;
}

export interface AblyBrowserClient {
  connect(): void;
  close(): void;
  authorize(): Promise<void>;
  onConnection(listener: (change: BrowserConnectionChange) => void): () => void;
  channel(name: string): BrowserChannel;
}

export type BrowserAuthCallback = (
  callback: (error: string | null, token: TokenRequest | null) => void,
) => void;

export async function loadAblyBrowserClient(
  authCallback: BrowserAuthCallback,
): Promise<AblyBrowserClient> {
  const { Realtime } = await import("ably");
  const client = new Realtime({
    autoConnect: false,
    logLevel: 0,
    authCallback: (_params, callback) => authCallback(callback),
  });
  return {
    connect: () => client.connect(),
    close: () => client.close(),
    authorize: async () => {
      await client.auth.authorize();
    },
    onConnection(listener) {
      const onChange = ({ previous, current }: BrowserConnectionChange) => {
        listener({ previous, current });
      };
      client.connection.on(onChange);
      return () => client.connection.off(onChange);
    },
    channel(name) {
      const channel = client.channels.get(name);
      const handlers = new Map<
        (event: RealtimeEvent) => void,
        (message: { data?: unknown }) => void
      >();
      return {
        presence: {
          async get() {
            return (await channel.presence.get()).map(
              ({ clientId, connectionId, timestamp, data }) => ({
                clientId,
                connectionId,
                timestamp,
                data: data as unknown,
              }),
            );
          },
          subscribe: (listener) => channel.presence.subscribe(listener),
          unsubscribe: (listener) => channel.presence.unsubscribe(listener),
          enter: (data) => channel.presence.enter(data),
          update: (data) => channel.presence.update(data),
          leave: () => channel.presence.leave(),
        },
        async subscribe(listener) {
          const handler = (message: { data?: unknown }) => {
            const parsed = eventSchema.safeParse(message.data);
            if (parsed.success) listener(parsed.data);
          };
          handlers.set(listener, handler);
          await channel.subscribe(handler);
        },
        unsubscribe(listener) {
          const handler = handlers.get(listener);
          if (handler) channel.unsubscribe(handler);
          handlers.delete(listener);
        },
        onAttached(listener) {
          const onChange = (change: { current: string; resumed: boolean }) => {
            if (change.current === "attached") listener(change.resumed);
          };
          channel.on(onChange);
          return () => channel.off(onChange);
        },
        detach: () => channel.detach(),
      };
    },
  };
}
