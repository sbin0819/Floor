import { z } from "zod";
import { normalizeTeamName } from "@/lib/teams/normalize";

export const teamNameSchema = z
  .string()
  .transform(normalizeTeamName)
  .pipe(
    z
      .string()
      .min(2, "팀 이름은 2자 이상 입력해 주세요")
      .max(40, "팀 이름은 40자 이하로 입력해 주세요"),
  );
export const teamSearchSchema = teamNameSchema;
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `${max}자 이하로 입력해 주세요`)
    .nullish()
    .transform((value) => value || null);
const contactPhoneSchema = z
  .string()
  .trim()
  .regex(/^[0-9+\-\s]+$/u, "연락처에는 숫자, +, -, 공백만 입력해 주세요")
  .refine((value) => {
    const length = value.replace(/\D/g, "").length;
    return length >= 8 && length <= 15;
  }, "연락처의 숫자는 8자리 이상 15자리 이하로 입력해 주세요")
  .transform(
    (value) => `${value.startsWith("+") ? "+" : ""}${value.replace(/\D/g, "")}`,
  );

export const createTeamSchema = z.strictObject({
  name: teamNameSchema,
  homeBranchId: z
    .preprocess(
      (value) => (value === "" ? null : value),
      z.uuid("주 이용 지점을 확인해 주세요").nullish(),
    )
    .transform((value) => value ?? null),
  headcount: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() !== "" ? Number(value) : value,
    z
      .number("인원 규모를 입력해 주세요")
      .int("인원 규모는 정수로 입력해 주세요")
      .min(1, "인원 규모는 1명 이상이에요")
      .max(1000, "인원 규모는 1000명 이하예요"),
  ),
  contactPhone: contactPhoneSchema,
  title: optionalText(40),
});
export const createJoinRequestSchema = z.strictObject({
  teamId: z.uuid(),
  message: optionalText(200),
});
export const requestIdSchema = z.strictObject({ requestId: z.uuid() });
export const sendInviteSchema = z.strictObject({
  teamId: z.uuid(),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("이메일 주소를 확인해 주세요")),
  message: optionalText(200),
});
export const inviteIdSchema = z.strictObject({ inviteId: z.uuid() });
// 토큰 문자열의 무효 사유는 입력 오류가 아니라 INVITE_INVALID로 통일해요.
export const inviteTokenSchema = z.strictObject({ token: z.string() });

export type CreateTeamInput = z.input<typeof createTeamSchema>;
