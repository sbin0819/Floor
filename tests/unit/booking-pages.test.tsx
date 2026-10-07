import { isValidElement, Suspense, type SuspenseProps } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BranchesPage from "@/app/(app)/branches/page";
import BranchPage from "@/app/(app)/branches/[branchId]/page";
import FloorPage from "@/app/(app)/branches/[branchId]/floors/[floorId]/page";
import { requirePageSession } from "@/lib/auth/session";
import { ActionError } from "@/lib/actions/result";
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
  vi.mocked(getMyBookings).mockResolvedValue({ upcoming: [], past: [] });
});
const floorPage = (query: Record<string, string | string[] | undefined> = {}) =>
  FloorPage({
    params: Promise.resolve({ branchId: "branch", floorId: "floor" }),
    searchParams: Promise.resolve(query),
  });

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
  it("checks the actual floor query before loading a selected accessible space", async () => {
    const result = await resolvePageContent(
      floorPage({ date: "2026-10-07", space: selectedSpaceId }),
    );
    expect(requirePageSession).toHaveBeenCalledWith(
      "/branches/branch/floors/floor",
    );
    expect(getFloorDay).toHaveBeenCalledWith("branch", "floor", "2026-10-07");
    expect(getSpaceDay).toHaveBeenCalledWith(selectedSpaceId, "2026-10-07");
    expect(result.props.selectedSpaceId).toBe(selectedSpaceId);
  });
  it("canonicalizes an uppercase selected-space UUID before checking the authorized floor list", async () => {
    const spaceId = "abcdefab-1234-4abc-9def-123456789abc";
    const data = floorDayFixture();
    data.spaces = data.spaces.map((space) =>
      space.kind === "accessible" ? { ...space, id: spaceId } : space,
    );
    const detail = spaceDayFixture();
    detail.space.id = spaceId;
    vi.mocked(getFloorDay).mockResolvedValue(data);
    vi.mocked(getSpaceDay).mockResolvedValue(detail);
    const result = await resolvePageContent(
      floorPage({ space: spaceId.toUpperCase() }),
    );
    expect(getSpaceDay).toHaveBeenCalledExactlyOnceWith(spaceId, data.date);
    expect(result.props.selectedSpaceId).toBe(spaceId);
  });
  it.each([
    otherFloorSpaceId,
    restrictedSpaceId,
    "invalid",
    [selectedSpaceId, otherFloorSpaceId],
  ])("does not query an unselected or inaccessible space %j", async (space) => {
    const result = await resolvePageContent(floorPage({ space }));
    expect(getSpaceDay).not.toHaveBeenCalled();
    expect(result.props.selectedSpaceId).toBeUndefined();
  });
  it("drops a selection that becomes inaccessible between the two queries", async () => {
    vi.mocked(getSpaceDay).mockRejectedValue(new ActionError("NOT_FOUND"));
    const result = await resolvePageContent(
      floorPage({ space: selectedSpaceId }),
    );
    expect(result.props.selectedSpaceId).toBeUndefined();
  });
  it("turns a missing or inaccessible floor into the same notFound response", async () => {
    vi.mocked(getFloorDay).mockRejectedValue(new ActionError("NOT_FOUND"));
    await expect(resolvePageContent(floorPage())).rejects.toThrow("NOT_FOUND");
    expect(getSpaceDay).not.toHaveBeenCalled();
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
