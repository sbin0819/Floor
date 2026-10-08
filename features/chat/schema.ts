import { z } from "zod";

export const messageBodySchema = z
  .string()
  .trim()
  .refine((body) => {
    const size = Array.from(body).length;
    return size >= 1 && size <= 4000;
  }, "메시지는 1자부터 4000자까지 입력해 주세요.");
export const sendMessageSchema = z.strictObject({
  roomId: z.uuid(),
  clientId: z.uuid(),
  body: messageBodySchema,
});

export const markRoomReadSchema = z.strictObject({
  roomId: z.uuid(),
  seq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});

const messageSequenceQuerySchema = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .refine(Number.isSafeInteger);
export const messagePageQuerySchema = z.union([
  z.strictObject({ before: messageSequenceQuerySchema }),
  z.strictObject({ after: messageSequenceQuerySchema }),
]);
export type MessagePageCursor = z.output<typeof messagePageQuerySchema>;
