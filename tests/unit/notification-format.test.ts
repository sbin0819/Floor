import { describe, expect, it } from "vitest";
import {
  notificationAge,
  notificationHref,
  notificationPresentation,
} from "@/features/notifications/format";
import type { NotificationItem } from "@/features/notifications/types";

const data: NotificationItem["data"] = {
  actorName: "박지훈",
  spaceName: "회의실 C",
  floorName: "7F",
  branchName: "강남점",
  timezone: "Asia/Seoul",
  start: "2026-10-08T06:00:00Z",
  end: "2026-10-08T07:00:00Z",
  title: "주간 회의",
};

describe("notification presentation", () => {
  it.each([
    ["booking_invited", "박지훈 님이 회의실 C 예약에 초대했어요"],
    ["booking_changed", "박지훈 님이 회의실 C 예약의 시간을 바꿨어요"],
    ["booking_cancelled", "박지훈 님이 회의실 C 예약을 취소했어요"],
    ["booking_removed", "박지훈 님이 회의실 C 예약의 참석자에서 뺐어요"],
    ["participant_left", "박지훈 님이 회의실 C 예약에 참석하지 않아요"],
  ] as const)("formats %s with separate emphasized names", (type, text) => {
    const result = notificationPresentation({ type, data });
    expect(result.text).toBe(text);
    expect(
      result.parts.filter((part) => part.strong).map((part) => part.text),
    ).toEqual(["박지훈", "회의실 C"]);
    expect(result.dateTime).toBe("10월 8일 목 15:00–16:00");
    expect(result.text).not.toContain("주간 회의");
  });

  it.each([30, 10, 5, 0] as const)(
    "formats the %i minute reminder",
    (minutesBefore) => {
      const result = notificationPresentation({
        type: "booking_reminder",
        data: {
          ...data,
          actorName: undefined,
          title: undefined,
          minutesBefore,
        },
      });
      expect(result.text).toBe(
        minutesBefore
          ? `${minutesBefore}분 뒤 회의실 C 예약이 시작돼요`
          : "회의실 C 예약이 시작됐어요",
      );
      expect(result.parts.filter((part) => part.strong)).toEqual([
        { text: "회의실 C", strong: true },
      ]);
    },
  );

  it("uses a neutral actor fallback and a combined desk name", () => {
    expect(
      notificationPresentation({
        type: "booking_cancelled",
        data: { ...data, actorName: undefined, spaceName: "오픈 데스크 A-15" },
      }).text,
    ).toBe("회원 님이 오픈 데스크 A-15 예약을 취소했어요");
  });

  it("shows an old-to-new time on the snapshot date", () => {
    expect(
      notificationPresentation({
        type: "booking_changed",
        data: {
          ...data,
          previousStart: "2026-10-08T05:00:00Z",
          previousEnd: "2026-10-08T06:00:00Z",
        },
      }).dateTime,
    ).toBe("10월 8일 목 14:00–15:00 → 15:00–16:00");
  });

  it("keeps both dates when a historical changed snapshot crosses dates", () => {
    expect(
      notificationPresentation({
        type: "booking_changed",
        data: {
          ...data,
          previousStart: "2026-10-07T05:00:00Z",
          previousEnd: "2026-10-07T06:00:00Z",
        },
      }).dateTime,
    ).toBe("10월 7일 수 14:00–15:00 → 10월 8일 목 15:00–16:00");
  });

  it("reuses midnight-as-24 formatting", () => {
    expect(
      notificationPresentation({
        type: "booking_invited",
        data: {
          ...data,
          start: "2026-10-08T14:00:00Z",
          end: "2026-10-08T15:00:00Z",
        },
      }).dateTime,
    ).toBe("10월 8일 목 23:00–24:00");
  });
});

describe("notification destinations", () => {
  it.each([
    "booking_invited",
    "booking_changed",
    "participant_left",
    "booking_reminder",
  ] as const)("%s uses the snapshot's local date", (type) => {
    expect(
      notificationHref({
        type,
        data: {
          ...data,
          start: "2026-10-31T16:00:00Z",
          end: "2026-10-31T17:00:00Z",
        },
      }),
    ).toBe("/bookings?view=calendar&month=2026-11&day=2026-11-01");
  });
  it("routes cancellations to history and gives removed invitations no destination", () => {
    expect(notificationHref({ type: "booking_cancelled", data })).toBe(
      "/bookings?tab=past",
    );
    expect(notificationHref({ type: "booking_removed", data })).toBeNull();
  });
  it("uses the stored timezone rather than the device timezone", () => {
    expect(
      notificationHref({
        type: "booking_invited",
        data: {
          ...data,
          timezone: "America/Los_Angeles",
          start: "2026-10-08T06:00:00Z",
        },
      }),
    ).toBe("/bookings?view=calendar&month=2026-10&day=2026-10-07");
  });
});

describe("notification age", () => {
  const now = "2026-10-08T06:00:00Z";
  it.each([
    ["2026-10-08T05:59:01Z", "방금"],
    ["2026-10-08T05:59:00Z", "1분 전"],
    ["2026-10-08T05:01:00Z", "59분 전"],
    ["2026-10-08T03:00:00Z", "3시간 전"],
    ["2026-10-07T06:00:00Z", "어제"],
    ["2026-10-02T06:00:00Z", "6일 전"],
    ["2026-10-01T06:00:00Z", "10월 1일"],
    ["2026-09-30T06:00:00Z", "9월 30일"],
  ])("formats %s as %s", (received, label) => {
    expect(notificationAge(received, now, "Asia/Seoul")).toBe(label);
  });
  it("uses elapsed minutes across midnight and local dates after an hour", () => {
    expect(
      notificationAge(
        "2026-10-07T14:45:00Z",
        "2026-10-07T15:15:00Z",
        "Asia/Seoul",
      ),
    ).toBe("30분 전");
    expect(
      notificationAge(
        "2026-10-07T14:00:00Z",
        "2026-10-07T15:30:00Z",
        "Asia/Seoul",
      ),
    ).toBe("어제");
    expect(
      notificationAge(
        "2026-10-07T14:00:00Z",
        "2026-10-07T15:30:00Z",
        "America/Los_Angeles",
      ),
    ).toBe("1시간 전");
  });
  it("counts local calendar days across daylight saving and year boundaries", () => {
    expect(
      notificationAge(
        "2026-11-01T08:30:00Z",
        "2026-11-02T08:30:00Z",
        "America/Los_Angeles",
      ),
    ).toBe("어제");
    expect(
      notificationAge(
        "2025-12-31T06:00:00Z",
        "2026-01-02T06:00:00Z",
        "Asia/Seoul",
      ),
    ).toBe("2일 전");
  });
  it("does not report a negative age and rejects malformed timestamps", () => {
    expect(notificationAge("2026-10-08T06:00:01Z", now, "Asia/Seoul")).toBe(
      "방금",
    );
    expect(() => notificationAge("invalid", now, "Asia/Seoul")).toThrow(
      RangeError,
    );
  });
});
