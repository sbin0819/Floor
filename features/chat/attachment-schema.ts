import { z } from "zod";

export const chatAttachmentSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  size: z.number().int().positive(),
  kind: z.enum(["image", "file"]),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
});
export const attachmentSummarySchema = z.object({
  images: z.number().int().nonnegative(),
  files: z.number().int().nonnegative(),
  firstName: z.string(),
});
