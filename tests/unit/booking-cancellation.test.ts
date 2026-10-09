import { describe, expect, it } from "vitest";
import {
  bookingCancellationText,
  cancellationReasonSchema,
} from "@/features/bookings/cancellation";
import { buildBookingNotifications } from "@/features/notifications/builders";
import { parseNotificationData } from "@/features/notifications/types";
import { notificationPresentation } from "@/features/notifications/format";
import {
  parseSystemMessageData,
  systemMessageText,
} from "@/features/chat/system-messages";

const booking = {
  id: "booking",
  during: {
    start: new Date("2026-10-07T03:00:00Z"),
    end: new Date("2026-10-07T04:00:00Z"),
  },
  spaceName: "회의실 C",
  floorName: "7F",
  branchName: "강남점",
  timezone: "Asia/Seoul",
};
describe("booking cancellation records", () => {
  it.each(["operator", "maintenance"] as const)(
    "keeps %s reasons in paired notification and meeting snapshots",
    (kind) => {
      const rows = buildBookingNotifications({
        type: "booking_cancelled",
        booking,
        actor: { id: "operator", name: "김도윤" },
        userIds: ["owner", "guest", "operator"],
        now: booking.during.start,
        cancellation: { kind, reason: "냉방기 점검" },
      });
      expect(rows.map(({ userId }) => userId)).toEqual(["owner", "guest"]);
      const data = rows[0]!.data;
      expect(parseNotificationData("booking_cancelled", data)).toEqual(data);
      const text = notificationPresentation({
        type: "booking_cancelled",
        data,
      });
      expect(text.text).toBe(
        kind === "operator"
          ? "운영자가 회의실 C 예약을 취소했어요"
          : "점검으로 회의실 C 예약이 취소됐어요",
      );
      expect(text.dateTime).toMatch(
        kind === "operator" ? /^이유: 냉방기 점검 · / : /^냉방기 점검 · /,
      );
      expect(bookingCancellationText(data)).toBe(
        `${kind === "operator" ? "운영자가 취소함" : "점검으로 취소됨"} · 냉방기 점검`,
      );
      const system = {
        type: "booking_cancelled" as const,
        actorName: "김도윤",
        cancelKind: kind,
        reason: "냉방기 점검",
      };
      expect(parseSystemMessageData(system)).toEqual(system);
      expect(systemMessageText(system)).toBe(
        `${kind === "operator" ? "운영자가 예약을 취소했어요" : "점검으로 예약이 취소됐어요"} (냉방기 점검)`,
      );
    },
  );
  it("preserves ordinary cancellation text and data", () => {
    const [row] = buildBookingNotifications({
      type: "booking_cancelled",
      booking,
      actor: { id: "owner", name: "김하은" },
      userIds: ["guest"],
      now: booking.during.start,
    });
    expect(row!.data).not.toHaveProperty("cancelKind");
    expect(
      notificationPresentation({ type: "booking_cancelled", data: row!.data })
        .text,
    ).toBe("김하은 님이 회의실 C 예약을 취소했어요");
    expect(
      systemMessageText({ type: "booking_cancelled", actorName: "김하은" }),
    ).toBe("김하은 님이 예약을 취소했어요");
    expect(bookingCancellationText({})).toBe("취소됨");
  });
  it("rejects unpaired or misplaced cancellation fields", () => {
    const [row] = buildBookingNotifications({
      type: "booking_cancelled",
      booking,
      actor: { id: "owner", name: "김하은" },
      userIds: ["guest"],
      now: booking.during.start,
    });
    const data = row!.data;
    expect(
      parseNotificationData("booking_cancelled", {
        ...data,
        cancelKind: "operator",
      }),
    ).toBeNull();
    expect(
      parseNotificationData("booking_cancelled", {
        ...data,
        cancelReason: "이유",
      }),
    ).toBeNull();
    for (const type of [
      "booking_invited",
      "booking_changed",
      "booking_reminder",
      "booking_removed",
      "participant_left",
    ] as const) {
      expect(
        parseNotificationData(type, {
          ...data,
          cancelKind: "operator",
          cancelReason: "이유",
        }),
      ).toBeNull();
    }
    expect(
      parseSystemMessageData({
        type: "booking_cancelled",
        actorName: "이름",
        cancelKind: "operator",
      }),
    ).toBeNull();
    expect(
      parseSystemMessageData({
        type: "booking_cancelled",
        actorName: "이름",
        reason: "이유",
      }),
    ).toBeNull();
  });
  it("uses PostgreSQL-compatible Unicode length", () => {
    expect(cancellationReasonSchema.safeParse("😀".repeat(200)).success).toBe(
      true,
    );
    expect(cancellationReasonSchema.safeParse("😀".repeat(201)).success).toBe(
      false,
    );
    expect(cancellationReasonSchema.safeParse("").success).toBe(false);
  });
});
