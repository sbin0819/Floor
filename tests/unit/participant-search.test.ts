import { describe, expect, it } from "vitest";
import {
  maskParticipantEmail,
  participantQuerySchema,
} from "@/features/bookings/participants";
import { createMemoryRateLimiter } from "@/lib/rate-limit/memory";

describe("participant search pure rules", () => {
  it.each([
    ["yuna@floor.com", "yu•••@floor.com"],
    ["ab@floor.com", "a•••@floor.com"],
    ["a@floor.com", "a•••@floor.com"],
    ["가나@floor.com", "가•••@floor.com"],
    ["😀가나@floor.com", "😀가•••@floor.com"],
    ["malformed", "•••"],
  ])("masks %s without revealing the full local part", (email, masked) => {
    expect(maskParticipantEmail(email)).toBe(masked);
  });
  it("normalizes NFC and whitespace before applying length bounds", () => {
    expect(participantQuerySchema.parse("  김   하은  ")).toBe("김 하은");
    for (const value of ["가", "a".repeat(255), null, ["ab"]])
      expect(participantQuerySchema.safeParse(value).success).toBe(false);
    expect(participantQuerySchema.safeParse("a".repeat(254)).success).toBe(
      true,
    );
  });
});

describe("memory request windows", () => {
  it("isolates keys, counts successful attempts, and retries at the exact boundary", () => {
    let now = 1_000;
    const limiter = createMemoryRateLimiter(() => now);
    expect(limiter.consume("a", 2, 60_000)).toEqual({ allowed: true });
    expect(limiter.consume("a", 2, 60_000)).toEqual({ allowed: true });
    expect(limiter.consume("a", 2, 60_000)).toEqual({
      allowed: false,
      retryAfter: 60,
    });
    expect(limiter.consume("b", 2, 60_000)).toEqual({ allowed: true });
    now = 60_999;
    expect(limiter.consume("a", 2, 60_000)).toEqual({
      allowed: false,
      retryAfter: 1,
    });
    now = 61_000;
    expect(limiter.consume("a", 2, 60_000)).toEqual({ allowed: true });
  });
  it("keeps longer active windows during cleanup of expired keys", () => {
    let now = 0;
    const limiter = createMemoryRateLimiter(() => now);
    limiter.consume("short", 1, 100);
    limiter.consume("long", 1, 120_000);
    now = 60_001;
    expect(limiter.consume("short", 1, 100)).toEqual({ allowed: true });
    expect(limiter.consume("long", 1, 120_000)).toEqual({
      allowed: false,
      retryAfter: 60,
    });
  });
});
