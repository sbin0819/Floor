import { z } from "zod";
import { isBlockedName, normalizeFileName } from "@/lib/storage/file-kind";
import { MAX_UPLOAD_BYTES } from "./upload-types";

const fileSchema = z.strictObject({
  name: z
    .string()
    .transform(normalizeFileName)
    .refine((name) => !isBlockedName(name), "blocked_type"),
  size: z
    .number()
    .refine(
      (size) =>
        Number.isSafeInteger(size) && size >= 1 && size <= MAX_UPLOAD_BYTES,
      "too_large",
    ),
});

export const createUploadsSchema = z.strictObject({
  roomId: z.uuid().transform((value) => value.toLowerCase()),
  files: z.array(fileSchema).min(1).max(10),
});

export const uploadIdsSchema = z.strictObject({
  attachmentIds: z
    .array(z.uuid().transform((value) => value.toLowerCase()))
    .min(1)
    .max(10)
    .transform((ids) => [...new Set(ids)]),
});
