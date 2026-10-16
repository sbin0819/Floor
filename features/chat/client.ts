import { z } from "zod";
import { avatarSchema } from "@/lib/avatar";
import { requestJson } from "@/lib/http/client";
import { ApiError } from "@/lib/http/errors";
import type { RoomMessagesPage } from "./types";
import { reactionEmojis } from "./types";
import { parseSystemMessageData } from "./system-messages";
import {
  chatAttachmentSchema,
  attachmentSummarySchema,
} from "./attachment-schema";

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
      authorAvatar: avatarSchema.nullable(),
      kind: z.enum(["text", "system"]),
      systemData: z.unknown().transform(parseSystemMessageData),
      body: z.string(),
      attachments: z.array(chatAttachmentSchema),
      createdAt: z.string(),
      clientId: z.string().nullable(),
      replyTo: z
        .object({
          id: z.string(),
          authorName: z.string().nullable(),
          excerpt: z.string(),
          deleted: z.boolean(),
          attachmentSummary: attachmentSummarySchema.nullable(),
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
    requestJson(
      `/api/rooms/${encodeURIComponent(roomId)}/messages?${search}`,
      pageSchema,
      { signal },
    );
  try {
    return await request();
  } catch (error) {
    if (
      !retry ||
      !(error instanceof ApiError) ||
      error.kind !== "http" ||
      error.status !== 429
    )
      throw error;
    await waitForRetry(error.retryAfterMs ?? 1_000, signal);
    return request();
  }
}
