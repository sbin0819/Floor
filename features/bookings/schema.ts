import { z } from "zod";

export const createBookingSchema = z.strictObject({
  spaceId: z.uuid(),
  start: z.iso.datetime({ offset: true }),
  end: z.iso.datetime({ offset: true }),
  teamId: z.uuid().nullable(),
  title: z
    .string()
    .trim()
    .max(60, "제목은 60자 이하로 입력해 주세요")
    .optional()
    .transform((value) => value || null),
});
export const cancelBookingSchema = z.strictObject({ bookingId: z.uuid() });
export const defaultBranchSchema = z.strictObject({ branchId: z.uuid() });
