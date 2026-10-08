import { describe, expect, it } from "vitest";
import {
  parseUsername,
  usernameSuggestionBase,
  usernameCandidates,
  pickUsername,
} from "@/lib/people/username";
import { usernameSchema } from "@/features/people/schema";

describe("public usernames", () => {
  it.each(["abc", "sub.in_1", "a".repeat(20)])("accepts %s", (value) =>
    expect(parseUsername(value)).toBe(value),
  );
  it.each([
    "ab",
    "a".repeat(21),
    "su bin",
    "수빈",
    "su-bin",
    "@@subin",
    "admin",
    "floor",
    "system",
    "everyone",
    "here",
    "support",
    "operator",
    undefined,
    1,
  ])("rejects %s", (value) => expect(parseUsername(value)).toBeNull());
  it("normalizes whitespace, a single leading @ and case identically in the action schema", () => {
    expect(parseUsername(" @SuBin ")).toBe("subin");
    expect(usernameSchema.parse({ username: " @SuBin " })).toEqual({
      username: "subin",
    });
    expect(usernameSchema.safeParse({ username: "admin" }).success).toBe(false);
  });
  it.each([
    ["SUBIN+test@floor.com", "subin"],
    ["수빈-s.u_!b@floor.com", "s.u_b"],
    ["ab@floor.com", "user"],
    ["admin@floor.com", "user"],
    ["a".repeat(25) + "@floor.com", "a".repeat(20)],
  ])("suggests a base from %s", (email, expected) =>
    expect(usernameSuggestionBase(email)).toBe(expected),
  );
  it("uses bounded suffixes starting at 2 and returns null when all are taken", () => {
    const list = usernameCandidates("a".repeat(20));
    expect(list).toHaveLength(999);
    expect(new Set(list).size).toBe(999);
    expect(list.every((name) => name.length === 20)).toBe(true);
    expect(list[1]).toBe("a".repeat(19) + "2");
    expect(list[998]).toBe("a".repeat(17) + "999");
    expect(pickUsername(list, new Set(list.slice(0, 2)))).toBe(list[2]);
    expect(pickUsername(list, new Set(list))).toBeNull();
  });
});
