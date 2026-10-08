import { z } from "zod";
import { spaceIdSchema } from "./space-schema";

export const inviteCodePattern = /^[A-Za-z0-9_-]{22}$/;
export const createInviteLinkSchema = spaceIdSchema.extend({
  expiresIn: z.enum(["1d", "7d", "never"]),
  maxUses: z.union([z.literal(1), z.literal(10), z.null()]),
});
export const inviteToSpaceSchema = spaceIdSchema.extend({
  userIds: z
    .array(z.uuid())
    .min(1)
    .max(20)
    .transform((ids) => [...new Set(ids.map((id) => id.toLowerCase()))]),
});
