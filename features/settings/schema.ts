import { z } from "zod";
import { nameSchema, passwordSchema } from "@/features/auth/schema";
import { AVATAR_COLORS } from "@/lib/avatar";

export const updateNameSchema = z.strictObject({
  name: z
    .string()
    .transform((value) => value.normalize("NFC").trim().replace(/\s+/gu, " "))
    .pipe(nameSchema),
});
export const updateAvatarSchema = z
  .strictObject({
    color: z.enum(AVATAR_COLORS).optional(),
    photo: z.boolean().optional(),
  })
  .refine(
    (input) => input.color !== undefined || input.photo !== undefined,
    "색이나 사진 설정을 골라 주세요",
  );
export const changePasswordSchema = z
  .strictObject({
    currentPassword: z
      .string()
      .min(1, "지금 비밀번호를 입력해 주세요")
      .max(128, "비밀번호는 128자까지 입력해 주세요"),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
    revokeOtherSessions: z.boolean(),
  })
  .superRefine((input, context) => {
    if (input.newPassword !== input.confirmPassword)
      context.addIssue({
        code: "custom",
        path: ["confirmPassword"],
        message: "새 비밀번호가 일치하지 않아요",
      });
    if (input.newPassword === input.currentPassword)
      context.addIssue({
        code: "custom",
        path: ["newPassword"],
        message: "지금과 다른 비밀번호를 입력해 주세요",
      });
  });
export const revokeSessionSchema = z.strictObject({ sessionId: z.uuid() });
export const emptySettingsInput = z.strictObject({});
export const updatePreferencesSchema = z
  .strictObject({
    chatToasts: z.boolean().optional(),
    tabBadge: z.boolean().optional(),
    reminderMinutes: z
      .array(
        z.union([z.literal(30), z.literal(10), z.literal(5), z.literal(0)]),
      )
      .transform((minutes) => [...new Set(minutes)].sort((a, b) => b - a))
      .optional(),
  })
  .refine(
    (input) => Object.values(input).some((value) => value !== undefined),
    "바꿀 설정을 골라 주세요",
  );

export type Preferences = {
  chatToasts: boolean;
  tabBadge: boolean;
  reminderMinutes: number[];
};
