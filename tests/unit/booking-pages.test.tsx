import {
  Children,
  isValidElement,
  Suspense,
  type ReactNode,
  type SuspenseProps,
} from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BranchesPage from "@/app/(app)/branches/page";
import BranchPage from "@/app/(app)/branches/[branchId]/page";
import FloorPage from "@/app/(app)/branches/[branchId]/floors/[floorId]/page";
import { requirePageSession } from "@/lib/auth/session";
import { ActionError } from "@/lib/actions/result";
import { SpaceDetailContainer } from "@/features/bookings/components/space-detail-container";
import {
  getBranchList,
  getBranchFloors,
  getFloorDay,
  getSpaceDay,
  getMyBookings,
} from "@/features/bookings/queries";
import { floorDayFixture, spaceDayFixture } from "./booking-ui-fixtures";
import { resolvePageContent } from "./page-test-utils";

vi.mock("@/lib/auth/session", () => ({ requirePageSession: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "list" }) }),
}));
vi.mock("@/features/bookings/queries", () => ({
  getBranchList: vi.fn(),
  getBranchFloors: vi.fn(),
  getFloorDay: vi.fn(),
  getSpaceDay: vi.fn(),
  getMyBookings: vi.fn(),
}));
vi.mock("@/features/bookings/components/branch-list", () => ({
  BranchList: () => null,
}));
vi.mock("@/features/bookings/components/space-detail", () => ({
  SpaceDetail: () => null,
}));
vi.mock("@/features/bookings/components/my-bookings", () => ({
  MyBookings: () => null,
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("view=list"),
  useParams: () => ({ branchId: "branch", floorId: "floor" }),
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (href: string) => {
    throw new Error(`REDIRECT ${href}`);
  },
}));

const selectedSpaceId = "abcdefab-1234-4abc-9def-123456789abc";
const restrictedSpaceId = "abcdefab-1234-4abc-9def-123456789abd";
const otherFloorSpaceId = "abcdefab-1234-4abc-9def-123456789abe";

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requirePageSession).mockResolvedValue({
    userId: "member",
    email: "member@example.test",
    name: "가상 회원",
  });
  vi.mocked(getBranchList).mockResolvedValue([]);
  const floor = floorDayFixture();
  floor.spaces = floor.spaces.map((space) => ({
    ...space,
    id: space.kind === "accessible" ? selectedSpaceId : restrictedSpaceId,
  }));
  vi.mocked(getBranchFloors).mockResolvedValue({
    branch: floor.branch,
    floors: floor.floors,
  });
  vi.mocked(getFloorDay).mockResolvedValue(floor);
  const detail = spaceDayFixture();
  detail.space.id = selectedSpaceId;
  vi.mocked(getSpaceDay).mockResolvedValue(detail);
  vi.mocked(getMyBookings).mockResolvedValue({
    upcoming: [],
    past: [],
    now: "2026-10-07T01:10:00.000Z",
  });
});
const floorPage = (query: Record<string, string | string[] | undefined> = {}) =>
  FloorPage({
    params: Promise.resolve({ branchId: "branch", floorId: "floor" }),
    searchParams: Promise.resolve(query),
  });

async function floorRegions(
  query: Record<string, string | string[] | undefined> = {},
) {
  const page = await resolvePageContent(floorPage(query));
  const grid = page.props.children;
  if (!isValidElement<{ children: ReactNode }>(grid))
    throw new Error("Missing floor grid");
  const [listRegion, detailRegion] = Children.toArray(grid.props.children);
  if (
    !isValidElement<{ children: ReactNode }>(listRegion) ||
    !isValidElement<{ children: ReactNode; resolution: ReactNode }>(
      detailRegion,
    )
  )
    throw new Error("Expected optimistic list and detail regions");
  const list = listRegion.props.children;
  expect(detailRegion.type).toBe(SpaceDetailContainer);
  const detailWrapper = detailRegion.props.children;
  if (!isValidElement<{ children: ReactNode }>(detailWrapper))
    throw new Error("Expected stable detail region");
  const detail = detailWrapper.props.children;
  const resolution = detailRegion.props.resolution;
  if (
    !isValidElement<SuspenseProps>(list) ||
    list.type !== Suspense ||
    !isValidElement<SuspenseProps>(detail) ||
    detail.type !== Suspense ||
    !isValidElement<SuspenseProps>(resolution) ||
    resolution.type !== Suspense
  )
    throw new Error("Expected sibling list and detail boundaries");
  return { list, detail, resolution, container: detailRegion };
}

describe("booking page-local streaming", () => {
  it.each(["branches", "branch", "floor"] as const)(
    "%s returns a fallback without reading the session or params",
    (route) => {
      const read = vi.fn();
      const params = new Proxy(
        Promise.resolve({ branchId: "branch", floorId: "floor" }),
        {
          get(target, key) {
            read();
            return Reflect.get(target, key);
          },
        },
      );
      const pages = {
        branches: () => BranchesPage(),
        branch: () => BranchPage({ params }),
        floor: () => FloorPage({ params, searchParams: Promise.resolve({}) }),
      };
      const shell = pages[route]();
      expect(isValidElement(shell)).toBe(true);
      if (!isValidElement<SuspenseProps>(shell))
        throw new Error("Missing streaming shell");
      expect(shell.type).toBe(Suspense);
      render(shell.props.fallback);
      expect(screen.getByRole("status")).toHaveTextContent("불러오고 있어요.");
      expect(read).not.toHaveBeenCalled();
      expect(requirePageSession).not.toHaveBeenCalled();
      expect(getFloorDay).not.toHaveBeenCalled();
    },
  );
});

describe("booking page guards", () => {
  it("checks the branch-list session before querying", async () => {
    await resolvePageContent(BranchesPage());
    expect(requirePageSession).toHaveBeenCalledWith("/branches");
    expect(
      vi.mocked(requirePageSession).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(getBranchList).mock.invocationCallOrder[0]!);
  });
  it("checks the branch session before redirecting to the first accessible floor", async () => {
    await expect(
      resolvePageContent(
        BranchPage({ params: Promise.resolve({ branchId: "branch" }) }),
      ),
    ).rejects.toThrow("REDIRECT /branches/branch/floors/floor");
    expect(requirePageSession).toHaveBeenCalledWith("/branches/branch");
  });
  it("shows an empty-floor message instead of redirecting to a hidden floor", async () => {
    vi.mocked(getBranchFloors).mockResolvedValue({
      branch: floorDayFixture().branch,
      floors: [],
    });
    render(
      await resolvePageContent(
        BranchPage({ params: Promise.resolve({ branchId: "branch" }) }),
      ),
    );
    expect(
      screen.getByText("이 지점에는 이용할 수 있는 층이 아직 없어요"),
    ).toBeVisible();
  });
  it("checks the page session before starting the independent list and detail", async () => {
    const regions = await floorRegions({
      date: "2026-10-07",
      space: selectedSpaceId,
    });
    expect(requirePageSession).toHaveBeenCalledWith(
      "/branches/branch/floors/floor",
    );
    expect(getFloorDay).not.toHaveBeenCalled();
    expect(getSpaceDay).not.toHaveBeenCalled();
    const [, result] = await Promise.all([
      resolvePageContent(regions.list),
      resolvePageContent(regions.resolution),
      resolvePageContent(regions.detail),
    ]);
    expect(getFloorDay).toHaveBeenCalledWith("branch", "floor", "2026-10-07");
    expect(getSpaceDay).toHaveBeenCalledWith(
      "branch",
      "floor",
      selectedSpaceId,
      "2026-10-07",
    );
    expect(result.props.spaceId).toBe(selectedSpaceId);
    expect(result.props.children).toBeNull();
    expect(getSpaceDay).toHaveBeenCalledTimes(1);
    expect(regions.container.key).toBe(".1");
  });
  it("starts and completes detail while the independent floor list is still pending", async () => {
    const pending =
      Promise.withResolvers<Awaited<ReturnType<typeof getFloorDay>>>();
    vi.mocked(getFloorDay).mockReturnValue(pending.promise);
    const regions = await floorRegions({ space: selectedSpaceId });
    const list = resolvePageContent(regions.list);
    const detail = await resolvePageContent(regions.resolution);
    await resolvePageContent(regions.detail);
    expect(getFloorDay).toHaveBeenCalledTimes(1);
    expect(getSpaceDay).toHaveBeenCalledTimes(1);
    expect(detail.props.spaceId).toBe(selectedSpaceId);
    pending.resolve(floorDayFixture());
    await list;
  });
  it("does not register or open a space on a closed date", async () => {
    vi.mocked(getSpaceDay).mockResolvedValue({
      ...spaceDayFixture(),
      openHours: null,
    });
    const regions = await floorRegions({
      date: "2026-10-11",
      space: selectedSpaceId,
    });
    const result = await resolvePageContent(regions.resolution);
    expect(result.props.spaceId).toBeNull();
    expect(
      (await resolvePageContent(regions.detail)).props.children,
    ).toBeNull();
  });
  it("canonicalizes an uppercase selected-space UUID before the independently authorized detail query", async () => {
    const spaceId = "abcdefab-1234-4abc-9def-123456789abc";
    const data = floorDayFixture();
    data.spaces = data.spaces.map((space) =>
      space.kind === "accessible" ? { ...space, id: spaceId } : space,
    );
    const detail = spaceDayFixture();
    detail.space.id = spaceId;
    vi.mocked(getFloorDay).mockResolvedValue(data);
    vi.mocked(getSpaceDay).mockResolvedValue(detail);
    const { resolution: boundary } = await floorRegions({
      space: spaceId.toUpperCase(),
    });
    const result = await resolvePageContent(boundary);
    expect(getSpaceDay).toHaveBeenCalledExactlyOnceWith(
      "branch",
      "floor",
      spaceId,
      undefined,
    );
    expect(getFloorDay).not.toHaveBeenCalled();
    expect(result.props.spaceId).toBe(spaceId);
  });
  it.each([undefined, "invalid", [selectedSpaceId, otherFloorSpaceId]])(
    "does not query a missing or malformed selection %j",
    async (space) => {
      const { detail, resolution } = await floorRegions({ space });
      const result = await resolvePageContent(resolution);
      expect(getSpaceDay).not.toHaveBeenCalled();
      expect(result.props.spaceId).toBeNull();
      render(await resolvePageContent(detail));
      expect(
        screen.getByRole("heading", { name: "공간을 골라 주세요" }),
      ).toBeVisible();
    },
  );
  it.each([selectedSpaceId, restrictedSpaceId, otherFloorSpaceId])(
    "drops inaccessible or wrong-floor selection %s without turning the page into a 404",
    async (space) => {
      vi.mocked(getSpaceDay).mockRejectedValue(new ActionError("NOT_FOUND"));
      const { detail, resolution } = await floorRegions({ space });
      const result = await resolvePageContent(resolution);
      expect(getSpaceDay).toHaveBeenCalledExactlyOnceWith(
        "branch",
        "floor",
        space,
        undefined,
      );
      expect(result.props.spaceId).toBeNull();
      render(await resolvePageContent(detail));
      expect(
        screen.getByRole("heading", { name: "공간을 골라 주세요" }),
      ).toBeVisible();
    },
  );
  it("turns a missing or inaccessible floor into the same notFound response", async () => {
    vi.mocked(getFloorDay).mockRejectedValue(new ActionError("NOT_FOUND"));
    const { list } = await floorRegions();
    await expect(resolvePageContent(list)).rejects.toThrow("NOT_FOUND");
    expect(getSpaceDay).not.toHaveBeenCalled();
  });
  it("does not hide unexpected list or detail failures", async () => {
    const failure = new Error("database failure");
    vi.mocked(getFloorDay).mockRejectedValue(failure);
    vi.mocked(getSpaceDay).mockRejectedValue(failure);
    const { list, detail, resolution } = await floorRegions({
      space: selectedSpaceId,
    });
    await expect(resolvePageContent(list)).rejects.toBe(failure);
    await expect(resolvePageContent(detail)).rejects.toBe(failure);
    await expect(resolvePageContent(resolution)).rejects.toBe(failure);
    expect(getSpaceDay).toHaveBeenCalledTimes(1);
  });
  it("keeps the list key stable for space-only changes and resets both boundaries for date changes", async () => {
    const first = await floorRegions({
      date: "2026-10-07",
      space: selectedSpaceId,
    });
    const space = await floorRegions({
      date: "2026-10-07",
      space: otherFloorSpaceId,
    });
    const date = await floorRegions({
      date: "2026-10-08",
      space: selectedSpaceId,
    });
    expect(first.list.key).toBe(space.list.key);
    expect(first.detail.key).not.toBe(space.detail.key);
    expect(first.list.key).not.toBe(date.list.key);
    expect(first.detail.key).not.toBe(date.detail.key);
    const view = await floorRegions({
      date: "2026-10-07",
      space: selectedSpaceId,
      view: "timeline",
    });
    expect(view.list.key).toBe(first.list.key);
    expect(view.detail.key).toBe(first.detail.key);
    const expanded = await floorRegions({
      date: "2026-10-07",
      space: selectedSpaceId,
      view: "timeline",
      detail: "1",
    });
    expect(expanded.list.key).toBe(first.list.key);
    expect(expanded.detail.key).toBe(first.detail.key);
    expect(expanded.resolution.key).toBe(first.resolution.key);
    expect(expanded.container.key).toBe(first.container.key);
    expect(space.container.key).toBe(first.container.key);
    expect(date.container.key).toBe(first.container.key);
  });
  it.each(["branches", "branch", "floor"] as const)(
    "does not query %s after its session guard rejects",
    async (route) => {
      vi.mocked(requirePageSession).mockRejectedValue(
        new Error("LOGIN_REDIRECT"),
      );
      const pages = {
        branches: () => BranchesPage(),
        branch: () =>
          BranchPage({ params: Promise.resolve({ branchId: "branch" }) }),
        floor: () => floorPage(),
      };
      await expect(resolvePageContent(pages[route]())).rejects.toThrow(
        "LOGIN_REDIRECT",
      );
      for (const query of [
        getBranchList,
        getBranchFloors,
        getFloorDay,
        getSpaceDay,
        getMyBookings,
      ])
        expect(query).not.toHaveBeenCalled();
    },
  );
});
