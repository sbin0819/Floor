import { Activity, useEffect } from "react";
import { renderToString } from "react-dom/server";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NavigateAction } from "@/components/optimistic-navigation";
import {
  BranchWorkspace,
  ResolvedSpaceSelection,
  useFloorSelection,
} from "@/features/bookings/components/branch-workspace";
import {
  FloorDetailRegion,
  EmptySpaceSelection,
} from "@/features/bookings/components/floor-regions";
import { FloorNavigationLink } from "@/features/bookings/components/floor-navigation-link";
import { SpaceDetailContainer } from "@/features/bookings/components/space-detail-container";
import {
  type MatchMedia,
  WIDE_SCREEN_QUERY,
} from "@/features/bookings/components/use-wide-screen";
import { floorSelectionKey } from "@/features/bookings/floor-selection";

const navigation = vi.hoisted(() => ({
  branchId: "branch",
  floorId: "floor",
  query: "date=2026-10-07",
  router: { push: vi.fn(), replace: vi.fn() },
}));
vi.mock("@/features/bookings/components/floor-view", () => ({
  useFloorView: () => ({ effectiveView: "list" }),
}));
vi.mock("next/navigation", () => ({
  useParams: () => ({
    branchId: navigation.branchId,
    floorId: navigation.floorId,
  }),
  useSearchParams: () => new URLSearchParams(navigation.query),
  useRouter: () => navigation.router,
}));
const today = "2026-10-07";
const spaceId = "abcdefab-1234-4abc-9def-123456789abc";
const otherSpaceId = "abcdefab-1234-4abc-9def-123456789abd";
const href = (id?: string) =>
  `/branches/branch/floors/floor?date=${today}${id ? `&space=${id}` : ""}`;

function viewport(initialWide: boolean) {
  let wide = initialWide;
  const media = Object.defineProperties(new EventTarget(), {
    matches: { get: () => wide },
  }) as MediaQueryList;
  const matchMedia = vi.fn<MatchMedia>(() => media);
  return {
    matchMedia,
    media,
    setWide: (value: boolean) => {
      wide = value;
      media.dispatchEvent(new Event("change"));
    },
  };
}
function Clock() {
  const register = useFloorSelection()?.registerNavigation;
  useEffect(
    () => register?.("branch", today, "2026-10-07T01:00:00.000Z"),
    [register],
  );
  return null;
}
function Content({ id = spaceId }: { id?: string }) {
  return (
    <section aria-label="확정된 공간 상세" data-testid="single-detail">
      <h2>{id === spaceId ? "회의실 C" : "회의실 D"} 예약</h2>
      <label>
        예약 제목
        <input />
      </label>
      <FloorNavigationLink
        href={href()}
        location={{ floorId: "floor", date: today, spaceId: null }}
        replace
      >
        공간 상세 닫기
      </FloorNavigationLink>
    </section>
  );
}
function frame({
  matchMedia,
  actualSpaceId = null,
  navigateAction,
  oldActivity = false,
  listKey = "list",
}: {
  matchMedia: MatchMedia;
  actualSpaceId?: string | null;
  navigateAction?: NavigateAction;
  oldActivity?: boolean;
  listKey?: string;
}) {
  const search = new URLSearchParams(navigation.query);
  const key = floorSelectionKey(
    "branch",
    navigation.floorId,
    search.get("date") ?? undefined,
    search.get("space") ?? undefined,
  );
  return (
    <BranchWorkspace navigateAction={navigateAction}>
      <Clock />
      <a href={href(spaceId)}>오늘 날짜 링크</a>
      <section aria-label="공간 목록" key={listKey}>
        <FloorNavigationLink
          href={href(spaceId)}
          location={{ floorId: "floor", date: today, spaceId }}
        >
          회의실 C 열기
        </FloorNavigationLink>
        <FloorNavigationLink
          href={href(otherSpaceId)}
          location={{ floorId: "floor", date: today, spaceId: otherSpaceId }}
        >
          회의실 D 열기
        </FloorNavigationLink>
      </section>
      {oldActivity && (
        <Activity mode="hidden">
          <ResolvedSpaceSelection
            selectionKey={floorSelectionKey(
              "branch",
              "floor",
              today,
              otherSpaceId,
            )}
            spaceId={otherSpaceId}
          >
            <p>이전 상세</p>
          </ResolvedSpaceSelection>
        </Activity>
      )}
      <ResolvedSpaceSelection selectionKey={key} spaceId={actualSpaceId}>
        <SpaceDetailContainer matchMedia={matchMedia}>
          <FloorDetailRegion>
            {actualSpaceId ? (
              <Content id={actualSpaceId} />
            ) : (
              <EmptySpaceSelection />
            )}
          </FloorDetailRegion>
        </SpaceDetailContainer>
      </ResolvedSpaceSelection>
    </BranchWorkspace>
  );
}
function deferred() {
  return Promise.withResolvers<void>();
}
async function finish(pending: ReturnType<typeof deferred>) {
  await act(async () => {
    pending.resolve();
    await pending.promise;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  navigation.query = `date=${today}`;
  navigation.floorId = "floor";
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("single responsive space detail", () => {
  it("renders one desktop panel on the server even if the injected browser is narrow", () => {
    const media = viewport(false);
    const html = renderToString(
      <SpaceDetailContainer matchMedia={media.matchMedia}>
        <Content />
      </SpaceDetailContainer>,
    );
    expect(html).toContain('data-space-detail-layout="panel"');
    expect(html).toContain("hidden");
    expect(html).toContain("lg:block");
    expect(html).toContain("420px");
    expect(html.match(/data-testid="single-detail"/g)).toHaveLength(1);
    expect(html).not.toContain('role="dialog"');
  });

  it("uses a sticky 420px panel with one content subtree on wide screens", () => {
    navigation.query += `&space=${spaceId}`;
    const media = viewport(true);
    const view = render(
      frame({ matchMedia: media.matchMedia, actualSpaceId: spaceId }),
    );
    expect(media.matchMedia).toHaveBeenCalledWith(WIDE_SCREEN_QUERY);
    expect(
      view.container.querySelector('[data-space-detail-layout="panel"]'),
    ).toHaveClass("lg:sticky", "lg:w-[420px]");
    expect(
      view.container.querySelector('[data-space-detail-layout="panel"]'),
    ).toHaveClass("lg:h-[calc(100dvh-15rem)]", "lg:min-h-[32rem]");
    expect(screen.getAllByTestId("single-detail")).toHaveLength(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens a confirmed direct link on mobile without losing registration when the closed sheet initially has no children", async () => {
    navigation.query += `&space=${spaceId}`;
    render(
      frame({ matchMedia: viewport(false).matchMedia, actualSpaceId: spaceId }),
    );
    const sheet = await screen.findByRole("dialog", { name: "공간 상세" });
    expect(sheet).toHaveAttribute("data-side", "bottom");
    expect(sheet).toHaveClass("max-h-[85dvh]", "data-[side=bottom]:h-[85dvh]");
    expect(screen.getAllByTestId("single-detail")).toHaveLength(1);
    expect(
      document.querySelector('[data-space-detail-layout="panel"]'),
    ).toBeNull();
    await waitFor(() => {
      expect(sheet).toContainElement(document.activeElement as HTMLElement);
    });
  });

  it.each([undefined, "invalid", otherSpaceId])(
    "does not open an unconfirmed or invalid URL selection %s",
    (requested) => {
      if (requested) navigation.query += `&space=${requested}`;
      render(frame({ matchMedia: viewport(false).matchMedia }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.queryByTestId("single-detail")).not.toBeInTheDocument();
    },
  );

  it("opens an accessible named skeleton immediately, then replaces it with the single confirmed content", async () => {
    const media = viewport(false);
    const pending = deferred();
    const navigate = vi.fn<NavigateAction>(() => pending.promise);
    const view = render(
      frame({ matchMedia: media.matchMedia, navigateAction: navigate }),
    );
    fireEvent.click(screen.getByRole("link", { name: "회의실 C 열기" }));
    const sheet = await screen.findByRole("dialog", { name: "공간 상세" });
    expect(within(sheet).getByRole("status")).toHaveTextContent(
      "불러오고 있어요",
    );
    expect(
      within(sheet).getByRole("button", { name: "공간 상세 시트 닫기" }),
    ).toHaveClass("size-11");
    expect(screen.queryByTestId("single-detail")).not.toBeInTheDocument();
    navigation.query += `&space=${spaceId}`;
    view.rerender(
      frame({
        matchMedia: media.matchMedia,
        actualSpaceId: spaceId,
        navigateAction: navigate,
      }),
    );
    await finish(pending);
    expect(screen.getAllByTestId("single-detail")).toHaveLength(1);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("dialog")).getAllByRole("link", {
        name: "공간 상세 닫기",
      }),
    ).toHaveLength(1);
  });

  it("dismisses a rejected optimistic space when the response confirms no selection", async () => {
    const pending = deferred();
    const media = viewport(false);
    const navigate = () => pending.promise;
    const view = render(
      frame({ matchMedia: media.matchMedia, navigateAction: navigate }),
    );
    fireEvent.click(screen.getByRole("link", { name: "회의실 C 열기" }));
    expect(
      await screen.findByRole("dialog", { name: "공간 상세" }),
    ).toBeInTheDocument();
    navigation.query += `&space=${spaceId}`;
    view.rerender(
      frame({
        matchMedia: media.matchMedia,
        actualSpaceId: null,
        navigateAction: navigate,
      }),
    );
    await finish(pending);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes immediately with replace and restores the clicked space link even before the response", async () => {
    const media = viewport(false);
    const opening = deferred();
    const closing = deferred();
    const navigate = vi
      .fn<NavigateAction>()
      .mockImplementationOnce(() => opening.promise)
      .mockImplementationOnce(() => closing.promise);
    const view = render(
      frame({ matchMedia: media.matchMedia, navigateAction: navigate }),
    );
    const trigger = screen.getByRole("link", { name: "회의실 C 열기" });
    trigger.focus();
    fireEvent.click(trigger);
    navigation.query += `&space=${spaceId}`;
    view.rerender(
      frame({
        matchMedia: media.matchMedia,
        actualSpaceId: spaceId,
        navigateAction: navigate,
      }),
    );
    await finish(opening);
    fireEvent.click(screen.getByRole("link", { name: "공간 상세 닫기" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(navigate).toHaveBeenLastCalledWith(href(), { replace: true });
    await waitFor(() => {
      expect(trigger).toHaveFocus();
    });
    navigation.query = `date=${today}`;
    view.rerender(
      frame({ matchMedia: media.matchMedia, navigateAction: navigate }),
    );
    await finish(closing);
  });

  it("closes a pending skeleton with its own button and does not reopen when the stale response arrives", async () => {
    const media = viewport(false);
    const opening = deferred();
    const closing = deferred();
    const navigate = vi
      .fn<NavigateAction>()
      .mockImplementationOnce(() => opening.promise)
      .mockImplementationOnce(() => closing.promise);
    const view = render(
      frame({ matchMedia: media.matchMedia, navigateAction: navigate }),
    );
    fireEvent.click(screen.getByRole("link", { name: "회의실 C 열기" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "공간 상세 시트 닫기" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(navigate).toHaveBeenLastCalledWith(href(), { replace: true });
    await finish(opening);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    navigation.query = `date=${today}`;
    view.rerender(
      frame({ matchMedia: media.matchMedia, navigateAction: navigate }),
    );
    await finish(closing);
  });

  it("uses router.replace for Escape and permits reopening the same room", async () => {
    navigation.query += `&space=${spaceId}`;
    render(
      frame({ matchMedia: viewport(false).matchMedia, actualSpaceId: spaceId }),
    );
    const sheet = await screen.findByRole("dialog");
    fireEvent.keyDown(sheet, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(navigation.router.replace).toHaveBeenCalledWith(href());
    fireEvent.click(screen.getByRole("link", { name: "회의실 C 열기" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(navigation.router.push).toHaveBeenCalledWith(href(spaceId));
  });

  it("returns a direct-entry close to the room row instead of the earlier date link that also contains space", async () => {
    navigation.query += `&space=${spaceId}`;
    render(
      frame({ matchMedia: viewport(false).matchMedia, actualSpaceId: spaceId }),
    );
    fireEvent.keyDown(await screen.findByRole("dialog"), { key: "Escape" });
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "회의실 C 열기" })).toHaveFocus();
    });
    expect(
      screen.getByRole("link", { name: "오늘 날짜 링크" }),
    ).not.toHaveFocus();
  });

  it("finds the replacement room row when the remembered clicked node was removed", async () => {
    const media = viewport(false);
    const opening = deferred();
    const navigate = vi
      .fn<NavigateAction>()
      .mockImplementationOnce(() => opening.promise);
    const view = render(
      frame({ matchMedia: media.matchMedia, navigateAction: navigate }),
    );
    const original = screen.getByRole("link", { name: "회의실 C 열기" });
    fireEvent.click(original);
    navigation.query += `&space=${spaceId}`;
    view.rerender(
      frame({
        matchMedia: media.matchMedia,
        actualSpaceId: spaceId,
        navigateAction: navigate,
        listKey: "replacement",
      }),
    );
    await finish(opening);
    expect(original.isConnected).toBe(false);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "회의실 C 열기" })).toHaveFocus();
    });
    expect(
      screen.getByRole("link", { name: "오늘 날짜 링크" }),
    ).not.toHaveFocus();
  });

  it("closes on back navigation without an extra URL replacement and reopens on forward", async () => {
    navigation.query += `&space=${spaceId}`;
    const media = viewport(false);
    const view = render(
      frame({ matchMedia: media.matchMedia, actualSpaceId: spaceId }),
    );
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    navigation.query = `date=${today}`;
    view.rerender(frame({ matchMedia: media.matchMedia }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(navigation.router.replace).not.toHaveBeenCalled();
    navigation.query += `&space=${spaceId}`;
    view.rerender(
      frame({ matchMedia: media.matchMedia, actualSpaceId: spaceId }),
    );
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("switches wide to mobile and back with one subtree, valid selection, focus and no navigation", async () => {
    navigation.query += `&space=${spaceId}`;
    const media = viewport(true);
    render(frame({ matchMedia: media.matchMedia, actualSpaceId: spaceId }));
    screen.getByRole("textbox", { name: "예약 제목" }).focus();
    await act(async () => {
      media.setWide(false);
    });
    const sheet = await screen.findByRole("dialog");
    expect(screen.getAllByTestId("single-detail")).toHaveLength(1);
    await waitFor(() => {
      expect(sheet).toContainElement(document.activeElement as HTMLElement);
    });
    await act(async () => {
      media.setWide(true);
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("single-detail")).toHaveLength(1);
    expect(
      document.querySelector('[data-space-detail-layout="panel"]'),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "회의실 C 열기" })).toHaveFocus();
    });
    expect(navigation.router.replace).not.toHaveBeenCalled();
    expect(navigation.router.push).not.toHaveBeenCalled();
    await act(async () => {
      media.setWide(false);
    });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getAllByTestId("single-detail")).toHaveLength(1);
  });

  it("does not let a hidden Activity registration erase the current mobile selection", async () => {
    navigation.query += `&space=${spaceId}`;
    const media = viewport(false);
    const view = render(
      frame({
        matchMedia: media.matchMedia,
        actualSpaceId: spaceId,
        oldActivity: true,
      }),
    );
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    view.rerender(
      frame({
        matchMedia: media.matchMedia,
        actualSpaceId: spaceId,
        oldActivity: false,
      }),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getAllByTestId("single-detail")).toHaveLength(1);
  });

  it("removes its media subscription on unmount", () => {
    const media = viewport(true);
    const add = vi.spyOn(media.media, "addEventListener");
    const remove = vi.spyOn(media.media, "removeEventListener");
    const view = render(
      <SpaceDetailContainer matchMedia={media.matchMedia}>
        <Content />
      </SpaceDetailContainer>,
    );
    expect(add).toHaveBeenCalledWith("change", expect.any(Function));
    view.unmount();
    expect(remove).toHaveBeenCalledWith("change", add.mock.calls[0]?.[1]);
  });

  it("keeps a newer registration when an older registration for the same route cleans up", async () => {
    navigation.query += `&space=${spaceId}`;
    const media = viewport(false);
    const key = floorSelectionKey("branch", "floor", today, spaceId);
    function overlapping(oldVisible: boolean) {
      return (
        <BranchWorkspace>
          <Clock />
          <Activity mode={oldVisible ? "visible" : "hidden"}>
            <ResolvedSpaceSelection selectionKey={key} spaceId={spaceId}>
              <p>이전 등록</p>
            </ResolvedSpaceSelection>
          </Activity>
          <ResolvedSpaceSelection selectionKey={key} spaceId={spaceId}>
            <SpaceDetailContainer matchMedia={media.matchMedia}>
              <Content />
            </SpaceDetailContainer>
          </ResolvedSpaceSelection>
        </BranchWorkspace>
      );
    }
    const view = render(overlapping(true));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    view.rerender(overlapping(false));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getAllByTestId("single-detail")).toHaveLength(1);
  });

  it("does not leave an old mobile portal visible when Activity preserves a prior route", async () => {
    navigation.query += `&space=${spaceId}`;
    const media = viewport(false);
    function preserved(active: string) {
      return (
        <BranchWorkspace>
          <Clock />
          <section aria-label="공간 목록">
            <FloorNavigationLink
              href={href(spaceId)}
              location={{ floorId: "floor", date: today, spaceId }}
            >
              회의실 C 열기
            </FloorNavigationLink>
            <FloorNavigationLink
              href={href(otherSpaceId)}
              location={{
                floorId: "floor",
                date: today,
                spaceId: otherSpaceId,
              }}
            >
              회의실 D 열기
            </FloorNavigationLink>
          </section>
          {[spaceId, otherSpaceId].map((id) => (
            <Activity key={id} mode={id === active ? "visible" : "hidden"}>
              <ResolvedSpaceSelection
                selectionKey={floorSelectionKey("branch", "floor", today, id)}
                spaceId={id}
              >
                <SpaceDetailContainer matchMedia={media.matchMedia}>
                  <Content id={id} />
                </SpaceDetailContainer>
              </ResolvedSpaceSelection>
            </Activity>
          ))}
        </BranchWorkspace>
      );
    }
    const view = render(preserved(spaceId));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    navigation.query = `date=${today}&space=${otherSpaceId}`;
    view.rerender(preserved(otherSpaceId));
    await waitFor(() => {
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
    });
    expect(
      screen.getByRole("heading", { name: "회의실 D 예약" }),
    ).toBeVisible();
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toContainElement(
        document.activeElement as HTMLElement,
      );
    });
    expect(
      screen.queryByRole("heading", { name: "회의실 C 예약" }),
    ).not.toBeInTheDocument();
    navigation.query = `date=${today}&space=${spaceId}`;
    view.rerender(preserved(spaceId));
    await waitFor(() => {
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
    });
    expect(
      screen.getByRole("heading", { name: "회의실 C 예약" }),
    ).toBeVisible();
  });
});
