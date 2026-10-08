import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BookingTimeline } from "@/features/bookings/components/booking-timeline";
import {
  editParticipantsPayload,
  editTimeOptions,
  sameBookingEdit,
} from "@/features/bookings/booking-edit";
import { selectableSlots } from "@/features/bookings/selection";
import { bookingEditFixture } from "./booking-edit-fixtures";

describe("edit draft contracts", () => {
  it("compares actual timestamps and roster identity, not ordering or search metadata", () => {
    const data = bookingEditFixture();
    const initial = {
      ...data.booking,
      title: data.booking.title ?? "",
      participants: data.participants,
    };
    expect(
      sameBookingEdit(initial, {
        ...initial,
        start: "2026-10-07T10:00:00+09:00",
        participants: initial.participants.map((person) => ({
          ...person,
          maskedEmail: "•••",
        })),
      }),
    ).toBe(true);
    expect(sameBookingEdit(initial, { ...initial, participants: [] })).toBe(
      false,
    );
    expect(sameBookingEdit(initial, { ...initial, attendeeCount: null })).toBe(
      false,
    );
  });
  it("preserves missing original/current times once and formats next-day midnight as 24:00", () => {
    expect(
      editTimeOptions(
        [{ value: "2026-10-07T15:00:00.000Z", label: "24:00" }],
        ["2026-10-07T15:00:00.000Z"],
        "2026-10-07T14:00:00.000Z",
        "Asia/Seoul",
        "end",
      ),
    ).toEqual([{ value: "2026-10-07T15:00:00.000Z", label: "24:00" }]);
    expect(
      editTimeOptions(
        [],
        ["2026-10-07T14:00:00.000Z"],
        "2026-10-07T14:00:00.000Z",
        "Asia/Seoul",
        "start",
      ),
    ).toEqual([{ value: "2026-10-07T14:00:00.000Z", label: "23:00" }]);
  });
  it("drops metadata and existing/colleague proof emails from action input", () => {
    const person = bookingEditFixture().participants[0]!;
    expect(
      editParticipantsPayload(
        [
          { ...person, email: "old@floor.example" },
          {
            ...person,
            userId: "new-team",
            sharedTeamNames: ["팀"],
            email: "team@floor.example",
          },
          { ...person, userId: "new-guest", email: "guest@floor.example" },
        ],
        [person.userId],
      ),
    ).toEqual([
      { userId: person.userId },
      { userId: "new-team" },
      { userId: "new-guest", email: "guest@floor.example" },
    ]);
  });
});
describe("timeline selection clipping", () => {
  function show(start: string, end: string, closed = false) {
    const data = bookingEditFixture();
    if (closed) data.branch.openHours = { wed: null };
    return render(
      <BookingTimeline
        slots={selectableSlots(data)}
        bookings={[]}
        blocks={[]}
        timeZone={data.branch.timezone}
        now={data.now}
        date={data.date}
        start={start}
        end={end}
        disabled={false}
        onSelect={vi.fn()}
        renderCancel={() => null}
        selectionLabel="바꾼 시간"
      />,
    );
  }
  it("clips an original reservation spanning the visible grid without losing its real label", () => {
    const view = show("2026-10-06T23:00:00.000Z", "2026-10-07T06:00:00.000Z");
    const selection = view.container.querySelector<HTMLElement>(
      "[data-booking-selection]",
    )!;
    expect(selection.style.top).toBe("calc(var(--booking-slot-height) * 0)");
    expect(selection.style.height).toBe(
      "calc(var(--booking-slot-height) * 10)",
    );
    expect(selection).toHaveTextContent("바꾼 시간 08:00–15:00");
  });
  it.each([false, true])(
    "does not draw outside or zero-length grids (closed=%s)",
    (closed) => {
      const view = show(
        "2026-10-07T14:00:00.000Z",
        "2026-10-07T15:00:00.000Z",
        closed,
      );
      expect(
        view.container.querySelector("[data-booking-selection]"),
      ).toBeNull();
      expect(screen.queryByText(/바꾼 시간/)).not.toBeInTheDocument();
    },
  );
});
