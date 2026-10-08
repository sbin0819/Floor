import { describe, expect, it } from "vitest";
import meetingFile from "@/docs/spec/examples/seed-meeting.json";
import { loadSeedData } from "@/lib/seed/data";
import { loadSeedBookings2 } from "@/lib/seed/bookings-2";
import {
  loadSeedMeeting,
  parseSeedMeeting,
  seedMeetingCreatedAt,
} from "@/lib/seed/meeting";
import { SeedError } from "@/lib/seed/errors";

const seed = loadSeedData();
const extras = loadSeedBookings2(seed);
const now = new Date("2026-10-08T01:00:00Z");
type MeetingFile = typeof meetingFile;

describe("strict meeting seed data", () => {
  it("loads five messages in two time bookings without adding data to the original seed contract", () => {
    const result = loadSeedMeeting(seed, extras);
    expect(result.messages).toHaveLength(5);
    expect(
      new Set(result.messages.map(({ bookingId }) => bookingId)).size,
    ).toBe(2);
    expect(result).not.toHaveProperty("note");
    expect(seed).not.toHaveProperty("messages");
  });
  it("checks descending times independently for interleaved bookings", () => {
    const input = structuredClone(meetingFile);
    input.messages = [
      input.messages[0]!,
      input.messages[3]!,
      input.messages[1]!,
      input.messages[4]!,
    ];
    expect(parseSeedMeeting(input, seed, extras).messages).toHaveLength(4);
  });
  it("trims bodies and counts Unicode code points without mutating the input", () => {
    const input = structuredClone(meetingFile);
    input.messages[0]!.body = ` ${"😀".repeat(4000)}\n`;
    input.messages[0]!.bookingId = input.messages[0]!.bookingId.toUpperCase();
    const before = structuredClone(input);
    expect(parseSeedMeeting(input, seed, extras).messages[0]).toMatchObject({
      bookingId: meetingFile.messages[0]!.bookingId,
      body: "😀".repeat(4000),
    });
    expect(input).toEqual(before);
  });
  it("allows no extra messages and dates members before the first message when present", () => {
    const empty = parseSeedMeeting(
      { ...meetingFile, messages: [] },
      seed,
      extras,
    );
    expect(seedMeetingCreatedAt(empty.messages, now)).toEqual(now);
    const rows = loadSeedMeeting(seed, extras).messages.filter(
      ({ bookingId }) => bookingId === meetingFile.messages[0]!.bookingId,
    );
    expect(seedMeetingCreatedAt(rows, now)).toEqual(
      new Date(now.getTime() - 182 * 60_000),
    );
    expect(() =>
      seedMeetingCreatedAt(
        [{ ...rows[0]!, minutesAgo: Number.MAX_SAFE_INTEGER }],
        now,
      ),
    ).toThrow(SeedError);
  });
  const invalid: { name: string; change: (input: MeetingFile) => void }[] = [
    {
      name: "unknown root field",
      change: (input) => Object.assign(input, { extra: true }),
    },
    {
      name: "unknown message field",
      change: (input) => Object.assign(input.messages[0]!, { extra: true }),
    },
    {
      name: "unknown booking",
      change: (input) => {
        input.messages[0]!.bookingId = crypto.randomUUID();
      },
    },
    {
      name: "desk booking",
      change: (input) => {
        input.messages[0]!.bookingId = extras.deskBookings[0]!.id;
      },
    },
    {
      name: "invalid UUID",
      change: (input) => {
        input.messages[0]!.bookingId = "missing";
      },
    },
    {
      name: "unknown author",
      change: (input) => {
        input.messages[0]!.authorKey = "missing";
      },
    },
    {
      name: "author outside the booking",
      change: (input) => {
        input.messages[0]!.authorKey = "growthAdmin";
      },
    },
    {
      name: "increasing time",
      change: (input) => {
        input.messages[1]!.minutesAgo = 181;
      },
    },
    {
      name: "equal time",
      change: (input) => {
        input.messages[1]!.minutesAgo = 180;
      },
    },
    {
      name: "negative time",
      change: (input) => {
        input.messages[0]!.minutesAgo = -1;
      },
    },
    {
      name: "fractional time",
      change: (input) => {
        input.messages[0]!.minutesAgo = 1.5;
      },
    },
    {
      name: "blank body",
      change: (input) => {
        input.messages[0]!.body = " \n ";
      },
    },
    {
      name: "4001 code points",
      change: (input) => {
        input.messages[0]!.body = "😀".repeat(4001);
      },
    },
  ];
  it.each(invalid)("rejects $name before insertion", ({ change }) => {
    const input = structuredClone(meetingFile);
    change(input);
    expect(() => parseSeedMeeting(input, seed, extras)).toThrow(SeedError);
  });
});
