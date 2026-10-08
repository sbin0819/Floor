import { z } from "zod";

const personName = z.string().min(1);
export const systemMessageDataSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("group_created"), actorName: personName }),
  z.strictObject({
    type: z.literal("members_added"),
    actorName: personName,
    names: z.array(personName).min(1).max(9),
  }),
  z.strictObject({ type: z.literal("member_left"), name: personName }),
  z.strictObject({
    type: z.literal("room_renamed"),
    actorName: personName,
    name: z
      .string()
      .min(1)
      .refine((name) => Array.from(name).length <= 30)
      .nullable(),
  }),
]);

export type SystemMessageData = z.infer<typeof systemMessageDataSchema>;

export function systemMessageText(data: SystemMessageData): string {
  switch (data.type) {
    case "group_created":
      return `${data.actorName} 님이 그룹을 만들었어요`;
    case "members_added": {
      const names =
        data.names.length > 3
          ? `${data.names.slice(0, 2).join(", ")} 외 ${data.names.length - 2}명`
          : data.names.join(", ");
      return `${data.actorName} 님이 ${names} 님을 추가했어요`;
    }
    case "member_left":
      return `${data.name} 님이 나갔어요`;
    case "room_renamed":
      return data.name === null
        ? `${data.actorName} 님이 그룹 이름을 지웠어요`
        : `${data.actorName} 님이 그룹 이름을 '${data.name}'(으)로 바꿨어요`;
  }
}

export function parseSystemMessageData(
  input: unknown,
): SystemMessageData | null {
  const result = systemMessageDataSchema.safeParse(input);
  return result.success ? result.data : null;
}
