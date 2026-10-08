import {
  Children,
  isValidElement,
  type ReactNode,
  type SuspenseProps,
} from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BranchLayout from "@/app/(app)/branches/[branchId]/layout";
import { getSession } from "@/lib/auth/session";
import { cookies } from "next/headers";
import { getBranchNavigation } from "@/features/bookings/queries";
import { ActionError } from "@/lib/actions/result";
import { floorDayFixture } from "./booking-ui-fixtures";
import { resolvePageContent } from "./page-test-utils";
import { BranchDisplayClockProvider } from "@/features/bookings/components/branch-display-clock";
import { FloorViewProvider } from "@/features/bookings/components/floor-view";

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/features/bookings/queries", () => ({
  getBranchNavigation: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/features/bookings/components/branch-navigation", () => ({
  BranchNavigation: () => null,
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(cookies).mockResolvedValue({
    get: () => ({ name: "floor_view", value: "list" }),
  } as Awaited<ReturnType<typeof cookies>>);
  vi.mocked(getSession).mockResolvedValue({
    userId: "member",
    name: "회원",
    email: "member@example.test",
  });
  const floor = floorDayFixture();
  vi.mocked(getBranchNavigation).mockResolvedValue({
    branch: floor.branch,
    floors: floor.floors,
    branches: [],
    today: floor.date,
    bookingDates: [],
    now: "2026-10-07T01:10:00.000Z",
  });
});

async function navigationBoundary() {
  const shell = BranchLayout({
    params: Promise.resolve({ branchId: "branch" }),
    children: <p>페이지</p>,
  });
  const clock = await resolvePageContent(shell);
  expect(clock.type).toBe(BranchDisplayClockProvider);
  expect(clock.props.branchId).toBe("branch");
  const provider = clock.props.children;
  if (!isValidElement<{ children: ReactNode }>(provider))
    throw new Error("Missing floor view provider");
  expect(provider.type).toBe(FloorViewProvider);
  const workspace = provider.props.children;
  if (!isValidElement<{ children: ReactNode }>(workspace))
    throw new Error("Missing workspace");
  const [navigation, child] = Children.toArray(workspace.props.children);
  if (!isValidElement<SuspenseProps>(navigation))
    throw new Error("Missing navigation boundary");
  return { shell, navigation, child };
}

describe("independent branch layout navigation", () => {
  it("returns navigation and page siblings without starting session or navigation reads", async () => {
    const shell = BranchLayout({
      params: Promise.resolve({ branchId: "branch" }),
      children: <p>페이지</p>,
    });
    expect(cookies).not.toHaveBeenCalled();
    render(shell.props.fallback);
    expect(screen.getByRole("status")).toHaveTextContent("불러오고 있어요.");
    const { child } = await navigationBoundary();
    expect(isValidElement(child)).toBe(true);
    expect(getSession).not.toHaveBeenCalled();
    expect(getBranchNavigation).not.toHaveBeenCalled();
  });
  it("renders only a skeleton for an anonymous viewer and leaves redirection to the page", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    render(await resolvePageContent((await navigationBoundary()).navigation));
    expect(screen.getByRole("status")).toHaveTextContent("불러오고 있어요.");
    expect(getBranchNavigation).not.toHaveBeenCalled();
  });
  it("loads the separately authenticated navigation query for a signed-in viewer", async () => {
    const result = await resolvePageContent(
      (await navigationBoundary()).navigation,
    );
    expect(getBranchNavigation).toHaveBeenCalledExactlyOnceWith("branch");
    expect(isValidElement(result.props.children)).toBe(true);
  });
  it("turns only NOT_FOUND into notFound and propagates other failures", async () => {
    vi.mocked(getBranchNavigation).mockRejectedValueOnce(
      new ActionError("NOT_FOUND"),
    );
    await expect(
      resolvePageContent((await navigationBoundary()).navigation),
    ).rejects.toThrow("NOT_FOUND");
    const failure = new ActionError("INTERNAL");
    vi.mocked(getBranchNavigation).mockRejectedValueOnce(failure);
    await expect(
      resolvePageContent((await navigationBoundary()).navigation),
    ).rejects.toBe(failure);
  });
});
