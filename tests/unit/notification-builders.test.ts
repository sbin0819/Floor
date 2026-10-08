import { describe, expect, it } from "vitest";
import {
  buildBookingNotifications,
  buildNotificationData,
  buildReminderNotifications,
  createReminderSchedule,
  notificationBookingSnapshot,
  type NotificationBooking,
} from "@/features/notifications/builders";
const booking: NotificationBooking = {
  id: "booking",
  during: {
    start: new Date("2026-10-08T04:00:00Z"),
    end: new Date("2026-10-08T05:00:00Z"),
  },
  title: "기획 회의",
  spaceName: "회의실 A",
  floorName: "7F",
  branchName: "강남점",
  timezone: "Asia/Seoul",
};
describe("pure notification builders", () => {
  it.each([
    [60, [30, 10, 5, 0]],
    [20, [10, 5, 0]],
    [4, [0]],
    [0, []],
    [-1, []],
    [30, [10, 5, 0]],
  ])(
    "keeps only future reminder slots at %s minutes before start",
    (minutes, expected) => {
      const now = new Date(
        booking.during.start.getTime() - Number(minutes) * 60_000,
      );
      const rows = createReminderSchedule(booking.during, now);
      expect(rows.map(({ minutesBefore }) => minutesBefore)).toEqual(expected);
      expect(
        rows.every(({ expiresAt }) => expiresAt === booking.during.end),
      ).toBe(true);
    },
  );
  it("creates reminder recipients once and strips title/actor/private IDs from data", () => {
    const rows = buildReminderNotifications(
      booking,
      ["owner", "guest", "guest"],
      new Date("2026-10-08T03:00:00Z"),
    );
    expect(rows).toHaveLength(8);
    for (const row of rows) {
      expect(row.actorId).toBeNull();
      expect(row.expiresAt).toEqual(booking.during.end);
      expect(Object.keys(row.data).sort()).toEqual(
        [
          "spaceName",
          "floorName",
          "branchName",
          "timezone",
          "start",
          "end",
          "minutesBefore",
        ].sort(),
      );
    }
  });
  it("omits the actor as recipient and keeps the immutable event snapshot", () => {
    const now = new Date("2026-10-08T03:00:00Z");
    const rows = buildBookingNotifications({
      type: "booking_invited",
      booking,
      actor: { id: "owner", name: "김하은" },
      userIds: ["owner", "guest", "guest"],
      now,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: "guest",
      actorId: "owner",
      scheduledFor: now,
      expiresAt: null,
      data: { actorName: "김하은", title: "기획 회의" },
    });
    expect(rows[0]?.data).not.toHaveProperty("userId");
    expect(rows[0]?.data).not.toHaveProperty("email");
  });
  it("requires the previous interval on change snapshots", () => {
    expect(() =>
      buildBookingNotifications({
        type: "booking_changed",
        booking,
        actor: { id: "owner", name: "김하은" },
        userIds: ["guest"],
        now: booking.during.start,
      }),
    ).toThrow("Invalid notification snapshot");
    expect(
      buildBookingNotifications({
        type: "booking_changed",
        booking,
        actor: { id: "owner", name: "김하은" },
        userIds: ["guest"],
        now: booking.during.start,
        previousDuring: booking.during,
      })[0]?.data.previousStart,
    ).toBe(booking.during.start.toISOString());
  });
  it("does not accidentally add optional actor, title or previous fields to reminder data", () => {
    const data = buildNotificationData(booking, {
      minutesBefore: 0,
      actorName: "김하은",
      previousDuring: booking.during,
    });
    expect(data).not.toHaveProperty("actorName");
    expect(data).not.toHaveProperty("title");
    expect(data).not.toHaveProperty("previousStart");
  });
  it("uses parent area and desk names together without adding raw model fields", () => {
    const snapshot = notificationBookingSnapshot({
      booking: { id: "id", during: booking.during, title: null },
      space: { name: "A-15" },
      floor: { name: "7F" },
      branch: { name: "강남점", timezone: "Asia/Seoul" },
      areaName: "오픈 데스크",
    });
    expect(snapshot.spaceName).toBe("오픈 데스크 A-15");
    expect(buildNotificationData(snapshot)).not.toHaveProperty("title");
  });
});
