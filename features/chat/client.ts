import { z } from "zod";
import type { RoomMessagesPage } from "./types";
import { reactionEmojis } from "./types";

export type { RoomMessagesPage } from "./types";
export type MessagePageQuery =
  { before: number; after?: never } | { after: number; before?: never };

const sequence = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const pageSchema = z.object({
  messages: z.array(
    z.object({
      id: z.string(),
      seq: sequence,
      authorId: z.string().nullable(),
      authorName: z.string().nullable(),
      kind: z.enum(["text", "system"]),
      body: z.string(),
      createdAt: z.string(),
      clientId: z.string().nullable(),
      replyTo: z
        .object({
          id: z.string(),
          authorName: z.string().nullable(),
          excerpt: z.string(),
          deleted: z.boolean(),
        })
        .nullable(),
      mentions: z.array(z.object({ userId: z.string(), name: z.string() })),
      mentionsEveryone: z.boolean(),
      editedAt: z.string().nullable(),
      deletedAt: z.string().nullable(),
      reactions: z.array(
        z.object({
          emoji: z.enum(reactionEmojis),
          count: sequence,
          mine: z.boolean(),
          names: z.array(z.string()),
        }),
      ),
    }),
  ),
  hasMore: z.boolean(),
  lastSeq: sequence,
  lastReadSeq: sequence.nullable(),
  firstUnreadSeq: sequence.nullable(),
  peerReadSeq: sequence.nullable(),
});

export class ChatReadError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterMs = 1_000,
  ) {
    super("메시지를 불러오지 못했어요.");
  }
}

function retryDelay(response: Response) {
  const value = response.headers.get("Retry-After");
  if (!value) return 1_000;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 1_000;
}

function waitForRetry(delay: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, delay);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

export async function fetchRoomMessagesPage(
  roomId: string,
  query: MessagePageQuery,
  { signal, retry = true }: { signal?: AbortSignal; retry?: boolean } = {},
): Promise<RoomMessagesPage> {
  const search =
    "before" in query ? `before=${query.before}` : `after=${query.after}`;
  const request = () =>
    fetch(`/api/rooms/${encodeURIComponent(roomId)}/messages?${search}`, {
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });
  let response = await request();
  if (response.status === 429 && retry) {
    await waitForRetry(retryDelay(response), signal);
    response = await request();
  }
  if (!response.ok)
    throw new ChatReadError(
      response.status,
      response.status === 429 ? retryDelay(response) : 1_000,
    );
  const result = pageSchema.safeParse(await response.json());
  if (!result.success) throw new ChatReadError(502);
  return result.data;
}
