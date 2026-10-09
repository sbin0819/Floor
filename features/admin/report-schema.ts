import { z } from "zod";

export const resolveReportsSchema = z.strictObject({
  messageId: z.uuid().transform((value) => value.toLowerCase()),
  resolution: z.enum(["dismissed", "message_deleted", "member_banned"]),
});

export type ReportResolution = z.infer<
  typeof resolveReportsSchema
>["resolution"];
