import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createBooking } from "@/features/bookings/actions";
import { BookingForm } from "@/features/bookings/components/booking-form";
import {
  BranchWorkspace,
  ResolvedSpaceSelection,
  useFloorSelection,
} from "@/features/bookings/components/branch-workspace";
import { floorSelectionKey } from "@/features/bookings/floor-selection";
import type { SpaceDayData } from "@/features/bookings/types";
import type { ActionResult } from "@/lib/actions/result";
import { spaceDayFixture } from "./booking-ui-fixtures";

const route = vi.hoisted(() => ({
  query: "",
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useSelectedLayoutSegments: () => ["floors", "floor"],
  usePathname: () => "/branches/branch/floors/floor",
  useParams: () => ({ branchId: "branch", floorId: "floor" }),
  useSearchParams: () => new URLSearchParams(route.query),
  useRouter: () => ({
    push: route.push,
    replace: route.replace,
    refresh: route.refresh,
  }),
}));
vi.mock("@/features/bookings/actions", () => ({
  createBooking: vi.fn(),
  cancelBooking: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const first = "abcdefab-1234-4abc-9def-123456789ab1";
const second = "abcdefab-1234-4abc-9def-123456789ab2";
const teamId = "abcdefab-1234-4abc-9def-123456789ab3";
const start = "2026-10-07T01:00:00.000Z";
const end = "2026-10-07T02:00:00.000Z";
type Layout = "strip" | "detail" | "panel";
function fixture(spaceId = first): SpaceDayData {
  const data = spaceDayFixture();
  return {
    ...data,
    space: { ...data.space, id: spaceId },
    actors: [
      ...data.actors,
      { ...data.actors[0]!, teamId, name: "가상 팀으로" },
    ],
    hasTeams: true,
  };
}
function Controls({ data }: { data: SpaceDayData }) {
  const workspace = useFloorSelection()!;
  const register = workspace.registerNavigation;
  useEffect(
    () => register(data.branch.id, data.date, data.now),
    [register, data.branch.id, data.date, data.now],
  );
  return (
    <>
      <output data-testid="draft">{JSON.stringify(workspace.draft)}</output>
      <output data-testid="range">{JSON.stringify(workspace.selection)}</output>
      <button
        onClick={() => workspace.changeRange(data.space.id, { start, end })}
      >
        구간 고르기
      </button>
      <button
        onClick={() =>
          workspace.changeDraft(data.space.id, {
            title: "새 공간 제목",
            actorId: teamId,
          })
        }
      >
        새 공간 작성
      </button>
    </>
  );
}
function Frame({
  client,
  data,
  layout,
}: {
  client: QueryClient;
  data: SpaceDayData;
  layout: Layout;
}) {
  const search = new URLSearchParams(route.query);
  return (
    <QueryClientProvider client={client}>
      <BranchWorkspace branchId="branch">
        <Controls data={data} />
        <ResolvedSpaceSelection
          selectionKey={floorSelectionKey(
            "branch",
            "floor",
            search.get("date") ?? undefined,
            search.get("space") ?? undefined,
          )}
          spaceId={data.space.id}
        >
          <div key={layout} data-testid="layout" data-layout={layout}>
            <BookingForm
              key={`${data.space.id}:${data.date}`}
              data={data}
              variant={layout === "strip" ? "strip" : "panel"}
            />
          </div>
        </ResolvedSpaceSelection>
      </BranchWorkspace>
    </QueryClientProvider>
  );
}
function display(initial = fixture()) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  let data = initial;
  let layout: Layout = "strip";
  const updateRoute = () => {
    route.query = `date=${data.date}&space=${data.space.id}&view=${layout === "panel" ? "list" : "timeline"}${layout === "detail" ? "&detail=1" : ""}`;
  };
  updateRoute();
  const view = render(<Frame client={client} data={data} layout={layout} />);
  return {
    ...view,
    receive(nextLayout: Layout, nextData = data) {
      data = nextData;
      layout = nextLayout;
      updateRoute();
      view.rerender(<Frame client={client} data={data} layout={layout} />);
    },
  };
}
const draft = () =>
  JSON.parse(screen.getByTestId("draft").textContent ?? "null") as {
    title: string;
    actorId: string | null;
  };
const title = () => screen.getByRole("textbox", { name: "제목 (선택)" });
const actor = () => screen.getByRole("combobox", { name: "예약 방식" });
async function chooseTeam() {
  await userEvent.click(actor());
  await userEvent.click(screen.getByRole("option", { name: "가상 팀으로" }));
}
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createBooking).mockResolvedValue({
    ok: true,
    data: { bookingId: "new" },
  });
});

describe("booking form shared draft", () => {
  it("stores title and actor without a range and restores them when the detail form remounts", async () => {
    const view = display();
    const originalInput = title();
    await userEvent.type(originalInput, "구간보다 먼저 적은 제목");
    await chooseTeam();
    expect(screen.getByTestId("range")).toHaveTextContent("null");
    view.receive("detail");
    expect(
      screen.queryByRole("textbox", { name: "제목 (선택)" }),
    ).not.toBeInTheDocument();
    expect(draft()).toEqual({
      title: "구간보다 먼저 적은 제목",
      actorId: teamId,
    });
    await userEvent.click(screen.getByRole("button", { name: "구간 고르기" }));
    await userEvent.click(
      screen.getByRole("button", { name: "시간·제목 바꾸기" }),
    );
    expect(title()).not.toBe(originalInput);
    expect(title()).toHaveValue("구간보다 먼저 적은 제목");
    expect(actor()).toHaveTextContent("가상 팀으로");
  });

  it("preserves the range and input payload across detail open/close and a list-view remount", async () => {
    const view = display();
    await userEvent.click(screen.getByRole("button", { name: "구간 고르기" }));
    await userEvent.type(title(), "팀 기획 회의");
    await chooseTeam();
    view.receive("detail");
    expect(
      screen.getByRole("button", { name: "시간·제목 바꾸기" }),
    ).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(
      screen.getByRole("button", { name: "시간·제목 바꾸기" }),
    );
    expect(title()).toHaveValue("팀 기획 회의");
    expect(actor()).toHaveTextContent("가상 팀으로");
    view.receive("strip");
    expect(title()).toHaveValue("팀 기획 회의");
    expect(actor()).toHaveTextContent("가상 팀으로");
    view.receive("panel");
    expect(
      screen.getByRole("button", { name: "시간·제목 바꾸기" }),
    ).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(
      screen.getByRole("button", { name: "시간·제목 바꾸기" }),
    );
    expect(title()).toHaveValue("팀 기획 회의");
    expect(actor()).toHaveTextContent("가상 팀으로");
    expect(screen.getByTestId("range")).toHaveTextContent(start);
    await userEvent.click(screen.getByRole("button", { name: "예약하기" }));
    await waitFor(() =>
      expect(createBooking).toHaveBeenCalledExactlyOnceWith({
        spaceId: first,
        start,
        end,
        teamId,
        title: "팀 기획 회의",
      }),
    );
  });

  it("clears draft on another space and does not resurrect it when returning", async () => {
    const view = display();
    await userEvent.type(title(), "이전 공간 제목");
    await chooseTeam();
    view.receive("strip", fixture(second));
    expect(title()).toHaveValue("");
    expect(actor()).toHaveTextContent("개인으로");
    expect(draft()).toEqual({ title: "", actorId: null });
    view.receive("strip", fixture(first));
    expect(title()).toHaveValue("");
    expect(actor()).toHaveTextContent("개인으로");
  });

  it("clears only the shared title after success and retains the actor with an open detail form", async () => {
    const view = display();
    await userEvent.click(screen.getByRole("button", { name: "구간 고르기" }));
    await userEvent.type(title(), "성공 뒤 지울 제목");
    await chooseTeam();
    view.receive("detail");
    await userEvent.click(screen.getByRole("button", { name: "예약하기" }));
    await waitFor(() => expect(route.refresh).toHaveBeenCalledOnce());
    expect(draft()).toEqual({ title: "", actorId: teamId });
    expect(screen.getByTestId("range")).toHaveTextContent("null");
    expect(screen.getByTestId("layout")).toHaveAttribute(
      "data-layout",
      "detail",
    );
    expect(route.replace).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "구간 고르기" }));
    await userEvent.click(
      screen.getByRole("button", { name: "시간·제목 바꾸기" }),
    );
    expect(title()).toHaveValue("");
    expect(actor()).toHaveTextContent("가상 팀으로");
  });

  it("does not let an old pending form success clear another space's newer draft", async () => {
    const action = Promise.withResolvers<ActionResult<{ bookingId: string }>>();
    vi.mocked(createBooking).mockReturnValue(action.promise);
    const view = display();
    await userEvent.click(screen.getByRole("button", { name: "구간 고르기" }));
    await userEvent.type(title(), "A 제출 제목");
    await userEvent.click(screen.getByRole("button", { name: "예약하기" }));
    await waitFor(() => expect(createBooking).toHaveBeenCalledOnce());
    view.receive("strip", fixture(second));
    // 전역 제출 잠금 동안 양식은 비활성이라 컨텍스트의 다음 초안을 직접 준비한다.
    fireEvent.click(screen.getByRole("button", { name: "새 공간 작성" }));
    expect(title()).toBeDisabled();
    expect(title()).toHaveValue("새 공간 제목");
    await act(async () => {
      action.resolve({ ok: true, data: { bookingId: "old" } });
      await action.promise;
    });
    await waitFor(() => expect(route.refresh).toHaveBeenCalledOnce());
    expect(draft()).toEqual({ title: "새 공간 제목", actorId: teamId });
    expect(title()).toHaveValue("새 공간 제목");
    expect(actor()).toHaveTextContent("가상 팀으로");
  });

  it("derives an allowed actor fallback without overwriting the stored selection or leaking it into submission", async () => {
    const data = fixture();
    const view = display(data);
    expect(draft().actorId).toBeNull();
    expect(actor()).toHaveTextContent("개인으로");
    await chooseTeam();
    await userEvent.type(title(), "권한 갱신 뒤 제목");
    view.receive("strip", { ...data, actors: [data.actors[0]!] });
    expect(actor()).toHaveTextContent("개인으로");
    expect(draft().actorId).toBe(teamId);
    await userEvent.click(screen.getByRole("button", { name: "구간 고르기" }));
    await userEvent.click(screen.getByRole("button", { name: "예약하기" }));
    await waitFor(() =>
      expect(createBooking).toHaveBeenCalledExactlyOnceWith({
        spaceId: first,
        start,
        end,
        teamId: null,
        title: "권한 갱신 뒤 제목",
      }),
    );
  });
});
