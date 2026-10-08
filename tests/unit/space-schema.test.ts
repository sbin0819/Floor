import { describe, expect, it } from "vitest";
import {
  channelNameSchema,
  createCommunitySpaceSchema,
  normalizeChannelName,
  updateSpaceSchema,
} from "@/features/chat/space-schema";

describe("space input normalization", () => {
  it.each([
    ["  Hello WORLD--  ", "hello-world"],
    ["코스  공유", "코스-공유"],
    ["가나", "가나"],
    ["a---b", "a-b"],
  ])("normalizes %s", (input, output) =>
    expect(normalizeChannelName(input)).toBe(output),
  );
  it.each(["", "---", "😀", "abc/def", "A.B", "a".repeat(31)])(
    "rejects %s",
    (value) => {
      expect(() => normalizeChannelName(value)).toThrow(RangeError);
      expect(channelNameSchema.safeParse(value).success).toBe(false);
    },
  );
  it("counts community Unicode characters instead of UTF-16 units", () => {
    expect(
      createCommunitySpaceSchema.parse({
        name: ` ${"😀".repeat(30)} `,
        iconColor: "teal",
      }).name,
    ).toBe("😀".repeat(30));
    expect(
      createCommunitySpaceSchema.safeParse({
        name: "😀".repeat(31),
        iconColor: "teal",
      }).success,
    ).toBe(false);
  });
  it("requires a concrete change and rejects unknown properties", () => {
    expect(
      updateSpaceSchema.safeParse({ spaceId: crypto.randomUUID() }).success,
    ).toBe(false);
    expect(
      createCommunitySpaceSchema.safeParse({
        name: "가상",
        iconColor: "blue",
        owner: "fake",
      }).success,
    ).toBe(false);
  });
});
