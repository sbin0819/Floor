import { z } from "zod";
import { parseUsername } from "@/lib/people/username";

export const usernameSchema = z.strictObject({
  username: z.string().transform((input, ctx) => {
    const parsed = parseUsername(input);
    if (parsed === null) {
      ctx.addIssue({
        code: "custom",
        message: "사용자 이름 형식이 올바르지 않아요.",
      });
      return z.NEVER;
    }
    return parsed;
  }),
});
export const personTargetSchema = z.strictObject({
  userId: z.uuid().transform((id) => id.toLowerCase()),
});
export const respondFriendSchema = personTargetSchema.extend({
  accept: z.boolean(),
});
export const peopleSearchSchema = z.string().trim().min(1).max(254);

export function friendsTab(input: unknown): "all" | "received" | "sent" {
  return input === "received" || input === "sent" ? input : "all";
}
