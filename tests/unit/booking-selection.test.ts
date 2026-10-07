import { describe, expect, it } from "vitest";
import {
  selectableEnds,
  selectableSlots,
  suggestedEnd,
} from "@/features/bookings/selection";
import {
  formatBookingDate,
  formatBookingTime,
} from "@/features/bookings/format";
import { bookingErrorMessage } from "@/features/bookings/ui-errors";
import { spaceDayFixture } from "./booking-ui-fixtures";

describe("booking UI selection", () => {
  it("excludes past, reserved and blocked half-hours", () => {
    const slots = selectableSlots(spaceDayFixture());
    expect(
      slots.filter((slot) => slot.state === "free").map((slot) => slot.label),
    ).toEqual(["10:00", "10:30", "12:00", "12:30", "13:30"]);
    expect(slots.find((slot) => slot.label === "09:30")?.state).toBe("past");
    expect(slots.find((slot) => slot.label === "11:00")?.state).toBe(
      "reserved",
    );
    expect(slots.find((slot) => slot.label === "13:00")?.state).toBe(
      "maintenance",
    );
  });
  it("only permits contiguous end times, including the edge next to a booking", () => {
    const slots = selectableSlots(spaceDayFixture());
    const start = slots.find((slot) => slot.label === "10:00")!.start;
    expect(selectableEnds(slots, start).map((slot) => slot.endLabel)).toEqual([
      "10:30",
      "11:00",
    ]);
    expect(suggestedEnd(slots, start)).toBe("2026-10-07T02:00:00.000Z");
    expect(
      suggestedEnd(slots, slots.find((slot) => slot.label === "13:30")!.start),
    ).toBe("2026-10-07T05:00:00.000Z");
    expect(selectableEnds(slots, "missing")).toEqual([]);
    expect(
      selectableEnds(
        slots,
        slots.find((slot) => slot.label === "11:00")!.start,
      ),
    ).toEqual([]);
  });
  it("clips the suggested hour at a block or closing time", () => {
    const slots = selectableSlots(spaceDayFixture());
    const start = slots.find((slot) => slot.label === "12:30")!.start;
    expect(suggestedEnd(slots, start)).toBe("2026-10-07T04:00:00.000Z");
  });
  it("formats Korean dates and midnight without depending on the host time zone", () => {
    expect(formatBookingDate("2026-10-07", "Asia/Seoul")).toBe(
      "10월 7일 수요일",
    );
    expect(
      formatBookingTime(
        "2026-10-07T14:00:00Z",
        "2026-10-07T15:00:00Z",
        "Asia/Seoul",
      ),
    ).toBe("23:00–24:00");
  });
});

describe("booking UI errors", () => {
  it("uses fixed messages instead of displaying arbitrary server text", () => {
    expect(
      bookingErrorMessage({ code: "INTERNAL", message: "database-secret" }),
    ).not.toContain("database-secret");
    expect(
      bookingErrorMessage({
        code: "LIMIT_EXCEEDED",
        message: "database-secret",
      }),
    ).toBe("예약 한도를 확인해 주세요");
    expect(
      bookingErrorMessage({ code: "FORBIDDEN" }, { restricted: true }),
    ).toBe("이 공간은 지정된 팀만 예약할 수 있어요");
    expect(
      bookingErrorMessage(
        { code: "LIMIT_EXCEEDED", message: "per_day" },
        { isToday: false },
      ),
    ).toBe("이 날 예약할 수 있는 시간을 다 썼어요");
  });
});
