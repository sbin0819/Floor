import { describe, expect, it } from "vitest";
import {
  FRIEND_DECLINE_MS,
  relationOf,
  type FriendshipState,
} from "@/lib/people/friendship";

const now = new Date("2026-10-08T03:00:00Z");
describe("visible friendship relation", () => {
  it.each([
    [null, "none"],
    [
      { status: "accepted", requestedBy: "other", statusChangedAt: now },
      "friend",
    ],
    [
      { status: "pending", requestedBy: "me", statusChangedAt: now },
      "outgoing",
    ],
    [
      { status: "pending", requestedBy: "other", statusChangedAt: now },
      "incoming",
    ],
    [
      { status: "declined", requestedBy: "me", statusChangedAt: now },
      "outgoing",
    ],
    [
      { status: "declined", requestedBy: "other", statusChangedAt: now },
      "none",
    ],
    [{ status: "cancelled", requestedBy: "me", statusChangedAt: now }, "none"],
    [
      { status: "cancelled", requestedBy: "other", statusChangedAt: now },
      "none",
    ],
  ] satisfies [FriendshipState | null, string][])(
    "maps %j to %s",
    (row, expected) => {
      expect(relationOf(row, "me", now)).toBe(expected);
    },
  );
  it("keeps rejection private until exactly thirty days", () => {
    const row: FriendshipState = {
      status: "declined",
      requestedBy: "me",
      statusChangedAt: new Date(now.getTime() - FRIEND_DECLINE_MS),
    };
    expect(relationOf(row, "me", new Date(now.getTime() - 1))).toBe("outgoing");
    expect(relationOf(row, "me", now)).toBe("none");
    expect(relationOf(row, "me", new Date(now.getTime() + 1))).toBe("none");
  });
});
