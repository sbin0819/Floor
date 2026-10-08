import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import type { NavigateAction } from "@/components/optimistic-navigation";
import { createBooking, cancelBooking } from "@/features/bookings/actions";
import {
  BranchWorkspace,
  ResolvedSpaceSelection,
  useFloorSelection,
} from "@/features/bookings/components/branch-workspace";
import {
  FloorDetailRegion,
  EmptySpaceSelection,
} from "@/features/bookings/components/floor-regions";
import { FloorViews } from "@/features/bookings/components/floor-views";
import { SpaceDetailContainer } from "@/features/bookings/components/space-detail-container";
import { SpaceDetail } from "@/features/bookings/components/space-detail";
import { useBookingRange } from "@/features/bookings/components/use-booking-draft";
import { floorSelectionKey } from "@/features/bookings/floor-selection";
import { floorHref } from "@/features/bookings/format";
import type { FloorBookingSelection } from "@/features/bookings/selection";
import type { FloorDayData, SpaceDayData } from "@/features/bookings/types";
import type { ActionResult } from "@/lib/actions/result";
import { floorDayFixture, spaceDayFixture } from "./booking-ui-fixtures";

const route = vi.hoisted(() => ({
  query: "",
  wide: true,
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
const branchId = "abcdefab-1234-4abc-9def-123456789ab0";
const floorId = "abcdefab-1234-4abc-9def-123456789ab1";
const first = "abcdefab-1234-4abc-9def-123456789ab2";
const second = "abcdefab-1234-4abc-9def-123456789ab3";
const date = "2026-10-07";
const start = "2026-10-07T01:00:00.000Z";
const end = "2026-10-07T02:00:00.000Z";
const photo = {
  path: "/seed/photos/meeting-small-oak.webp",
  alt: "테스트 회의실 사진",
};
const href = (spaceId?: string, detail = false) =>
  floorHref(branchId, floorId, date, spaceId, "timeline", detail);

vi.mock("next/navigation", () => ({
  useSelectedLayoutSegments: () => (floorId ? ["floors", floorId] : []),
  usePathname: () =>
    `/branches/${branchId}${floorId ? `/floors/${floorId}` : ""}`,
  useParams: () => ({ branchId, floorId }),
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

function detailFixture(spaceId = first): SpaceDayData {
  const data = spaceDayFixture();
  return {
    ...data,
    branch: { ...data.branch, id: branchId },
    floor: { ...data.floor, id: floorId },
    space: {
      ...data.space,
      id: spaceId,
      name: spaceId === first ? "회의실 A" : "회의실 B",
      photo,
    },
    photos: [photo],
  };
}
function floorFixture(): FloorDayData {
  const data = floorDayFixture();
  const firstDetail = detailFixture();
  return {
    ...data,
    branch: firstDetail.branch,
    floor: firstDetail.floor,
    floors: [firstDetail.floor],
    spaces: [first, second].map((spaceId) => ({
      ...detailFixture(spaceId).space,
      summary: { status: "free" as const, until: end },
      intervals: [
        {
          start: "2026-10-07T02:00:00.000Z",
          end: "2026-10-07T03:00:00.000Z",
          kind: "other" as const,
        },
        {
          start: "2026-10-07T04:00:00.000Z",
          end: "2026-10-07T04:30:00.000Z",
          kind: "maintenance" as const,
        },
      ],
    })),
    groups: [{ type: "meeting_room", totalCount: 2, freeCount: 2 }],
  };
}
const floorData = floorFixture();
function ClockAndSelection() {
  const workspace = useFloorSelection()!;
  const range = useBookingRange(workspace.draftStore, workspace.bookingScope);
  const register = workspace.registerNavigation;
  useEffect(() => register(branchId, date, floorData.now), [register]);
  return <output data-testid="shared-range">{JSON.stringify(range)}</output>;
}
function Frame({
  client,
  detail,
  navigateAction,
}: {
  client: QueryClient;
  detail: SpaceDayData | null;
  navigateAction?: NavigateAction;
}) {
  const query = new URLSearchParams(route.query);
  return (
    <QueryClientProvider client={client}>
      <BranchWorkspace branchId={branchId} navigateAction={navigateAction}>
        <ClockAndSelection />
        <FloorViews data={floorData} initialView="timeline" />
        <ResolvedSpaceSelection
          selectionKey={floorSelectionKey(
            branchId,
            floorId,
            query.get("date") ?? undefined,
            query.get("space") ?? undefined,
          )}
          spaceId={detail?.space.id ?? null}
        >
          <SpaceDetailContainer>
            <FloorDetailRegion>
              {detail ? <SpaceDetail data={detail} /> : <EmptySpaceSelection />}
            </FloorDetailRegion>
          </SpaceDetailContainer>
        </ResolvedSpaceSelection>
      </BranchWorkspace>
    </QueryClientProvider>
  );
}
function setRoute(spaceId?: string, detail = false) {
  const url = href(spaceId, detail);
  route.query = url.split("?")[1]!;
  window.history.replaceState(null, "", url);
}
function display(
  detail: SpaceDayData | null = null,
  navigateAction?: NavigateAction,
) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const view = render(
    <Frame client={client} detail={detail} navigateAction={navigateAction} />,
  );
  return {
    ...view,
    receive: (next: SpaceDayData | null, detail = false) => {
      setRoute(next?.space.id, detail);
      view.rerender(
        <Frame client={client} detail={next} navigateAction={navigateAction} />,
      );
    },
  };
}
const range = () =>
  JSON.parse(
    screen.getByTestId("shared-range").textContent ?? "null",
  ) as FloorBookingSelection | null;
const firstCell = () =>
  screen.getByRole("button", { name: "회의실 A, 10:00, 비어 있음" });
async function finish(pending: ReturnType<typeof Promise.withResolvers<void>>) {
  await act(async () => {
    pending.resolve();
    await pending.promise;
  });
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});
beforeEach(() => {
  vi.clearAllMocks();
  route.wide = true;
  setRoute();
  const media = Object.defineProperties(new EventTarget(), {
    matches: { get: () => route.wide },
  }) as MediaQueryList;
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => media),
  );
  vi.mocked(createBooking).mockResolvedValue({
    ok: true,
    data: { bookingId: "new-booking" },
  });
  vi.mocked(cancelBooking).mockResolvedValue({
    ok: true,
    data: { bookingId: "booking" },
  });
});

describe("shared floor timetable booking strip", () => {
  it("shows the selected space and range immediately with only the form loading, then uses the returned detail", async () => {
    const pending = Promise.withResolvers<void>();
    const navigate = vi.fn<NavigateAction>(() => pending.promise);
    const view = display(null, navigate);
    const cell = firstCell();
    await userEvent.click(cell);
    const strip = await screen.findByRole("region", { name: "예약" });
    expect(
      within(strip).getByRole("heading", { name: "회의실 A" }),
    ).toBeVisible();
    expect(strip).toHaveTextContent("10:00–11:00");
    expect(strip).toHaveTextContent("1시간");
    expect(strip.querySelector('[aria-live="polite"]')).toHaveTextContent(
      "회의실 A",
    );
    expect(strip.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(
      within(strip).queryByRole("combobox", { name: "시작" }),
    ).not.toBeInTheDocument();
    expect(cell).toHaveFocus();
    expect(range()).toEqual({ spaceId: first, start, end });
    expect(navigate).toHaveBeenCalledWith(href(first), {});
    view.receive(detailFixture());
    await finish(pending);
    const form = within(screen.getByRole("region", { name: "예약" }));
    expect(form.getByRole("combobox", { name: "시작" })).toHaveTextContent(
      "10:00",
    );
    expect(form.getByRole("combobox", { name: "끝" })).toHaveTextContent(
      "11:00",
    );
    expect(form.getByRole("textbox", { name: "제목 (선택)" })).toBeVisible();
    expect(form.getByRole("button", { name: "예약하기" })).toBeEnabled();
    expect(cell).toHaveFocus();
  });

  it("keeps one form before the photo trigger in DOM order and puts its first input after the grid's one Tab stop", async () => {
    setRoute(first);
    const view = display(detailFixture());
    const strip = await screen.findByRole("region", { name: "예약" });
    const form = strip.querySelector("form")!;
    const photoTrigger = within(strip).getByRole("button", {
      name: "회의실 A 사진 크게 보기",
    });
    expect(view.container.querySelectorAll("form")).toHaveLength(1);
    expect(
      form.compareDocumentPosition(photoTrigger) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.getByRole("grid").compareDocumentPosition(strip) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(strip).toHaveTextContent("시간을 골라 주세요");
    expect(
      within(strip).getByRole("button", { name: "예약하기" }),
    ).toBeDisabled();
    await userEvent.tab();
    expect(
      screen.getByRole("button", { name: "현재 시간으로 이동" }),
    ).toHaveFocus();
    await userEvent.tab();
    expect(
      within(screen.getByRole("grid")).getByRole("link", { name: /회의실 A/ }),
    ).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}{Enter}");
    expect(firstCell()).toHaveFocus();
    await userEvent.tab();
    expect(within(strip).getByRole("combobox", { name: "시작" })).toHaveFocus();
    expect(photoTrigger).not.toHaveFocus();
  });

  it("opens a photo viewer without discarding the chosen range and returns focus to its trigger", async () => {
    setRoute(first);
    display(detailFixture());
    await userEvent.click(firstCell());
    const trigger = screen.getByRole("button", {
      name: "회의실 A 사진 크게 보기",
    });
    await userEvent.click(trigger);
    expect(
      await screen.findByRole("dialog", { name: "회의실 A" }),
    ).toBeVisible();
    expect(range()).toEqual({ spaceId: first, start, end });
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(range()).toEqual({ spaceId: first, start, end });
  });

  it("keeps the actual title, actor and range through the right detail Sheet and returns focus to the space link", async () => {
    setRoute(first);
    const opening = Promise.withResolvers<void>();
    const closing = Promise.withResolvers<void>();
    const navigate = vi
      .fn<NavigateAction>()
      .mockImplementationOnce(() => opening.promise)
      .mockImplementationOnce(() => closing.promise);
    const data = detailFixture();
    const teamId = "abcdefab-1234-4abc-9def-123456789ab4";
    data.hasTeams = true;
    data.actors.push({ ...data.actors[0]!, teamId, name: "기획 팀으로" });
    const view = display(data, navigate);
    await userEvent.click(firstCell());
    const strip = screen.getByRole("region", { name: "예약" });
    await userEvent.type(
      within(strip).getByRole("textbox", { name: "제목 (선택)" }),
      "공유된 기획 회의",
    );
    await userEvent.click(
      within(strip).getByRole("combobox", { name: "예약 방식" }),
    );
    await userEvent.click(screen.getByRole("option", { name: "기획 팀으로" }));
    const spaceLink = within(screen.getByRole("grid")).getByRole("link", {
      name: /회의실 A/,
    });
    await userEvent.click(spaceLink);
    const sheet = await screen.findByRole("dialog", { name: "회의실 A 상세" });
    expect(sheet).toHaveAttribute("data-side", "right");
    expect(
      screen.queryByRole("region", { name: "예약" }),
    ).not.toBeInTheDocument();
    expect(navigate).toHaveBeenNthCalledWith(1, href(first, true), {
      replace: undefined,
    });
    view.receive(data, true);
    await finish(opening);
    expect(screen.getByRole("dialog", { name: "회의실 A 상세" })).toBe(sheet);
    expect(
      within(sheet).getByRole("heading", { name: "회의실 A" }),
    ).toBeVisible();
    await userEvent.click(
      within(sheet).getByRole("button", { name: "시간·제목 바꾸기" }),
    );
    expect(
      within(sheet).getByRole("textbox", { name: "제목 (선택)" }),
    ).toHaveValue("공유된 기획 회의");
    expect(
      within(sheet).getByRole("combobox", { name: "예약 방식" }),
    ).toHaveTextContent("기획 팀으로");
    expect(
      within(sheet).getByRole("combobox", { name: "시작" }),
    ).toHaveTextContent("10:00");
    expect(
      within(sheet).getByRole("combobox", { name: "끝" }),
    ).toHaveTextContent("11:00");
    expect(document.querySelectorAll("form")).toHaveLength(1);
    const close = within(sheet).getByRole("link", { name: "공간 상세 닫기" });
    expect(close).toHaveAttribute("href", href(first));
    await userEvent.click(close);
    expect(navigate).toHaveBeenNthCalledWith(2, href(first), { replace: true });
    view.receive(data);
    await finish(closing);
    expect(
      screen.queryByRole("dialog", { name: "회의실 A 상세" }),
    ).not.toBeInTheDocument();
    const restored = screen.getByRole("region", { name: "예약" });
    expect(
      within(restored).getByRole("textbox", { name: "제목 (선택)" }),
    ).toHaveValue("공유된 기획 회의");
    expect(
      within(restored).getByRole("combobox", { name: "예약 방식" }),
    ).toHaveTextContent("기획 팀으로");
    expect(range()).toEqual({ spaceId: first, start, end });
    expect(document.querySelectorAll("form")).toHaveLength(1);
    await waitFor(() => expect(spaceLink).toHaveFocus());
  });

  it("closes with replace, preserves date/view, clears the range and returns focus to the chosen cell", async () => {
    setRoute(first);
    const navigate = vi.fn<NavigateAction>();
    display(detailFixture(), navigate);
    const cell = firstCell();
    await userEvent.click(cell);
    await userEvent.click(screen.getByRole("link", { name: "공간 상세 닫기" }));
    expect(navigate).toHaveBeenCalledWith(href(), { replace: true });
    expect(
      screen.queryByRole("region", { name: "예약" }),
    ).not.toBeInTheDocument();
    expect(range()).toBeNull();
    await waitFor(() => expect(cell).toHaveFocus());
  });

  it("submits once and on success clears/closes the strip, preserves date/view and refreshes", async () => {
    setRoute(first);
    const action = Promise.withResolvers<ActionResult<{ bookingId: string }>>();
    vi.mocked(createBooking).mockReturnValue(action.promise);
    display(detailFixture());
    await userEvent.click(firstCell());
    const strip = screen.getByRole("region", { name: "예약" });
    const form = strip.querySelector("form")!;
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    await waitFor(() => expect(createBooking).toHaveBeenCalledTimes(1));
    expect(createBooking).toHaveBeenCalledWith({
      spaceId: first,
      start,
      end,
      teamId: null,
      title: "",
    });
    expect(
      within(strip).getByRole("button", { name: "예약하고 있어요" }),
    ).toBeDisabled();
    await act(async () => {
      action.resolve({ ok: true, data: { bookingId: "new-booking" } });
      await action.promise;
    });
    await waitFor(() => expect(route.refresh).toHaveBeenCalledTimes(1));
    expect(route.replace).toHaveBeenCalledWith(href());
    expect(
      screen.queryByRole("region", { name: "예약" }),
    ).not.toBeInTheDocument();
    expect(range()).toBeNull();
    expect(toast.success).toHaveBeenCalled();
  });

  it.each([
    [
      "BOOKING_CONFLICT",
      "방금 다른 예약이 들어왔어요. 시간을 다시 골라 주세요",
    ],
    ["SPACE_BLOCKED", "점검 중인 시간이에요"],
  ] as const)(
    "keeps the strip open and refreshes on %s",
    async (code, message) => {
      setRoute(first);
      vi.mocked(createBooking).mockResolvedValue({ ok: false, code });
      display(detailFixture());
      await userEvent.click(firstCell());
      await userEvent.click(screen.getByRole("button", { name: "예약하기" }));
      const strip = screen.getByRole("region", { name: "예약" });
      await waitFor(() =>
        expect(within(strip).getByRole("status")).toHaveTextContent(message),
      );
      expect(route.refresh).toHaveBeenCalledTimes(1);
      expect(route.replace).not.toHaveBeenCalled();
      expect(range()).toEqual({ spaceId: first, start, end });
    },
  );

  it("uses a single narrow Sheet with the timetable range already selected after its response", async () => {
    route.wide = false;
    const pending = Promise.withResolvers<void>();
    const view = display(null, () => pending.promise);
    await userEvent.click(firstCell());
    const sheet = await screen.findByRole("dialog", { name: "공간 상세" });
    expect(sheet).toHaveAttribute("data-side", "bottom");
    expect(
      screen.queryByRole("region", { name: "예약" }),
    ).not.toBeInTheDocument();
    expect(range()).toEqual({ spaceId: first, start, end });
    view.receive(detailFixture());
    await finish(pending);
    await userEvent.click(
      within(sheet).getByRole("button", { name: "시간·제목 바꾸기" }),
    );
    expect(
      within(sheet).getByRole("combobox", { name: "시작" }),
    ).toHaveTextContent("10:00");
    expect(
      within(sheet).getByRole("combobox", { name: "끝" }),
    ).toHaveTextContent("11:00");
    expect(
      within(sheet).getByRole("button", { name: "예약하기" }),
    ).toBeEnabled();
    expect(sheet.querySelectorAll("form")).toHaveLength(1);
  });

  it("does not let an old A booking success close or clear the new B selection", async () => {
    setRoute(first);
    const action = Promise.withResolvers<ActionResult<{ bookingId: string }>>();
    const navigation = Promise.withResolvers<void>();
    const navigate = vi.fn<NavigateAction>(() => navigation.promise);
    vi.mocked(createBooking).mockReturnValue(action.promise);
    const view = display(detailFixture(), navigate);
    await userEvent.click(firstCell());
    await userEvent.click(screen.getByRole("button", { name: "예약하기" }));
    await waitFor(() => expect(createBooking).toHaveBeenCalledTimes(1));
    await userEvent.click(
      screen.getByRole("button", { name: "회의실 B, 10:00, 비어 있음" }),
    );
    expect(range()).toEqual({ spaceId: second, start, end });
    expect(
      within(screen.getByRole("region", { name: "예약" })).getByRole(
        "heading",
        { name: "회의실 B" },
      ),
    ).toBeVisible();
    await act(async () => {
      action.resolve({ ok: true, data: { bookingId: "old-A" } });
      await action.promise;
    });
    await waitFor(() => expect(route.refresh).toHaveBeenCalledTimes(1));
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(href(second), {});
    expect(range()).toEqual({ spaceId: second, start, end });
    expect(
      within(screen.getByRole("region", { name: "예약" })).getByRole(
        "heading",
        { name: "회의실 B" },
      ),
    ).toBeVisible();
    view.receive(detailFixture(second));
    await finish(navigation);
    expect(range()).toEqual({ spaceId: second, start, end });
    expect(
      within(screen.getByRole("region", { name: "예약" })).getByRole(
        "combobox",
        { name: "시작" },
      ),
    ).toHaveTextContent("10:00");
  });
});
