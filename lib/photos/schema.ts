import { z } from "zod";

export const photoPathSchema = z
  .string()
  .regex(
    /^\/[a-z0-9/_-]+\.(webp|png|jpg)$/u,
    "사이트 안의 사진 경로를 입력해 주세요.",
  )
  .refine((path) => !path.includes("//") && !path.includes("\n"), {
    message: "사이트 안의 사진 경로를 입력해 주세요.",
  });

export const photoAltSchema = z.string().refine(
  (alt) => {
    // PostgreSQL의 char_length와 같은 문자 수로 검사한다.
    const length = Array.from(alt).length;
    return length >= 1 && length <= 120;
  },
  { message: "사진 설명은 1자 이상 120자 이하로 입력해 주세요." },
);

export const photoSchema = z.strictObject({
  path: photoPathSchema,
  alt: photoAltSchema,
});

export type Photo = z.infer<typeof photoSchema>;
