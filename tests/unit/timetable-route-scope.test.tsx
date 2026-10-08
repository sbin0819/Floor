import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FloorTimetable } from "@/features/bookings/components/floor-timetable";
import { timetableFixture } from "./timetable-fixtures";

const route = vi.hoisted(() => ({ scoped: true }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("view=list&date=2026-10-09"),
}));
vi.mock("@/features/bookings/components/branch-workspace", () => ({
  useFloorSelection: () =>
    route.scoped
      ? {
          search: new URLSearchParams("view=timeline&date=2026-10-07"),
          selection: null,
          location: { spaceId: null },
        }
      : null,
}));

beforeEach(() => {
  route.scoped = true;
});

describe("timetable route-scoped display", () => {
  it("keeps retained floor links and slot navigation in their own view when global search belongs to another route", () => {
    const select = vi.fn();
    render(<FloorTimetable data={timetableFixture()} onSelectSlot={select} />);
    expect(screen.getByRole("link", { name: /회의실 A/ })).toHaveAttribute(
      "href",
      "/branches/branch/floors/floor?date=2026-10-07&space=a&detail=1&view=timeline",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "회의실 A, 10:00, 비어 있음" }),
    );
    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({
        href: "/branches/branch/floors/floor?date=2026-10-07&space=a&view=timeline",
      }),
    );
  });
  it("preserves the standalone component contract without a workspace", () => {
    route.scoped = false;
    render(<FloorTimetable data={timetableFixture()} />);
    expect(screen.getByRole("link", { name: /회의실 A/ })).toHaveAttribute(
      "href",
      "/branches/branch/floors/floor?date=2026-10-07&space=a&detail=1&view=list",
    );
  });
});
