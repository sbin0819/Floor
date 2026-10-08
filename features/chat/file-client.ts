import { z } from "zod";
import { chatAttachmentSchema } from "./attachment-schema";
import type { RoomFilesKind, RoomFilesPage } from "./file-types";

const cursor = z
  .string()
  .regex(/^[1-9]\d*_[0-9]$/u)
  .refine((value) => Number.isSafeInteger(Number(value.split("_")[0])));
const pageSchema = z
  .strictObject({
    files: z
      .array(
        chatAttachmentSchema
          .extend({
            uploaderName: z.string(),
            sentAt: z.iso.datetime(),
            messageId: z.uuid(),
            seq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
          })
          .strict(),
      )
      .max(30),
    hasMore: z.boolean(),
    nextCursor: cursor.nullable(),
  })
  .refine((page) => page.hasMore === (page.nextCursor !== null));

export type ReadRoomFiles = (
  roomId: string,
  query: { kind: RoomFilesKind; before?: string; signal?: AbortSignal },
) => Promise<RoomFilesPage>;

export class RoomFilesReadError extends Error {
  constructor(readonly status: number) {
    super("파일을 불러오지 못했어요.");
  }
}

export const fetchRoomFiles: ReadRoomFiles = async (
  roomId,
  { kind, before, signal },
) => {
  const search = new URLSearchParams({ kind });
  if (before) search.set("before", before);
  const response = await fetch(
    `/api/rooms/${encodeURIComponent(roomId)}/files?${search}`,
    {
      credentials: "same-origin",
      cache: "no-store",
      signal,
    },
  );
  if (!response.ok) throw new RoomFilesReadError(response.status);
  const value: unknown = await response.json().catch(() => null);
  const parsed = pageSchema.safeParse(value);
  if (!parsed.success) throw new RoomFilesReadError(502);
  return parsed.data;
};

export const roomFilesKey = (roomId: string) =>
  ["chat", "room", roomId, "files"] as const;
