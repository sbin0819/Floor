import { z } from "zod";

export const cancellationPresets = [
  "공간 점검",
  "운영 사정",
  "중복 예약",
  "그 밖에",
] as const;
export const cancelBookingAsOperatorSchema = z
  .strictObject({
    bookingId: z.uuid().transform((value) => value.toLowerCase()),
    preset: z.enum(cancellationPresets),
    text: z
      .string()
      .trim()
      .refine((value) => !value.includes("\0"), {
        message: "사용할 수 없는 문자가 있어요",
      }),
  })
  .superRefine(({ preset, text }, ctx) => {
    if (Array.from(text).length > 200 - (Array.from(preset).length + 3)) {
      ctx.addIssue({
        code: "custom",
        path: ["text"],
        message: "이유는 합쳐서 200자 이내로 적어 주세요",
      });
    }
  });

export function operatorCancellationReason(
  input: z.infer<typeof cancelBookingAsOperatorSchema>,
) {
  return input.text ? `${input.preset} · ${input.text}` : input.preset;
}
