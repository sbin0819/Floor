import { z } from "zod";
import bookingFile from "@/docs/spec/examples/seed-bookings-2.json";
import type { SeedData } from "./data";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const key = z.string().min(1);
const clock = z.string().regex(/^(?:[01]\d|2[0-3]):(?:00|30)$/u);
const endClock = z.union([clock, z.literal("24:00")]);
const seedBookings2Schema = z.strictObject({
  note: z.string(),
  attendeeCounts: z.array(
    z.strictObject({
      bookingId: uuid,
      title: z.string(),
      attendeeCount: z.int().min(1).max(500),
    }),
  ),
  participants: z.array(
    z.strictObject({
      bookingId: uuid,
      title: z.string(),
      userKeys: z.array(key).max(20),
    }),
  ),
  deskBookings: z.array(
    z.strictObject({
      id: uuid,
      deskId: uuid,
      deskName: z.string(),
      dayOffset: z.int().nonnegative(),
      part: z.enum(["am", "pm", "day"]),
      userKey: key,
      teamId: uuid.nullable(),
      status: z.literal("confirmed"),
    }),
  ),
  deskBlocks: z.array(
    z.strictObject({
      id: uuid,
      spaceId: uuid,
      deskName: z.string(),
      startDayOffset: z.int().nonnegative(),
      start: clock,
      endDayOffset: z.int().nonnegative(),
      end: endClock,
      reason: z.string().nullable(),
      createdByKey: key,
    }),
  ),
});

export function parseSeedBookings2(
  input: unknown,
  seed: Pick<SeedData, "bookings" | "spaces">,
) {
  return seedBookings2Schema
    .superRefine((data, context) => {
      const bookings = new Map(seed.bookings.map((row) => [row.id, row]));
      const spaces = new Map(seed.spaces.map((row) => [row.id, row]));
      const seen = new Set<string>();
      data.attendeeCounts.forEach(({ bookingId, attendeeCount }, index) => {
        const issue = (field: "bookingId" | "attendeeCount", message: string) =>
          context.addIssue({
            code: "custom",
            path: ["attendeeCounts", index, field],
            message,
          });
        if (seen.has(bookingId))
          issue("bookingId", "같은 예약이 두 번 있어요.");
        seen.add(bookingId);
        const booking = bookings.get(bookingId);
        if (!booking) {
          issue("bookingId", "시드에 없는 예약이에요.");
          return;
        }
        const space = spaces.get(booking.spaceId);
        if (!space || space.type === "desk")
          issue("bookingId", "사용 인원은 시간 예약에만 넣을 수 있어요.");
        else if (space.capacity !== null && attendeeCount > space.capacity)
          issue("attendeeCount", "사용 인원이 공간의 정원보다 많아요.");
      });
    })
    .parse(input);
}

export type SeedBookings2Data = ReturnType<typeof parseSeedBookings2>;

export function loadSeedBookings2(
  seed: Pick<SeedData, "bookings" | "spaces">,
): SeedBookings2Data {
  return parseSeedBookings2(bookingFile, seed);
}
