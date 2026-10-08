import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SpaceDetailContainer } from "@/features/bookings/components/space-detail-container";
import { SpaceDetailLoading } from "@/features/bookings/components/space-detail-loading";
import { floorDayFixture, spaceDayFixture } from "./booking-ui-fixtures";

const view = vi.hoisted(() => ({
  wide: true,
  mode: "timeline" as "timeline" | "list",
  current: null as ReturnType<typeof workspace> | null,
}));
vi.mock("@/features/bookings/components/floor-view", () => ({
  useFloorView: () => ({ effectiveView: view.mode }),
}));
vi.mock("@/features/bookings/components/use-wide-screen", () => ({
  useWideScreen: () => view.wide,
}));
vi.mock("@/features/bookings/components/branch-workspace", () => ({
  useFloorSelection: () => view.current,
}));
function workspace() {
  const floor = floorDayFixture();
  floor.spaces = [
    {
      ...spaceDayFixture().space,
      intervals: [],
      summary: { status: "free", until: "2026-10-07T05:00:00.000Z" },
      type: "desk_area",
      bookable: false,
      deskCount: 24,
    },
  ];
  return {
    branchId: "branch",
    location: {
      floorId: "floor",
      date: floor.date,
      spaceId: "space" as string | null,
      detail: false,
    },
    floorData: floor,
    search: new URLSearchParams("people=5&view=timeline"),
    detailCleared: false,
    detailPending: true,
    change: vi.fn(),
    restoreSpaceTrigger: vi.fn(),
  };
}
beforeEach(() => {
  view.wide = true;
  view.mode = "timeline";
  view.current = workspace();
});
describe("desk detail container", () => {
  it("uses one right Sheet without detail=1 and keeps that same dialog through the response", async () => {
    const frame = (ready: boolean) => (
      <SpaceDetailContainer>
        {ready ? <h2>좌석 배치도</h2> : <SpaceDetailLoading />}
      </SpaceDetailContainer>
    );
    const display = render(frame(false));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("data-side", "right");
    expect(
      screen.getByRole("heading", { name: "자리 고르기" }),
    ).toBeInTheDocument();
    expect(
      document.querySelector("[data-space-detail-layout=detail]"),
    ).toBeInTheDocument();
    expect(
      document.querySelector("[data-booking-strip]"),
    ).not.toBeInTheDocument();
    display.rerender(frame(true));
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(
      screen.getAllByRole("heading", { name: "좌석 배치도" }),
    ).toHaveLength(1);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(view.current!.change).toHaveBeenCalledOnce());
    const [location, href] = view.current!.change.mock.calls[0]!;
    expect(location).toMatchObject({ spaceId: null, detail: false });
    expect(
      new URL(href as string, "https://floor.example").searchParams.has(
        "space",
      ),
    ).toBe(false);
    expect(view.current!.restoreSpaceTrigger).toHaveBeenCalled();
  });
  it("uses a regular list panel and a bottom Sheet at narrower widths", () => {
    view.mode = "list";
    const display = render(
      <SpaceDetailContainer>
        <h2>좌석 배치도</h2>
      </SpaceDetailContainer>,
    );
    expect(
      document.querySelector("[data-space-detail-layout=panel]"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    view.wide = false;
    display.rerender(
      <SpaceDetailContainer>
        <h2>좌석 배치도</h2>
      </SpaceDetailContainer>,
    );
    expect(screen.getByRole("dialog")).toHaveAttribute("data-side", "bottom");
    expect(
      screen.getAllByRole("heading", { name: "좌석 배치도" }),
    ).toHaveLength(1);
  });
});
