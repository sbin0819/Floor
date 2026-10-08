import { describe, expect, it } from "vitest";
import { defaultSpaceChannel } from "@/features/chat/default-space-channel";
const announcement = {
  id: "notice",
  name: "공지",
  unread: false,
  unreadMentions: 0,
  muted: false,
};
const lounge = { ...announcement, id: "lounge", name: "라운지" };
describe("default space channel", () => {
  it("prefers the lounge over a notice regardless of creation ordering", () => {
    expect(
      defaultSpaceChannel({ kind: "branch", channels: [announcement, lounge] }),
    ).toBe(lounge);
  });
  it("uses the first active channel when a lounge has been renamed or archived", () => {
    expect(
      defaultSpaceChannel({ kind: "branch", channels: [announcement] }),
    ).toBe(announcement);
  });
  it.each(["team", "community"] as const)(
    "preserves ordering in %s",
    (kind) => {
      expect(
        defaultSpaceChannel({ kind, channels: [announcement, lounge] }),
      ).toBe(announcement);
    },
  );
  it("does not invent or restore a missing default channel", () => {
    expect(defaultSpaceChannel({ kind: "branch", channels: [] })).toBeNull();
  });
});
