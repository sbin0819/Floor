import { describe, expect, it } from "vitest";
import {
  parseNotificationData,
  type NotificationData,
} from "@/features/notifications/types";

const data: NotificationData = {
  spaceName: "회의실 A",
  floorName: "7F",
  branchName: "강남점",
  timezone: "Asia/Seoul",
  start: "2026-10-08T04:00:00Z",
  end: "2026-10-08T05:00:00Z",
};
describe("strict notification snapshots", () => {
  it("accepts ordinary, changed and reminder snapshots", () => {
    expect(
      parseNotificationData("booking_invited", {
        ...data,
        actorName: "김하은",
        title: "회의",
      }),
    ).not.toBeNull();
    expect(
      parseNotificationData("booking_changed", {
        ...data,
        previousStart: "2026-10-08T03:00:00Z",
        previousEnd: "2026-10-08T04:00:00Z",
      }),
    ).not.toBeNull();
    for (const minutesBefore of [30, 10, 5, 0])
      expect(
        parseNotificationData("booking_reminder", { ...data, minutesBefore }),
      ).not.toBeNull();
  });
  it.each(["email", "userId", "bookingId", "unknown"])(
    "rejects unexpected %s in data",
    (key) => {
      expect(
        parseNotificationData("booking_invited", { ...data, [key]: "private" }),
      ).toBeNull();
    },
  );
  it.each(["actorName", "title", "previousStart", "previousEnd"])(
    "rejects %s on reminders",
    (key) => {
      expect(
        parseNotificationData("booking_reminder", {
          ...data,
          minutesBefore: 5,
          [key]: key.startsWith("previous") ? data.start : "private",
        }),
      ).toBeNull();
    },
  );
  it("requires a supported minute offset only on reminders", () => {
    expect(parseNotificationData("booking_reminder", data)).toBeNull();
    expect(
      parseNotificationData("booking_reminder", { ...data, minutesBefore: 15 }),
    ).toBeNull();
    expect(
      parseNotificationData("booking_invited", { ...data, minutesBefore: 5 }),
    ).toBeNull();
  });
  it("requires a complete positive previous interval only for a change", () => {
    expect(parseNotificationData("booking_changed", data)).toBeNull();
    expect(
      parseNotificationData("booking_changed", {
        ...data,
        previousStart: data.start,
      }),
    ).toBeNull();
    expect(
      parseNotificationData("booking_changed", {
        ...data,
        previousStart: data.end,
        previousEnd: data.start,
      }),
    ).toBeNull();
    expect(
      parseNotificationData("booking_invited", {
        ...data,
        previousStart: data.start,
        previousEnd: data.end,
      }),
    ).toBeNull();
  });
  it.each([
    { timezone: "invalid" },
    { start: "not-time" },
    { end: data.start },
    { actorName: null },
    { spaceName: "" },
    { title: null },
  ])("skips invalid payload %j", (extra) => {
    expect(
      parseNotificationData("booking_invited", { ...data, ...extra }),
    ).toBeNull();
  });
});
