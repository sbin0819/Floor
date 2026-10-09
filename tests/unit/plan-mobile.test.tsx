import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanSpaceSummary } from "@/features/floor-plan/components/plan-space-summary";
import { PlanTouchHint } from "@/features/floor-plan/components/plan-touch-hint";
import { SpaceDetailContainer } from "@/features/bookings/components/space-detail-container";
import { SpaceDetail } from "@/features/bookings/components/space-detail";
import { floorDayFixture, spaceDayFixture } from "./booking-ui-fixtures";

const current = vi.hoisted(() => ({
  wide: false,
  workspace: null as ReturnType<typeof workspace> | null,
}));
vi.mock("@/features/bookings/components/use-wide-screen", () => ({
  useWideScreen: () => current.wide,
}));
vi.mock("@/features/bookings/components/floor-view", () => ({
  useFloorView: () => ({ effectiveView: "plan" }),
}));
vi.mock("@/features/bookings/components/branch-workspace", () => ({
  useFloorSelection: () => current.workspace,
}));
vi.mock("@/components/photos/photo-gallery", () => ({
  PhotoGallery: () => <div>사진</div>,
}));
vi.mock("@/features/bookings/components/booking-form", () => ({
  BookingForm: () => <input aria-label="예약 제목" />,
}));
vi.mock("@/features/bookings/components/floor-navigation-link", () => ({
  FloorNavigationLink: ({
    children,
    href,
    "aria-label": label,
  }: {
    children: React.ReactNode;
    href: string;
    "aria-label"?: string;
  }) => (
    <a href={href} aria-label={label}>
      {children}
    </a>
  ),
}));
function workspace() {
  const data = spaceDayFixture();
  return {
    branchId: data.branch.id,
    floorData: floorDayFixture(),
    location: {
      floorId: data.floor.id,
      date: data.date,
      spaceId: data.space.id,
      detail: false,
    },
    detailCleared: false,
    detailPending: false,
    search: new URLSearchParams("view=plan"),
    change: vi.fn(),
    restoreSpaceTrigger: vi.fn(),
  };
}
beforeEach(() => {
  current.wide = false;
  current.workspace = workspace();
  localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());
describe("mobile floor plan", () => {
  it("shows a compact summary and the same-space detail link without a booking form", () => {
    const data = spaceDayFixture();
    render(<PlanSpaceSummary data={data} now={data.now} />);
    expect(
      screen.getByRole("heading", { name: data.space.name }),
    ).toBeVisible();
    expect(screen.getByText(`최대 ${data.space.capacity}인`)).toBeVisible();
    expect(screen.getByRole("img")).toBeVisible();
    const href = new URL(
      screen
        .getByRole("link", { name: "시간 고르고 예약하기" })
        .getAttribute("href")!,
      "https://floor.test",
    );
    expect(href.searchParams.get("space")).toBe(data.space.id);
    expect(href.searchParams.get("detail")).toBe("1");
    expect(href.searchParams.get("view")).toBe("plan");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
  it("keeps one nonmodal dialog when summary changes to full detail and permits interacting behind it", () => {
    const tree = (detail: boolean) => (
      <>
        <button>평면도 뒤 공간</button>
        <SpaceDetailContainer>
          {detail ? <input aria-label="예약 제목" /> : <p>공간 요약 내용</p>}
        </SpaceDetailContainer>
      </>
    );
    const display = render(tree(false));
    const dialog = screen.getByRole("dialog");
    expect(document.querySelector('[data-slot="sheet-overlay"]')).toBeNull();
    expect(dialog).toHaveClass("max-h-[50dvh]");
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "평면도 뒤 공간" }),
    );
    expect(current.workspace!.change).not.toHaveBeenCalled();
    current.workspace!.location.detail = true;
    display.rerender(tree(true));
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(dialog).toHaveClass("max-h-[85dvh]");
    expect(screen.getByRole("textbox", { name: "예약 제목" })).toBeVisible();
  });
  it("remembers the dismissed touch hint and does not display it on desktop", async () => {
    const display = render(<PlanTouchHint />);
    fireEvent.click(
      await screen.findByRole("button", { name: "평면도 조작 안내 닫기" }),
    );
    display.unmount();
    render(<PlanTouchHint />);
    await waitFor(() =>
      expect(
        screen.queryByText("두 손가락으로 확대·이동"),
      ).not.toBeInTheDocument(),
    );
    expect(localStorage.getItem("floor-plan-touch-hint-dismissed")).toBe("1");
  });
  it("moves keyboard focus to the detail heading without remounting the dialog", () => {
    const data = spaceDayFixture();
    const tree = () => (
      <SpaceDetailContainer>
        <SpaceDetail data={data} />
      </SpaceDetailContainer>
    );
    const display = render(tree());
    const dialog = screen.getByRole("dialog");
    screen.getByRole("link", { name: "시간 고르고 예약하기" }).focus();
    current.workspace!.location.detail = true;
    display.rerender(tree());
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(
      screen.getByRole("heading", { name: data.space.name }),
    ).toHaveFocus();
  });
  it("allows dismissing the hint even if browser storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<PlanTouchHint />);
    fireEvent.click(
      await screen.findByRole("button", { name: "평면도 조작 안내 닫기" }),
    );
    expect(
      screen.queryByText("두 손가락으로 확대·이동"),
    ).not.toBeInTheDocument();
  });
});
