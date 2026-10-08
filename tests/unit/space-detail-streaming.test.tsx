import {
  Children,
  cloneElement,
  isValidElement,
  startTransition,
  Suspense,
  use,
  useEffect,
  type ReactElement,
  type ReactNode,
  type SuspenseProps,
} from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { NavigateAction } from "@/components/optimistic-navigation";
import FloorPage from "@/app/(app)/branches/[branchId]/floors/[floorId]/page";
import { getSpaceDay } from "@/features/bookings/queries";
import { ActionError } from "@/lib/actions/result";
import {
  BranchWorkspace,
  useFloorSelection,
} from "@/features/bookings/components/branch-workspace";
import { FloorNavigationLink } from "@/features/bookings/components/floor-navigation-link";
import { SpaceDetailContainer } from "@/features/bookings/components/space-detail-container";
import type { SpaceDayData } from "@/features/bookings/types";
import { floorDayFixture, spaceDayFixture } from "./booking-ui-fixtures";
import { resolvePageContent } from "./page-test-utils";

const route = vi.hoisted(() => ({
  query: "date=2026-10-07&view=timeline",
  wide: true,
  push: vi.fn(),
  replace: vi.fn(),
}));
const date = "2026-10-07";
const id = "abcdefab-1234-4abc-9def-123456789abc";
const path = "/branches/branch/floors/floor";
const selectedHref = `${path}?date=${date}&space=${id}&detail=1&view=timeline`;

vi.mock("next/navigation", () => ({
  useSelectedLayoutSegments: () => ["floors", "floor"],
  usePathname: () => "/branches/branch/floors/floor",
  useParams: () => ({ branchId: "branch", floorId: "floor" }),
  useSearchParams: () => new URLSearchParams(route.query),
  useRouter: () => ({ push: route.push, replace: route.replace }),
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("@/lib/auth/session", () => ({ requirePageSession: vi.fn() }));
vi.mock("@/features/bookings/queries", () => ({
  getFloorDay: vi.fn(),
  getSpaceDay: vi.fn(),
}));
vi.mock("@/features/bookings/components/floor-views", () => ({
  FloorViews: () => null,
}));
vi.mock("@/features/bookings/components/floor-view", () => ({
  FloorScreenLayout: ({ children }: { children: ReactNode }) => children,
  useFloorView: () => ({
    effectiveView: new URLSearchParams(route.query).get("view") ?? "timeline",
  }),
  useFloorPeople: () => ({ people: null }),
}));
vi.mock("@/features/bookings/components/space-detail", () => ({
  SpaceDetail: ({ data }: { data: SpaceDayData }) => (
    <section data-testid="confirmed-detail">
      <h2>{data.space.name}</h2>
    </section>
  ),
}));

const data = {
  ...spaceDayFixture(),
  space: { ...spaceDayFixture().space, id },
};
const floor = {
  ...floorDayFixture(),
  spaces: floorDayFixture().spaces.map((space) =>
    space.kind === "accessible" ? { ...space, id } : space,
  ),
};
function RegisterFloor() {
  const workspace = useFloorSelection();
  const registerNavigation = workspace?.registerNavigation;
  const registerFloor = workspace?.registerFloor;
  useEffect(
    () => registerNavigation?.("branch", date, data.now),
    [registerNavigation],
  );
  useEffect(() => registerFloor?.(floor), [registerFloor]);
  return null;
}

function StreamedResult({ result }: { result: Promise<ReactNode> }) {
  return use(result);
}
function streamBoundary(node: ReactNode) {
  if (!isValidElement<SuspenseProps>(node) || node.type !== Suspense)
    throw new Error("Expected actual page Suspense boundary");
  const child = node.props.children;
  if (
    !isValidElement<Record<string, unknown>>(child) ||
    typeof child.type !== "function"
  )
    throw new Error("Expected server content");
  const renderServer = child.type as (
    props: Record<string, unknown>,
  ) => Promise<ReactNode>;
  const result = renderServer(child.props);
  return cloneElement(node, {}, <StreamedResult result={result} />);
}
async function serverHost() {
  const content = await resolvePageContent(
    FloorPage({
      params: Promise.resolve({ branchId: "branch", floorId: "floor" }),
      searchParams: Promise.resolve(
        Object.fromEntries(new URLSearchParams(route.query)),
      ),
    }),
  );
  const grid = content.props.children;
  if (!isValidElement<{ children: ReactNode }>(grid))
    throw new Error("Expected floor grid");
  const [, host] = Children.toArray(grid.props.children);
  if (
    !isValidElement<{ children: ReactNode; resolution?: ReactNode }>(host) ||
    host.type !== SpaceDetailContainer
  )
    throw new Error("Detail host must live outside its data Suspense");
  const region = host.props.children;
  if (!isValidElement<{ children: ReactNode }>(region))
    throw new Error("Expected detail region");
  return cloneElement(
    host,
    { resolution: streamBoundary(host.props.resolution) },
    cloneElement(region, {}, streamBoundary(region.props.children)),
  );
}
function frame(host: ReactElement, navigate?: NavigateAction) {
  return (
    <BranchWorkspace branchId="branch" navigateAction={navigate}>
      <RegisterFloor />
      <section aria-label="공간 목록">
        <FloorNavigationLink
          href={selectedHref}
          location={{ floorId: "floor", date, spaceId: id, detail: true }}
        >
          회의실 C 열기
        </FloorNavigationLink>
      </section>
      {host}
    </BranchWorkspace>
  );
}
async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}
async function renderFrame(host: ReactElement, navigate?: NavigateAction) {
  let view: ReturnType<typeof render> | undefined;
  await act(async () => {
    view = render(frame(host, navigate));
  });
  if (!view) throw new Error("Expected rendered floor");
  return view;
}
beforeEach(() => {
  vi.clearAllMocks();
  route.query = `date=${date}&view=timeline`;
  route.wide = true;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn(() => ({
      matches: route.wide,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  vi.mocked(getSpaceDay).mockResolvedValue(data);
});

describe("actual floor page detail streaming", () => {
  it.each([true, false])(
    "keeps one dialog from optimistic loading through the keyed server fallback and result (wide=%s)",
    async (wide) => {
      route.wide = wide;
      const transition = Promise.withResolvers<void>();
      const response = Promise.withResolvers<SpaceDayData>();
      const view = await renderFrame(
        await serverHost(),
        () => transition.promise,
      );
      await settle();
      const trigger = screen.getByRole("link", { name: "회의실 C 열기" });
      trigger.focus();
      await act(async () => {
        fireEvent.click(trigger);
      });
      const dialog = await screen.findByRole("dialog");
      expect(dialog).toHaveAttribute("data-side", wide ? "right" : "bottom");
      expect(within(dialog).getByRole("status")).toBeVisible();
      expect(
        screen.queryByRole("region", { name: "예약" }),
      ).not.toBeInTheDocument();
      if (wide) {
        expect(dialog).toHaveAccessibleName(`${data.space.name} 상세`);
        expect(dialog).toHaveClass(
          "data-[side=right]:w-[420px]",
          "data-[side=right]:sm:max-w-none",
        );
        expect(
          dialog.querySelector('[data-slot="skeleton-photo"]'),
        ).toHaveClass("h-[220px]");
      }
      const returnedFocus = vi.fn();
      trigger.addEventListener("focus", returnedFocus);
      const removed: Node[] = [];
      const observer = new MutationObserver((records) => {
        for (const record of records) removed.push(...record.removedNodes);
      });
      observer.observe(document.body, { childList: true, subtree: true });
      vi.mocked(getSpaceDay).mockReturnValue(response.promise);
      route.query = new URL(selectedHref, "http://floor.local").search.slice(1);
      const pendingHost = await serverHost();
      await act(async () => {
        view.rerender(frame(pendingHost, () => transition.promise));
      });
      await act(async () => {
        transition.resolve();
        await transition.promise;
      });
      expect(screen.getByRole("dialog")).toBe(dialog);
      expect(within(dialog).getByRole("status")).toBeVisible();
      expect(
        screen.queryByRole("heading", { name: "공간을 골라 주세요" }),
      ).not.toBeInTheDocument();
      await act(async () => {
        response.resolve(data);
        await response.promise;
      });
      await waitFor(() =>
        expect(screen.getByTestId("confirmed-detail")).toBeVisible(),
      );
      expect(screen.getByRole("dialog")).toBe(dialog);
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
      expect(
        document.querySelectorAll('[data-slot="sheet-overlay"]'),
      ).toHaveLength(1);
      expect(within(dialog).queryByRole("status")).not.toBeInTheDocument();
      expect(
        within(dialog).queryByRole("button", { name: "공간 상세 시트 닫기" }),
      ).not.toBeInTheDocument();
      expect(getSpaceDay).toHaveBeenCalledTimes(1);
      expect(returnedFocus).not.toHaveBeenCalled();
      expect(
        removed.some((node) => node === dialog || node.contains(dialog)),
      ).toBe(false);
      observer.disconnect();
    },
  );

  it("loads a direct link outside the initially closed portal and opens only after validation", async () => {
    route.query = new URL(selectedHref, "http://floor.local").search.slice(1);
    const response = Promise.withResolvers<SpaceDayData>();
    vi.mocked(getSpaceDay).mockReturnValue(response.promise);
    await renderFrame(await serverHost());
    await settle();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(getSpaceDay).toHaveBeenCalledTimes(1);
    await act(async () => {
      response.resolve(data);
      await response.promise;
    });
    expect(await screen.findByRole("dialog")).toHaveAttribute(
      "data-side",
      "right",
    );
    expect(screen.getByTestId("confirmed-detail")).toBeVisible();
  });

  it("keeps the visible content and dialog node while refreshing the same selection", async () => {
    route.query = new URL(selectedHref, "http://floor.local").search.slice(1);
    const view = await renderFrame(await serverHost());
    const dialog = await screen.findByRole("dialog");
    expect(screen.getByTestId("confirmed-detail")).toBeVisible();
    const response = Promise.withResolvers<SpaceDayData>();
    vi.mocked(getSpaceDay).mockReturnValue(response.promise);
    const refreshedHost = await serverHost();
    await act(async () => {
      startTransition(() => {
        view.rerender(frame(refreshedHost));
      });
    });
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(screen.getByTestId("confirmed-detail")).toBeVisible();
    expect(within(dialog).queryByRole("status")).not.toBeInTheDocument();
    await act(async () => {
      response.resolve(data);
      await response.promise;
    });
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(screen.getAllByTestId("confirmed-detail")).toHaveLength(1);
    expect(screen.getByTestId("confirmed-detail")).toBeVisible();
    expect(getSpaceDay).toHaveBeenCalledTimes(2);
  });

  it.each(["button", "escape", "overlay"])(
    "closes the pending right detail via %s without clearing space or reopening on the late response",
    async (method) => {
      const transition = Promise.withResolvers<void>();
      const response = Promise.withResolvers<SpaceDayData>();
      let pendingNavigation = true;
      const navigate = vi.fn((href: string, options: { replace?: boolean }) => {
        if (pendingNavigation) return transition.promise;
        expect(options.replace).toBe(true);
        route.query = new URL(href, "http://floor.local").search.slice(1);
      });
      const view = await renderFrame(await serverHost(), navigate);
      const trigger = screen.getByRole("link", { name: "회의실 C 열기" });
      await act(async () => {
        fireEvent.click(trigger);
      });
      await screen.findByRole("dialog");
      vi.mocked(getSpaceDay).mockReturnValue(response.promise);
      route.query = new URL(selectedHref, "http://floor.local").search.slice(1);
      const pendingHost = await serverHost();
      await act(async () => {
        view.rerender(frame(pendingHost, navigate));
      });
      await act(async () => {
        transition.resolve();
        await transition.promise;
      });
      pendingNavigation = false;
      if (method === "button") {
        await userEvent.click(
          screen.getByRole("button", { name: "공간 상세 시트 닫기" }),
        );
      } else if (method === "escape") {
        await userEvent.keyboard("{Escape}");
      } else {
        const overlay = document.querySelector<HTMLElement>(
          '[data-slot="sheet-overlay"]',
        );
        if (!overlay) throw new Error("Expected overlay");
        await userEvent.click(overlay);
      }
      expect(navigate).toHaveBeenLastCalledWith(
        `${path}?date=${date}&space=${id}&view=timeline`,
        { replace: true },
      );
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByRole("region", { name: "예약" })).toBeVisible();
      await waitFor(() => expect(trigger).toHaveFocus());
      await act(async () => {
        response.resolve(data);
        await response.promise;
      });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByRole("region", { name: "예약" })).toBeVisible();
      expect(screen.getByTestId("confirmed-detail")).toBeVisible();
    },
  );

  it("closes an optimistic dialog when the server rejects the selection", async () => {
    const transition = Promise.withResolvers<void>();
    const response = Promise.withResolvers<SpaceDayData>();
    const view = await renderFrame(
      await serverHost(),
      () => transition.promise,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("link", { name: "회의실 C 열기" }));
    });
    expect(await screen.findByRole("dialog")).toBeVisible();
    vi.mocked(getSpaceDay).mockReturnValue(response.promise);
    route.query = new URL(selectedHref, "http://floor.local").search.slice(1);
    const pendingHost = await serverHost();
    await act(async () => {
      view.rerender(frame(pendingHost, () => transition.promise));
    });
    await act(async () => {
      transition.resolve();
      await transition.promise;
    });
    expect(screen.getByRole("dialog")).toBeVisible();
    await act(async () => {
      response.reject(new ActionError("NOT_FOUND"));
      await response.promise.catch(() => null);
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "예약" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("confirmed-detail")).not.toBeInTheDocument();
  });

  it.each(["NOT_FOUND", "closed"])(
    "does not open a rejected direct link (%s)",
    async (reason) => {
      route.query = new URL(selectedHref, "http://floor.local").search.slice(1);
      if (reason === "NOT_FOUND")
        vi.mocked(getSpaceDay).mockRejectedValue(new ActionError("NOT_FOUND"));
      else
        vi.mocked(getSpaceDay).mockResolvedValue({ ...data, openHours: null });
      await renderFrame(await serverHost());
      await settle();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.queryByTestId("confirmed-detail")).not.toBeInTheDocument();
      expect(getSpaceDay).toHaveBeenCalledTimes(1);
    },
  );
});
