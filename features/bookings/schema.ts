import { z } from "zod";
import { addDays } from "@/lib/time/zoned";
import { bookingParticipantsSchema } from "./participant-input";

const idSchema = z.uuid().transform((value) => value.toLowerCase());

export const createBookingSchema = z.strictObject({
  spaceId: idSchema,
  start: z.iso.datetime({ offset: true }),
  end: z.iso.datetime({ offset: true }),
  teamId: idSchema.nullable(),
  attendeeCount: z.number().int().min(1).max(500).nullable().optional(),
  participants: bookingParticipantsSchema.optional(),
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
export const leaveBookingSchema = z.strictObject({ bookingId: idSchema });
export const updateBookingSchema = z.strictObject({
  bookingId: idSchema,
  start: createBookingSchema.shape.start,
  end: createBookingSchema.shape.end,
  attendeeCount: createBookingSchema.shape.attendeeCount.unwrap(),
  participants: bookingParticipantsSchema,
  participantIdsAtLoad: z
    .array(idSchema)
    .transform((ids) => [...new Set(ids)])
    .pipe(z.array(z.uuid()).max(20)),
  title: createBookingSchema.shape.title,
});
export const createDeskBookingSchema = z.strictObject({
  deskId: idSchema,
  date: z.string().refine((value) => {
    try {
      return addDays(value, 0) === value;
    } catch {
      return false;
    }
  }, "날짜를 확인해 주세요"),
  part: z.enum(["am", "pm", "day"]),
  teamId: idSchema.nullable(),
});
export const defaultBranchSchema = z.strictObject({ branchId: idSchema });
