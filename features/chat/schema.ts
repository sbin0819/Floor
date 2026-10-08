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
