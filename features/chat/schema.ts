import { z } from "zod";

export const messageBodySchema = z
  .string()
  .trim()
  .refine((body) => {
    const size = Array.from(body).length;
    return size >= 1 && size <= 4000;
  }, "메시지는 1자부터 4000자까지 입력해 주세요.");
export const optionalMessageBodySchema = z
  .string()
  .trim()
  .refine(
    (body) => Array.from(body).length <= 4000,
    "메시지는 4000자까지 입력해 주세요.",
  );
export const sendMessageSchema = z
  .strictObject({
    roomId: z.uuid(),
    clientId: z.uuid(),
    body: optionalMessageBodySchema,
    replyToId: z.uuid().optional(),
    attachmentIds: z
      .array(z.uuid().transform((id) => id.toLowerCase()))
      .transform((ids) => [...new Set(ids)])
      .pipe(z.array(z.uuid()).max(10))
      .default([]),
  })
  .refine((input) => !!input.body || input.attachmentIds.length > 0, {
    path: ["body"],
    message: "메시지나 파일을 추가해 주세요.",
  });
export const sendMessageRequestSchema = z.strictObject({
  userId: z.uuid().transform((id) => id.toLowerCase()),
  clientId: z.uuid(),
  body: messageBodySchema,
  replyToId: z.uuid().optional(),
});

export const markRoomReadSchema = z.strictObject({
  roomId: z.uuid(),
  seq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});

export const editMessageSchema = z.strictObject({
  messageId: z.uuid(),
  body: optionalMessageBodySchema,
});
export const deleteMessageSchema = z.strictObject({ messageId: z.uuid() });

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
