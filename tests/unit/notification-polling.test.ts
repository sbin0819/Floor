import { describe, expect, it } from "vitest";
import {
  newlyPublishedNotifications,
  notificationReminderDelay,
  notificationToastId,
} from "@/features/notifications/polling";
import type { NotificationSummary } from "@/features/notifications/types";

const now = "2026-10-08T05:55:00Z";
describe("notification polling and toast decisions", () => {
  it.each([
    [null, null],
    ["2026-10-08T05:55:00Z", 1_000],
    ["2026-10-08T05:55:30Z", 31_000],
    ["2026-10-08T05:56:00Z", 61_000],
    ["2026-10-08T05:56:01Z", null],
    ["2026-10-08T05:54:59Z", null],
  ])("uses response-relative nextAt %s", (nextAt, expected) => {
    expect(notificationReminderDelay({ now, nextAt })).toBe(expected);
  });
  it("uses previous response time rather than seen IDs and excludes already-read items", () => {
    const item = {
      id: "previously-seen",
      type: "booking_invited" as const,
      read: false,
      scheduledFor: "2026-10-08T05:55:10Z",
      bookingId: null,
      data: {
        spaceName: "회의실",
        floorName: "7F",
        branchName: "강남점",
        timezone: "Asia/Seoul",
        start: "2026-10-08T06:00:00Z",
        end: "2026-10-08T07:00:00Z",
      },
      href: "/bookings",
    };
    const summary: NotificationSummary = {
      now: "2026-10-08T05:56:00Z",
      nextAt: null,
      unreadCount: 10,
      items: [
        item,
        { ...item, id: "read", read: true },
        { ...item, id: "new-id-old-time", scheduledFor: now },
      ],
    };
    expect(newlyPublishedNotifications(summary, now)).toEqual([item]);
    expect(newlyPublishedNotifications(summary, summary.now)).toEqual([]);
    expect(
      newlyPublishedNotifications({ ...summary, now }, summary.now),
    ).toEqual([]);
    expect(notificationToastId(item)).toBe(item.id);
    expect(
      notificationToastId({
        ...item,
        type: "booking_reminder",
        bookingId: "booking",
      }),
    ).toBe("reminder:booking");
  });
});
