import { z } from "zod";

export const spaceIconColors = [
  "blue",
  "green",
  "orange",
  "purple",
  "pink",
  "teal",
  "yellow",
  "gray",
] as const;
export type SpaceIconColor = (typeof spaceIconColors)[number];
export const spaceIdSchema = z.strictObject({ spaceId: z.uuid() });
export const spaceNameSchema = z
  .string()
  .trim()
  .refine((value) => {
    const length = Array.from(value).length;
    return length >= 1 && length <= 30;
  }, "이름은 1자부터 30자까지 입력해 주세요.");
export const createCommunitySpaceSchema = z.strictObject({
  name: spaceNameSchema,
  iconColor: z.enum(spaceIconColors),
});
export const updateSpaceSchema = spaceIdSchema
  .extend({
    name: spaceNameSchema.optional(),
    iconColor: z.enum(spaceIconColors).optional(),
  })
  .refine((value) => value.name !== undefined || value.iconColor !== undefined);
export const spaceMemberSchema = spaceIdSchema.extend({ userId: z.uuid() });

export function normalizeChannelName(value: string): string {
  const name = value
    .normalize("NFC")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/gu, "-")
    .replace(/^-|-$/g, "");
  if (!/^[a-z0-9가-힣-]+$/u.test(name) || Array.from(name).length > 30)
    throw new RangeError("Invalid channel name");
  return name;
}

export const channelNameSchema = z.string().transform((value, ctx) => {
  try {
    return normalizeChannelName(value);
  } catch {
    ctx.addIssue({
      code: "custom",
      message:
        "채널 이름은 한글·영문 소문자·숫자·하이픈으로 1자부터 30자까지 입력해 주세요.",
    });
    return z.NEVER;
  }
});
export const channelTopicSchema = z
  .string()
  .trim()
  .refine((value) => Array.from(value).length <= 200)
  .transform((value) => value || null);
