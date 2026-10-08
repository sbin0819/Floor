import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AttendeeCountInput } from "@/components/attendee-count-input";
import {
  attendeeCountError,
  effectiveAttendeeCount,
} from "@/features/bookings/attendee-count";

function Example({
  initial = null,
  capacity = 8,
  minimum = 1,
}: {
  initial?: number | null;
  capacity?: number | null;
  minimum?: number;
}) {
  const [value, setValue] = useState(initial);
  return (
    <AttendeeCountInput
      value={value}
      capacity={capacity}
      minimum={minimum}
      onChange={setValue}
    />
  );
}

describe("attendee count input", () => {
  it("starts undecided, increments to one, and returns to undecided", async () => {
    render(<Example />);
    const input = screen.getByRole("spinbutton", { name: "사용 인원 (선택)" });
    expect(input).toHaveValue(null);
    expect(input).toHaveAttribute("placeholder", "미정");
    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(input).toHaveAccessibleDescription("정원 8명");
    await userEvent.click(screen.getByRole("button", { name: "한 명 늘리기" }));
    expect(input).toHaveValue(1);
    await userEvent.click(screen.getByRole("button", { name: "한 명 줄이기" }));
    expect(input).toHaveValue(null);
    expect(
      screen.getByRole("button", { name: "한 명 줄이기" }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("keeps its maximum button focusable but cannot increase past capacity", async () => {
    render(<Example initial={8} />);
    const increase = screen.getByRole("button", { name: "한 명 늘리기" });
    expect(increase).toHaveAttribute("aria-disabled", "true");
    expect(increase).toBeEnabled();
    await userEvent.click(increase);
    expect(screen.getByRole("spinbutton")).toHaveValue(8);
  });

  it("allows directly entered overflow to be corrected and connects its error", () => {
    render(<Example />);
    const input = screen.getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "9" } });
    expect(input).toHaveValue(9);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("정원 8명 정원은 8명이에요");
    fireEvent.change(input, { target: { value: "7" } });
    expect(input).toHaveAttribute("aria-invalid", "false");
    expect(screen.queryByText("정원은 8명이에요")).not.toBeInTheDocument();
  });

  it("stops at 500 without a capacity caption", async () => {
    render(<Example capacity={null} initial={499} />);
    await userEvent.click(screen.getByRole("button", { name: "한 명 늘리기" }));
    expect(screen.getByRole("spinbutton")).toHaveValue(500);
    expect(screen.queryByText(/정원/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "한 명 늘리기" }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("uses the participant minimum only when moving from an undecided value", async () => {
    render(<Example minimum={4} />);
    await userEvent.click(screen.getByRole("button", { name: "한 명 늘리기" }));
    expect(screen.getByRole("spinbutton")).toHaveValue(4);
    await userEvent.click(screen.getByRole("button", { name: "한 명 줄이기" }));
    expect(screen.getByRole("spinbutton")).toHaveValue(null);
  });

  it("disables all controls during a mutation", async () => {
    const onChange = vi.fn();
    render(
      <AttendeeCountInput
        value={3}
        capacity={8}
        onChange={onChange}
        disabled
      />,
    );
    expect(screen.getByRole("spinbutton")).toBeDisabled();
    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeDisabled();
      await userEvent.click(button);
    }
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("attendee count rules", () => {
  it.each([0, -1, 1.5, 501])("rejects invalid count %s", (value) => {
    expect(attendeeCountError(value, null)).toBeDefined();
  });
  it("does not treat undecided as fewer participants", () => {
    expect(attendeeCountError(null, 8, 4)).toBeUndefined();
    expect(attendeeCountError(3, 8, 4)).toBe("참석자 수보다 적을 수 없어요");
  });
  it("derives a fitting people filter only before a manual change", () => {
    expect(
      effectiveAttendeeCount(
        { attendeeCount: null, attendeeCountTouched: false },
        5,
        8,
      ),
    ).toBe(5);
    expect(
      effectiveAttendeeCount(
        { attendeeCount: null, attendeeCountTouched: false },
        5,
        4,
      ),
    ).toBeNull();
    expect(
      effectiveAttendeeCount(
        { attendeeCount: null, attendeeCountTouched: false },
        5,
        null,
      ),
    ).toBe(5);
    expect(
      effectiveAttendeeCount(
        { attendeeCount: null, attendeeCountTouched: true },
        5,
        8,
      ),
    ).toBeNull();
    expect(
      effectiveAttendeeCount(
        { attendeeCount: 3, attendeeCountTouched: true },
        5,
        8,
      ),
    ).toBe(3);
  });
});
