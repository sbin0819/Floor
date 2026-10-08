import { describe, expect, it } from "vitest";
import { z } from "zod";
import bookingFile from "@/docs/spec/examples/seed-bookings-2.json";
import { loadSeedData } from "@/lib/seed/data";
import { loadSeedBookings2, parseSeedBookings2 } from "@/lib/seed/bookings-2";

const seed = loadSeedData();

describe("independent booking round two seed source", () => {
  it("loads all strict sections without changing the original seed contract", () => {
    const before = structuredClone(bookingFile);
    const data = loadSeedBookings2(seed);
    expect(
      data.attendeeCounts.map(({ attendeeCount }) => attendeeCount),
    ).toEqual([5, 4, 2, 12, 6, 6]);
    expect(data.participants.flatMap(({ userKeys }) => userKeys)).toHaveLength(
      5,
    );
    expect(data.deskBookings).toHaveLength(9);
    expect(data.deskBlocks).toHaveLength(1);
    data.attendeeCounts[0]!.attendeeCount = 1;
    expect(bookingFile).toEqual(before);
    expect(seed.bookings[0]).not.toHaveProperty("attendeeCount");
  });

  it.each([
    "root",
    "attendeeCounts",
    "participants",
    "deskBookings",
    "deskBlocks",
  ] as const)("rejects unknown keys in %s", (section) => {
    const source = structuredClone(bookingFile);
    Object.assign(section === "root" ? source : source[section][0]!, {
      unknown: true,
    });
    expect(() => parseSeedBookings2(source, seed)).toThrow(z.ZodError);
  });

  it.each([0, -1, 1.5, 501])("rejects attendee count %s", (attendeeCount) => {
    const source = structuredClone(bookingFile);
    source.attendeeCounts[0]!.attendeeCount = attendeeCount;
    expect(() => parseSeedBookings2(source, seed)).toThrow(z.ZodError);
  });

  it("accepts a capacity boundary and up to 500 when capacity is not known", () => {
    const source = structuredClone(bookingFile);
    const data = structuredClone(seed);
    const entry = source.attendeeCounts[0]!;
    const booking = data.bookings.find(({ id }) => id === entry.bookingId)!;
    const space = data.spaces.find(({ id }) => id === booking.spaceId)!;
    entry.attendeeCount = space.capacity!;
    expect(
      parseSeedBookings2(source, data).attendeeCounts[0]!.attendeeCount,
    ).toBe(space.capacity);
    space.capacity = null;
    entry.attendeeCount = 500;
    expect(
      parseSeedBookings2(source, data).attendeeCounts[0]!.attendeeCount,
    ).toBe(500);
  });

  it("rejects values beyond the referenced space capacity at the count path", () => {
    const source = structuredClone(bookingFile);
    source.attendeeCounts[0]!.attendeeCount = 500;
    try {
      parseSeedBookings2(source, seed);
      expect.fail("Capacity violation must be rejected.");
    } catch (error) {
      expect(error).toBeInstanceOf(z.ZodError);
      if (!(error instanceof z.ZodError)) throw error;
      expect(error.issues.map(({ path }) => path)).toContainEqual([
        "attendeeCounts",
        0,
        "attendeeCount",
      ]);
    }
  });

  it("rejects missing, duplicate and desk booking references", () => {
    const missing = structuredClone(bookingFile);
    missing.attendeeCounts[0]!.bookingId = crypto.randomUUID();
    expect(() => parseSeedBookings2(missing, seed)).toThrow(/시드에 없는 예약/);
    const duplicate = structuredClone(bookingFile);
    duplicate.attendeeCounts.push({ ...duplicate.attendeeCounts[0]! });
    expect(() => parseSeedBookings2(duplicate, seed)).toThrow(/같은 예약/);
    const data = structuredClone(seed);
    data.bookings.find(
      ({ id }) => id === bookingFile.attendeeCounts[0]!.bookingId,
    )!.spaceId = data.spaces.find(({ type }) => type === "desk")!.id;
    expect(() => parseSeedBookings2(bookingFile, data)).toThrow(/시간 예약/);
  });

  it("normalizes UUID case without changing source objects", () => {
    const source = structuredClone(bookingFile);
    source.attendeeCounts[0]!.bookingId =
      source.attendeeCounts[0]!.bookingId.toUpperCase();
    expect(parseSeedBookings2(source, seed).attendeeCounts[0]!.bookingId).toBe(
      bookingFile.attendeeCounts[0]!.bookingId,
    );
  });

  it("validates future section shapes but defers their reference checks to their instructions", () => {
    const source = structuredClone(bookingFile);
    source.participants[0]!.bookingId = crypto.randomUUID();
    source.deskBookings[0]!.deskId = crypto.randomUUID();
    source.deskBlocks[0]!.spaceId = crypto.randomUUID();
    expect(parseSeedBookings2(source, seed).deskBookings).toHaveLength(9);
    source.deskBookings[0]!.part = "unknown";
    expect(() => parseSeedBookings2(source, seed)).toThrow(z.ZodError);
  });
});
