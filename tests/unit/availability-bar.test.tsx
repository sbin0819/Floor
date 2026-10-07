import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AvailabilityBar } from "@/features/bookings/components/availability-bar";
import type { AvailabilityInterval } from "@/features/bookings/availability";

const window = {
  start: "2026-10-07T08:00:00+09:00",
  end: "2026-10-07T22:00:00+09:00",
};
const timeZone = "Asia/Seoul";
const intervals: AvailabilityInterval[] = [
  {
    start: "2026-10-07T09:00:00+09:00",
    end: "2026-10-07T10:00:00+09:00",
    kind: "other",
  },
  {
    start: "2026-10-07T11:00:00+09:00",
    end: "2026-10-07T12:00:00+09:00",
    kind: "mine",
  },
  {
    start: "2026-10-07T14:00:00+09:00",
    end: "2026-10-07T15:00:00+09:00",
    kind: "maintenance",
  },
];

describe("AvailabilityBar", () => {
  it("provides an empty-state image label and presentation-only ticks", () => {
    const { container } = render(
      <AvailabilityBar intervals={[]} window={window} timeZone={timeZone} />,
    );
    expect(
      screen.getByRole("img", { name: "예약된 시간이 없어요" }),
    ).toHaveClass("bg-status-free", "h-3");
    expect(
      container.querySelector('[data-slot="availability-ticks"]'),
    ).toHaveAttribute("aria-hidden", "true");
    for (const tick of ["08", "12", "16", "20", "22"])
      expect(screen.getByText(tick)).toBeVisible();
    expect(
      container.querySelector('[data-slot="availability-now"]'),
    ).toBeNull();
  });

  it("exposes a textual equivalent and distinct state tokens", () => {
    const { container } = render(
      <AvailabilityBar
        intervals={intervals}
        window={window}
        timeZone={timeZone}
      />,
    );
    expect(
      screen.getByRole("img", {
        name: "예약 09:00–10:00, 내 예약 11:00–12:00, 점검 14:00–15:00",
      }),
    ).toBeVisible();
    expect(container.querySelector('[data-kind="other"]')).toHaveClass(
      "bg-booked-strong",
    );
    expect(container.querySelector('[data-kind="mine"]')).toHaveClass(
      "bg-status-mine-strong",
    );
    expect(container.querySelector('[data-kind="maintenance"]')).toHaveClass(
      "bg-status-maintenance-hatch",
    );
  });

  it("layers maintenance above my overlapping booking", () => {
    const { container } = render(
      <AvailabilityBar
        intervals={[intervals[1]!, { ...intervals[1]!, kind: "maintenance" }]}
        window={window}
        timeZone={timeZone}
      />,
    );
    expect(container.querySelectorAll("[data-kind]")).toHaveLength(2);
    expect(container.querySelector('[data-kind="mine"]')).toHaveClass("z-10");
    expect(container.querySelector('[data-kind="maintenance"]')).toHaveClass(
      "z-20",
    );
  });

  it("positions the supplied clock and past overlay without acquiring its own clock", () => {
    const { container } = render(
      <AvailabilityBar
        intervals={[]}
        window={window}
        timeZone={timeZone}
        now="2026-10-07T15:00:00+09:00"
      />,
    );
    expect(
      container.querySelector('[data-slot="availability-past"]'),
    ).toHaveStyle({ width: "50%" });
    expect(
      container.querySelector('[data-slot="availability-now"]'),
    ).toHaveStyle({ left: "50%" });
  });

  it("can hide ticks without removing the accessible summary", () => {
    const { container } = render(
      <AvailabilityBar
        intervals={intervals}
        window={window}
        timeZone={timeZone}
        showTicks={false}
      />,
    );
    expect(screen.getByRole("img")).toBeVisible();
    expect(
      container.querySelector('[data-slot="availability-ticks"]'),
    ).toBeNull();
  });

  it("omits a closed-day bar", () => {
    const { container } = render(
      <AvailabilityBar intervals={[]} window={null} timeZone={timeZone} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
