import { z } from "zod";
import meetingFile from "@/docs/spec/examples/seed-meeting.json";
import type { SeedData } from "./data";
import type { SeedBookings2Data } from "./bookings-2";
import { SeedError } from "./errors";

const seedMeetingSchema = z.strictObject({
  note: z.string(),
  messages: z.array(
    z.strictObject({
      bookingId: z.uuid().transform((value) => value.toLowerCase()),
      authorKey: z.string().min(1),
      minutesAgo: z.int().nonnegative(),
      body: z
        .string()
        .trim()
        .refine(
          (value) =>
            Array.from(value).length >= 1 && Array.from(value).length <= 4000,
          "본문은 1–4000자여야 해요.",
        ),
    }),
  ),
});

export function parseSeedMeeting(
  input: unknown,
  seed: Pick<SeedData, "bookings" | "users">,
  extras: Pick<SeedBookings2Data, "participants">,
) {
  const parsed = seedMeetingSchema
    .superRefine((data, context) => {
      const bookings = new Map(seed.bookings.map((row) => [row.id, row]));
      const users = new Set(seed.users.map(({ key }) => key));
      const participants = new Map(
        extras.participants.map((row) => [row.bookingId, row.userKeys]),
      );
      const previousMinutes = new Map<string, number>();
      data.messages.forEach(({ bookingId, authorKey, minutesAgo }, index) => {
        const issue = (field: string, message: string) =>
          context.addIssue({
            code: "custom",
            path: ["messages", index, field],
            message,
          });
        const booking = bookings.get(bookingId);
        if (!booking) issue("bookingId", "시드에 없는 시간 예약이에요.");
        if (!users.has(authorKey))
          issue("authorKey", "시드에 없는 작성자예요.");
        else if (
          booking &&
          booking.userKey !== authorKey &&
          !participants.get(bookingId)?.includes(authorKey)
        )
          issue("authorKey", "작성자가 이 예약의 멤버가 아니에요.");
        const previous = previousMinutes.get(bookingId);
        if (previous !== undefined && minutesAgo >= previous)
          issue(
            "minutesAgo",
            "메시지 시각은 예약마다 오래된 것부터 차례로 정해야 해요.",
          );
        previousMinutes.set(bookingId, minutesAgo);
      });
    })
    .safeParse(input);
  if (!parsed.success)
    throw new SeedError(
      `회의 시드 데이터 검증 실패: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
    );
  return { messages: parsed.data.messages };
}

export type SeedMeetingData = ReturnType<typeof parseSeedMeeting>;

export function loadSeedMeeting(
  seed: Pick<SeedData, "bookings" | "users">,
  extras: Pick<SeedBookings2Data, "participants">,
): SeedMeetingData {
  return parseSeedMeeting(meetingFile, seed, extras);
}

export function seedMeetingCreatedAt(
  messages: SeedMeetingData["messages"],
  now: Date,
) {
  const createdAt = new Date(
    now.getTime() -
      (messages.length ? messages[0]!.minutesAgo + 2 : 0) * 60_000,
  );
  if (!Number.isFinite(createdAt.getTime()))
    throw new SeedError("회의 시드의 시각이 올바르지 않아요.");
  return createdAt;
}
