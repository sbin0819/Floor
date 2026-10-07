import { z } from "zod";

const idSchema = z.uuid().transform((value) => value.toLowerCase());

export const createBookingSchema = z.strictObject({
  spaceId: idSchema,
  start: z.iso.datetime({ offset: true }),
  end: z.iso.datetime({ offset: true }),
  teamId: idSchema.nullable(),
  title: z
    .string()
    .trim()
    .max(60, "제목은 60자 이하로 입력해 주세요")
    .refine(
      (value) => !value.includes("\0"),
      "저장할 수 없는 문자가 포함되어 있어요",
    )
    .optional()
    .transform((value) => value || null),
});
export const cancelBookingSchema = z.strictObject({ bookingId: idSchema });
export const defaultBranchSchema = z.strictObject({ branchId: idSchema });
