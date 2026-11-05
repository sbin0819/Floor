import { afterEach, describe, expect, it, vi } from "vitest";
import { buildWelcomeNotification } from "@/features/notifications/builders";
import { fetchNotificationSummary } from "@/features/notifications/client";
import {
  notificationHref,
  notificationPresentation,
  welcomeNotificationDetail,
} from "@/features/notifications/format";
import {
  notificationTypes,
  parseNotificationContent,
  parseNotificationData,
} from "@/features/notifications/types";

const now = new Date("2026-11-05T03:00:00Z");
const data = { name: "김하은" };
const item = {
  type: "welcome" as const,
  data,
  bookingId: null,
  href: "/" as const,
  id: "welcome",
  actorAvatar: null,
  read: false,
  scheduledFor: now.toISOString(),
};
const summary = {
  items: [item],
  now: now.toISOString(),
  unreadCount: 1,
  nextAt: null,
};
afterEach(() => vi.unstubAllGlobals());

describe("welcome notification snapshots", () => {
  it("adds the kind, keeps only the signup name and points home", () => {
    expect(notificationTypes).toContain("welcome");
    expect(parseNotificationContent("welcome", data, "booking")).toEqual({
      type: "welcome",
      data,
      bookingId: null,
    });
    expect(notificationHref(item)).toBe("/");
    expect(notificationPresentation(item)).toEqual({
      text: "환영해요, 김하은 님! Floor에 처음 오셨네요",
      parts: [
        { text: "환영해요, ", strong: false },
        { text: "김하은", strong: true },
        { text: " 님! Floor에 처음 오셨네요", strong: false },
      ],
      dateTime: undefined,
      detail: welcomeNotificationDetail,
    });
  });
  it.each([
    {},
    { name: "" },
    { name: "김하은", email: "private@example.test" },
    { name: "김하은", userId: "private" },
    { name: "김하은", actorName: "운영자" },
  ])("rejects malformed or private extra fields: %j", (invalid) => {
    expect(parseNotificationData("welcome", invalid)).toBeNull();
  });
  it("builds exactly one actorless row for the new member at signup time", () => {
    expect(
      buildWelcomeNotification({ userId: "user-1", name: "김하은", now }),
    ).toEqual([
      {
        type: "welcome",
        data,
        bookingId: null,
        userId: "user-1",
        actorId: null,
        scheduledFor: now,
        expiresAt: null,
      },
    ]);
  });
  it("accepts the summary item only with the home destination", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json(summary))
        .mockResolvedValueOnce(
          Response.json({ ...summary, items: [{ ...item, href: "/teams" }] }),
        ),
    );
    expect(
      await fetchNotificationSummary(new AbortController().signal),
    ).toEqual(summary);
    await expect(
      fetchNotificationSummary(new AbortController().signal),
    ).rejects.toMatchObject({ kind: "invalid_response" });
  });
});
