import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BranchNavigation } from "@/features/bookings/components/branch-navigation";
import {
  BranchWorkspace,
  ResolvedSpaceSelection,
  useFloorSelection,
} from "@/features/bookings/components/branch-workspace";
import { floorSelectionKey } from "@/features/bookings/floor-selection";
import type { BranchNavigationData } from "@/features/bookings/types";
import { floorDayFixture } from "./booking-ui-fixtures";

const navigation = vi.hoisted(() => ({
  branchId: "branch",
  floorId: "floor" as string | undefined,
  query: "",
  router: { push: vi.fn(), replace: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useParams: () => ({
    branchId: navigation.branchId,
    floorId: navigation.floorId,
  }),
  useSearchParams: () => new URLSearchParams(navigation.query),
  useRouter: () => navigation.router,
}));
const spaceId = "abcdefab-1234-4abc-9def-123456789abc";
const otherId = "abcdefab-1234-4abc-9def-123456789abd";
const date = "2026-10-07";
const selectionKey = floorSelectionKey("branch", "floor", date, spaceId);
function Selection() {
  return (
    <output data-testid="selection">
      {useFloorSelection()?.selectedSpaceId ?? "none"}
    </output>
  );
}
function resolved(key = selectionKey, id: string | null = spaceId) {
  return (
    <ResolvedSpaceSelection selectionKey={key} spaceId={id}>
      <p>상세</p>
    </ResolvedSpaceSelection>
  );
}
function fixture(): BranchNavigationData {
  const data = floorDayFixture();
  return {
    branch: data.branch,
    floors: data.floors,
    branches: [],
    today: date,
    bookingDates: [],
    now: "2026-10-07T01:10:00.000Z",
  };
}
beforeEach(() => {
  navigation.branchId = "branch";
  navigation.floorId = "floor";
  navigation.query = `date=${date}&space=${spaceId}`;
});

describe("server-confirmed floor selection", () => {
  it("does not treat a URL parameter as confirmation until the detail registers", () => {
    render(
      <BranchWorkspace>
        <Selection />
      </BranchWorkspace>,
    );
    expect(screen.getByTestId("selection")).toHaveTextContent("none");
  });
  it("synchronizes a directly entered, server-confirmed selection", () => {
    render(
      <BranchWorkspace>
        <Selection />
        {resolved()}
      </BranchWorkspace>,
    );
    expect(screen.getByTestId("selection")).toHaveTextContent(spaceId);
  });
  it("canonicalizes uppercase space and location IDs when matching the result", () => {
    navigation.branchId = "BRANCH";
    navigation.floorId = "FLOOR";
    navigation.query = `date=${date}&space=${spaceId.toUpperCase()}`;
    render(
      <BranchWorkspace>
        <Selection />
        {resolved()}
      </BranchWorkspace>,
    );
    expect(screen.getByTestId("selection")).toHaveTextContent(spaceId);
  });
  it.each(["floor", "date", "requested-space"])(
    "ignores a retained detail after %s changes",
    (change) => {
      const view = render(
        <BranchWorkspace>
          <Selection />
          {resolved()}
        </BranchWorkspace>,
      );
      if (change === "floor") navigation.floorId = "another-floor";
      if (change === "date")
        navigation.query = `date=2026-10-08&space=${spaceId}`;
      if (change === "requested-space")
        navigation.query = `date=${date}&space=${otherId}`;
      view.rerender(
        <BranchWorkspace>
          <Selection />
          {resolved()}
        </BranchWorkspace>,
      );
      expect(screen.getByTestId("selection")).toHaveTextContent("none");
    },
  );
  it("rejects a result for a different space even if its registration key matches", () => {
    render(
      <BranchWorkspace>
        <Selection />
        {resolved(selectionKey, otherId)}
      </BranchWorkspace>,
    );
    expect(screen.getByTestId("selection")).toHaveTextContent("none");
  });
  it("keeps an inaccessible direct link unselected after the server returns null", () => {
    render(
      <BranchWorkspace>
        <Selection />
        {resolved(selectionKey, null)}
      </BranchWorkspace>,
    );
    expect(screen.getByTestId("selection")).toHaveTextContent("none");
  });
  it("does not let an older registration cleanup erase its replacement", () => {
    const view = render(
      <BranchWorkspace>
        <Selection />
        <ResolvedSpaceSelection
          key="old"
          selectionKey={selectionKey}
          spaceId={spaceId}
        >
          이전
        </ResolvedSpaceSelection>
        <ResolvedSpaceSelection
          key="new"
          selectionKey={selectionKey}
          spaceId={spaceId}
        >
          새 상세
        </ResolvedSpaceSelection>
      </BranchWorkspace>,
    );
    view.rerender(
      <BranchWorkspace>
        <Selection />
        <ResolvedSpaceSelection
          key="new"
          selectionKey={selectionKey}
          spaceId={spaceId}
        >
          새 상세
        </ResolvedSpaceSelection>
      </BranchWorkspace>,
    );
    expect(screen.getByTestId("selection")).toHaveTextContent(spaceId);
  });
});

describe("persistent branch controls", () => {
  it("retains only confirmed selection on date links and drops it on floor links", () => {
    render(
      <BranchWorkspace>
        {resolved()}
        <BranchNavigation data={fixture()} />
      </BranchWorkspace>,
    );
    expect(
      screen.getByRole("link", { name: "10월 8일 목요일" }),
    ).toHaveAttribute(
      "href",
      `/branches/branch/floors/floor?date=2026-10-08&space=${spaceId}`,
    );
    expect(screen.getByRole("link", { name: "7F" })).toHaveAttribute(
      "href",
      `/branches/branch/floors/floor?date=${date}`,
    );
    expect(screen.getByRole("button", { name: "이전 7일" })).toBeDisabled();
  });
  it("drops an invalid selection from generated links and normalizes an out-of-range date", () => {
    navigation.query = "date=2099-01-01&space=invalid";
    render(
      <BranchWorkspace>
        <BranchNavigation data={fixture()} />
      </BranchWorkspace>,
    );
    expect(
      screen.getByRole("link", { name: "10월 8일 목요일" }),
    ).toHaveAttribute("href", "/branches/branch/floors/floor?date=2026-10-08");
    expect(screen.getByRole("button", { name: "이전 7일" })).toBeDisabled();
  });
  it("renders no date row or selected floor on the branch entry route", () => {
    navigation.floorId = undefined;
    render(
      <BranchWorkspace>
        <BranchNavigation data={fixture()} />
      </BranchWorkspace>,
    );
    expect(
      screen.queryByRole("navigation", { name: "날짜 선택" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { current: "page" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "층 선택" })).toBeVisible();
  });
  it("updates controls from the current URL while retaining the server-provided today", () => {
    const view = render(
      <BranchWorkspace>
        <BranchNavigation data={fixture()} />
      </BranchWorkspace>,
    );
    navigation.query = "date=2026-10-08";
    view.rerender(
      <BranchWorkspace>
        <BranchNavigation data={fixture()} />
      </BranchWorkspace>,
    );
    expect(screen.getByRole("link", { name: /^오늘 ·/ })).toHaveAttribute(
      "href",
      "/branches/branch/floors/floor?date=2026-10-07",
    );
    expect(
      screen.getByRole("link", { name: "10월 8일 목요일" }),
    ).toHaveAttribute("aria-current", "date");
  });
});
