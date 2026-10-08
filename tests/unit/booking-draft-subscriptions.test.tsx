import { useEffect } from "react";
import { renderToString } from "react-dom/server";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BookingForm } from "@/features/bookings/components/booking-form";
import { spaceDayFixture } from "./booking-ui-fixtures";
import {
  BranchWorkspace,
  ResolvedSpaceSelection,
  useFloorSelection,
} from "@/features/bookings/components/branch-workspace";
import {
  useBookingDraft,
  useBookingRange,
} from "@/features/bookings/components/use-booking-draft";
import type { BookingDraftStore } from "@/features/bookings/booking-draft-store";
import { floorSelectionKey } from "@/features/bookings/floor-selection";

const spaceId = "abcdefab-1234-4abc-9def-123456789abc";
const date = "2026-10-07";
const range = { start: "2026-10-07T01:00:00Z", end: "2026-10-07T02:00:00Z" };
vi.mock("next/navigation", () => ({
  usePathname: () => "/branches/branch/floors/floor",
  useSelectedLayoutSegments: () => ["floors", "floor"],
  useSearchParams: () => new URLSearchParams(`date=${date}&space=${spaceId}`),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/features/bookings/actions", () => ({
  createBooking: vi.fn(),
  cancelBooking: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const renders = {
  navigation: vi.fn(),
  region: vi.fn(),
  range: vi.fn(),
  draft: vi.fn(),
};
function Register() {
  const register = useFloorSelection()!.registerNavigation;
  useEffect(() => register("branch", date, "2026-10-07T01:00:00Z"), [register]);
  return null;
}
function NavigationProbe() {
  const workspace = useFloorSelection()!;
  renders.navigation();
  return <output>{workspace.location.date}</output>;
}
function RegionProbe() {
  const workspace = useFloorSelection()!;
  renders.region();
  return <output>{String(workspace.detailPending)}</output>;
}
function RangeProbe({ id }: { id: string }) {
  const workspace = useFloorSelection()!;
  const selected = useBookingRange(
    workspace.draftStore,
    workspace.bookingScope,
  );
  renders.range();
  return (
    <output data-testid={`${id}-range`}>{JSON.stringify(selected)}</output>
  );
}
function Editor({ id }: { id: string }) {
  const workspace = useFloorSelection()!;
  const draft = useBookingDraft(workspace.draftStore, workspace.bookingScope);
  renders.draft();
  return (
    <>
      <input
        aria-label={`${id} 제목`}
        value={draft.title}
        onChange={(event) =>
          workspace.draftStore
            .getState()
            .changeDraft(workspace.bookingScope, { title: event.target.value })
        }
      />
      <button
        onClick={() =>
          workspace.draftStore
            .getState()
            .changeRange(workspace.bookingScope, spaceId, range)
        }
      >
        {id} 구간
      </button>
    </>
  );
}
function Frame({ id, form = false }: { id: string; form?: boolean }) {
  const data = spaceDayFixture();
  return (
    <BranchWorkspace branchId="branch">
      <Register />
      <ResolvedSpaceSelection
        selectionKey={floorSelectionKey("branch", "floor", date, spaceId)}
        spaceId={spaceId}
      >
        {null}
      </ResolvedSpaceSelection>
      <NavigationProbe />
      <RegionProbe />
      <RangeProbe id={id} />
      <Editor id={id} />
      {form && (
        <BookingForm
          data={{ ...data, space: { ...data.space, id: spaceId } }}
          variant="strip"
        />
      )}
    </BranchWorkspace>
  );
}

beforeEach(() => vi.clearAllMocks());

describe("booking draft subscriptions", () => {
  it("keeps navigation, region and timetable range readers stable during actual form input", () => {
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <Frame id="one" form />
      </QueryClientProvider>,
    );
    vi.clearAllMocks();
    fireEvent.change(screen.getByRole("textbox", { name: "제목 (선택)" }), {
      target: { value: "양식에서 입력" },
    });
    expect(screen.getByRole("textbox", { name: "one 제목" })).toHaveValue(
      "양식에서 입력",
    );
    expect(renders.draft).toHaveBeenCalledOnce();
    expect(renders.navigation).not.toHaveBeenCalled();
    expect(renders.region).not.toHaveBeenCalled();
    expect(renders.range).not.toHaveBeenCalled();
  });
  it("does not notify routing, loading or range readers while typing a title", () => {
    render(<Frame id="one" />);
    vi.clearAllMocks();
    fireEvent.change(screen.getByRole("textbox", { name: "one 제목" }), {
      target: { value: "입력한 제목" },
    });
    expect(screen.getByRole("textbox", { name: "one 제목" })).toHaveValue(
      "입력한 제목",
    );
    expect(renders.draft).toHaveBeenCalledOnce();
    expect(renders.navigation).not.toHaveBeenCalled();
    expect(renders.region).not.toHaveBeenCalled();
    expect(renders.range).not.toHaveBeenCalled();
  });

  it("updates range subscribers without rerendering routing or title readers", () => {
    render(<Frame id="one" />);
    vi.clearAllMocks();
    fireEvent.click(screen.getByRole("button", { name: "one 구간" }));
    expect(screen.getByTestId("one-range")).toHaveTextContent(range.start);
    expect(renders.range).toHaveBeenCalledOnce();
    expect(renders.navigation).not.toHaveBeenCalled();
    expect(renders.region).not.toHaveBeenCalled();
    expect(renders.draft).not.toHaveBeenCalled();
  });

  it("isolates two mounted workspaces even when both show the same branch and URL", () => {
    render(
      <>
        <Frame id="one" />
        <Frame id="two" />
      </>,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "one 제목" }), {
      target: { value: "첫 Workspace" },
    });
    fireEvent.click(screen.getByRole("button", { name: "one 구간" }));
    expect(screen.getByRole("textbox", { name: "two 제목" })).toHaveValue("");
    expect(screen.getByTestId("two-range")).toHaveTextContent("null");
    expect(screen.getByRole("textbox", { name: "one 제목" })).toHaveValue(
      "첫 Workspace",
    );
    expect(screen.getByTestId("one-range")).toHaveTextContent(range.start);
  });

  it("creates a fresh empty store per server render and keeps the initial snapshot immutable", () => {
    const stores: BookingDraftStore[] = [];
    function ServerProbe() {
      const workspace = useFloorSelection()!;
      stores.push(workspace.draftStore);
      const draft = useBookingDraft(
        workspace.draftStore,
        workspace.bookingScope,
      );
      return <span>{draft.title || "빈 제목"}</span>;
    }
    const tree = (
      <BranchWorkspace branchId="branch">
        <ServerProbe />
      </BranchWorkspace>
    );
    expect(renderToString(tree)).toContain("빈 제목");
    stores[0]!.getState().activate("first-request");
    stores[0]!.getState().changeDraft("first-request", {
      title: "다른 요청으로 보내면 안 되는 제목",
    });
    expect(renderToString(tree)).toContain("빈 제목");
    expect(stores).toHaveLength(2);
    expect(stores[0]).not.toBe(stores[1]);
    expect(stores[0]!.getInitialState().draft.title).toBe("");
    expect(stores[1]!.getState().draft.title).toBe("");
  });
});
