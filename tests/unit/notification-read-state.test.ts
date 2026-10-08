import { describe, expect, it } from "vitest";
import { applyNotificationRead } from "@/features/notifications/read-state";
import type {
  NotificationItem,
  NotificationSummary,
} from "@/features/notifications/types";

const item: NotificationItem = {
  id: "first",
  type: "booking_reminder",
  read: false,
  actorAvatar: null,
  scheduledFor: "2026-10-08T05:50:00Z",
  bookingId: "booking",
  href: "/bookings",
  data: {
    spaceName: "회의실",
    floorName: "7F",
    branchName: "강남점",
    timezone: "Asia/Seoul",
    start: "2026-10-08T06:00:00Z",
    end: "2026-10-08T07:00:00Z",
    minutesBefore: 10,
  },
};
const initial: NotificationSummary = {
  items: [item],
  unreadCount: 12,
  now: "2026-10-08T05:55:00Z",
  nextAt: "2026-10-08T06:00:00Z",
};
describe("notification optimistic reads", () => {
  it("reads one without mutating the source or dropping summary metadata", () => {
    const next = applyNotificationRead(initial, { kind: "one", item });
    expect(next).toEqual({
      ...initial,
      items: [{ ...item, read: true }],
      unreadCount: 11,
    });
    expect(initial.items[0]!.read).toBe(false);
    expect(applyNotificationRead(next, { kind: "one", item })).toEqual(next);
  });
  it("reduces the shared bell count when the clicked page row is outside the bell's latest 20", () => {
    const clicked = { ...item, id: "older", bookingId: "other" };
    expect(
      applyNotificationRead(initial, { kind: "one", item: clicked }),
    ).toEqual({ ...initial, unreadCount: 11 });
    expect(
      applyNotificationRead(initial, {
        kind: "one",
        item: { ...clicked, read: true },
      }),
    ).toEqual(initial);
  });
  it("reads the visible reminder of the same booking even when its row ID changed", () => {
    const clicked = { ...item, id: "previous" };
    expect(
      applyNotificationRead(initial, { kind: "one", item: clicked }).items[0]!
        .read,
    ).toBe(true);
  });
  it("reads all and clamps a stale count at zero", () => {
    expect(applyNotificationRead(initial, { kind: "all" })).toEqual({
      ...initial,
      items: [{ ...item, read: true }],
      unreadCount: 0,
    });
    expect(
      applyNotificationRead(
        { ...initial, unreadCount: 0 },
        { kind: "one", item },
      ).unreadCount,
    ).toBe(0);
  });
  it("does not reduce a newer summary for an expired or not-yet-published row absent from its latest items", () => {
    const expired = { ...initial, items: [], now: "2026-10-08T07:00:00Z" };
    expect(applyNotificationRead(expired, { kind: "one", item })).toEqual(
      expired,
    );
    const future = {
      ...item,
      type: "booking_invited" as const,
      id: "future",
      scheduledFor: "2026-10-08T06:00:00Z",
    };
    expect(
      applyNotificationRead(initial, { kind: "one", item: future }),
    ).toEqual(initial);
  });
});
