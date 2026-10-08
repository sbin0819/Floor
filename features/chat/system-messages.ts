import { z } from "zod";
import { formatBookingTime } from "@/features/bookings/format";
import { isValidTimeZone, localDate } from "@/lib/time/zoned";

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
  z.strictObject({ type: z.literal("booking_created"), actorName: personName }),
  z.strictObject({
    type: z.literal("booking_time_changed"),
    actorName: personName,
    timezone: z.string().refine(isValidTimeZone),
    previousStart: z.iso.datetime(),
    previousEnd: z.iso.datetime(),
    start: z.iso.datetime(),
    end: z.iso.datetime(),
  }),
  z.strictObject({
    type: z.literal("participants_added"),
    actorName: personName,
    names: z.array(personName).min(1).max(20),
  }),
  z.strictObject({
    type: z.literal("participant_removed"),
    actorName: personName,
    names: z.array(personName).min(1).max(20),
  }),
  z.strictObject({ type: z.literal("participant_left"), name: personName }),
  z.strictObject({
    type: z.literal("booking_cancelled"),
    actorName: personName,
  }),
  z.strictObject({ type: z.literal("huddle_started"), actorName: personName }),
  z.strictObject({
    type: z.literal("huddle_ended"),
    durationMinutes: z.number().int().nonnegative(),
  }),
]);

export type SystemMessageData = z.infer<typeof systemMessageDataSchema>;

function listedNames(names: readonly string[]) {
  return names.length > 3
    ? `${names.slice(0, 2).join(", ")} 외 ${names.length - 2}명`
    : names.join(", ");
}

function shortDate(instant: string, timezone: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: timezone,
    month: "long",
    day: "numeric",
  }).format(new Date(instant));
}

export function systemMessageText(data: SystemMessageData): string {
  switch (data.type) {
    case "group_created":
      return `${data.actorName} 님이 그룹을 만들었어요`;
    case "members_added": {
      const names = listedNames(data.names);
      return `${data.actorName} 님이 ${names} 님을 추가했어요`;
    }
    case "member_left":
      return `${data.name} 님이 나갔어요`;
    case "room_renamed":
      return data.name === null
        ? `${data.actorName} 님이 그룹 이름을 지웠어요`
        : `${data.actorName} 님이 그룹 이름을 '${data.name}'(으)로 바꿨어요`;
    case "booking_created":
      return `${data.actorName} 님이 예약을 만들었어요`;
    case "booking_time_changed": {
      const { timezone } = data;
      const changedDate =
        localDate(new Date(data.previousStart), timezone) !==
        localDate(new Date(data.start), timezone);
      return `${data.actorName} 님이 시간을 바꿨어요: ${shortDate(data.previousStart, timezone)} ${formatBookingTime(data.previousStart, data.previousEnd, timezone)} → ${changedDate ? `${shortDate(data.start, timezone)} ` : ""}${formatBookingTime(data.start, data.end, timezone)}`;
    }
    case "participants_added":
      return `${data.actorName} 님이 ${listedNames(data.names)} 님을 참석자로 추가했어요`;
    case "participant_removed":
      return `${data.actorName} 님이 ${listedNames(data.names)} 님을 참석자에서 뺐어요`;
    case "participant_left":
      return `${data.name} 님이 참석하지 않기로 했어요`;
    case "booking_cancelled":
      return `${data.actorName} 님이 예약을 취소했어요`;
    case "huddle_started":
      return `${data.actorName} 님이 통화를 시작했어요`;
    case "huddle_ended":
      return `통화가 끝났어요 · ${data.durationMinutes === 0 ? "1분 미만" : `${data.durationMinutes}분`}`;
  }
}

export function parseSystemMessageData(
  input: unknown,
): SystemMessageData | null {
  const result = systemMessageDataSchema.safeParse(input);
  return result.success ? result.data : null;
}
