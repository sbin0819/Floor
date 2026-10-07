import { z } from "zod";

export const nameSchema = z
  .string()
  .trim()
  .min(1, "이름을 입력해 주세요")
  .max(50, "이름은 50자까지 입력해 주세요");
export const passwordSchema = z
  .string()
  .min(8, "비밀번호는 8자 이상 입력해 주세요")
  .max(128, "비밀번호는 128자까지 입력해 주세요");
const email = z.email("이메일 주소를 확인해 주세요").trim().toLowerCase();

export const emailSchema = z.object({ email });
export const loginSchema = emailSchema.extend({
  password: z.string().min(1, "비밀번호를 입력해 주세요"),
});
export const signupSchema = emailSchema.extend({
  name: nameSchema,
  password: passwordSchema,
});
export const resetPasswordSchema = z.object({ password: passwordSchema });
