import { render, screen, within } from "@testing-library/react";
import {
  Children,
  cloneElement,
  isValidElement,
  Suspense,
  type ReactNode,
} from "react";
import { beforeEach, expect, it, vi } from "vitest";
import Home from "@/app/(app)/page";
import BookingPage from "@/app/(app)/booking/page";
import { requirePageSession } from "@/lib/auth/session";
import { getHomeTeams } from "@/features/teams/queries";
import { getAccountMenuData } from "@/features/auth/queries";
import {
  getHomeHeader,
  getHomeUpcomingBookings,
  getHomeFreeSpaces,
  getHomeBookingLimits,
  getBookingDestination,
} from "@/features/bookings/queries";
import { getOperatingState } from "@/features/bookings/operating-state";
import { resolvePageContent } from "./page-test-utils";
import { spaceDayFixture } from "./booking-ui-fixtures";

vi.mock("@/lib/auth/session", () => ({ requirePageSession: vi.fn() }));
vi.mock("@/features/teams/queries", () => ({ getHomeTeams: vi.fn() }));
vi.mock("@/features/auth/queries", () => ({ getAccountMenuData: vi.fn() }));
vi.mock("@/features/bookings/queries", () => ({
  getHomeHeader: vi.fn(),
  getHomeUpcomingBookings: vi.fn(),
  getHomeFreeSpaces: vi.fn(),
  getHomeBookingLimits: vi.fn(),
  getBookingDestination: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: (href: string) => {
    throw new Error(`REDIRECT ${href}`);
  },
}));

const detail = spaceDayFixture();
const operatingState = getOperatingState(
  new Date(detail.now),
  detail.branch.timezone,
  detail.branch.openHours,
);

async function resolveRegions(node: ReactNode): Promise<ReactNode> {
  if (!isValidElement<{ children?: ReactNode }>(node)) return node;
  if (
    typeof node.type === "function" &&
    node.type.constructor.name === "AsyncFunction"
  ) {
    const component = node.type as (props: object) => Promise<ReactNode>;
    return resolveRegions(await component(node.props));
  }
  const children = await Promise.all(
    Children.toArray(node.props.children).map(resolveRegions),
  );
  return cloneElement(node, {}, ...children);
}
async function displayHome() {
  return render(await resolveRegions(await resolvePageContent(Home())));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePageSession).mockResolvedValue({
    userId: "member",
    email: "member@example.test",
    name: "가상 회원",
  });
  vi.mocked(getHomeHeader).mockResolvedValue({
    name: "가상 회원",
    now: detail.now,
    date: detail.date,
    branch: null,
    operatingState: null,
  });
  vi.mocked(getHomeUpcomingBookings).mockResolvedValue({
    now: detail.now,
    bookings: [],
  });
  vi.mocked(getHomeFreeSpaces).mockResolvedValue({
    state: "no_branch",
    branch: null,
    now: detail.now,
    date: detail.date,
    operatingState: null,
    totalCount: 0,
    freeCount: 0,
    spaces: [],
  });
  vi.mocked(getHomeBookingLimits).mockResolvedValue(null);
  vi.mocked(getHomeTeams).mockResolvedValue({
    teams: [],
    pendingInviteCount: 2,
  });
  vi.mocked(getAccountMenuData).mockResolvedValue({
    name: "가상 회원",
    email: "member@example.test",
    isOperator: false,
  });
});

it("checks the page session and greets the member with branch selection, invites and empty next steps", async () => {
  await displayHome();
  expect(requirePageSession).toHaveBeenCalledWith("/");
  expect(
    screen.getByRole("heading", { name: "안녕하세요, 가상 회원님" }),
  ).toBeVisible();
  expect(
    screen.getByRole("link", { name: "팀 만들기 또는 가입" }),
  ).toHaveAttribute("href", "/teams/start");
  expect(screen.getByText("받은 초대 2개")).toBeVisible();
  expect(screen.getByRole("link", { name: "지점 고르기" })).toHaveAttribute(
    "href",
    "/branches",
  );
  for (const link of screen.getAllByRole("link", { name: "공간 예약하기" }))
    expect(link).toHaveAttribute("href", "/booking");
  expect(
    screen.queryByRole("link", { name: "운영자 화면" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("region", { name: "오늘 예약 한도" }),
  ).not.toBeInTheDocument();
});

it("shows team roles and the operator destination without a personal limit card", async () => {
  vi.mocked(getHomeTeams).mockResolvedValue({
    teams: [{ id: "team", name: "가상 팀", role: "admin" }],
    pendingInviteCount: 0,
  });
  vi.mocked(getAccountMenuData).mockResolvedValue({
    name: "가상 회원",
    email: "member@example.test",
    isOperator: true,
  });
  await displayHome();
  expect(screen.getByRole("link", { name: /가상 팀/ })).toHaveAttribute(
    "href",
    "/teams/team",
  );
  expect(screen.getByText("팀 관리자")).toBeVisible();
  expect(screen.getByRole("link", { name: "팀 관리" })).toHaveAttribute(
    "href",
    "/teams",
  );
  expect(screen.getByRole("link", { name: "운영자 화면" })).toHaveAttribute(
    "href",
    "/admin",
  );
  expect(screen.queryByText("팀 예약")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("region", { name: "오늘 예약 한도" }),
  ).not.toBeInTheDocument();
});

it("uses the resolved branch in both the header and free-space card, including a team fallback", async () => {
  vi.mocked(getHomeHeader).mockResolvedValue({
    name: "가상 회원",
    now: detail.now,
    date: detail.date,
    branch: detail.branch,
    operatingState,
  });
  vi.mocked(getHomeFreeSpaces).mockResolvedValue({
    state: "ready",
    branch: detail.branch,
    now: detail.now,
    date: detail.date,
    operatingState,
    totalCount: 4,
    freeCount: 3,
    spaces: [
      {
        id: detail.space.id,
        name: detail.space.name,
        photo: null,
        type: detail.space.type,
        capacity: 6,
        amenities: ["monitor"],
        floor: detail.floor,
        intervals: [],
        freeUntil: "2026-10-07T02:00:00.000Z",
      },
    ],
  });
  vi.mocked(getHomeBookingLimits).mockResolvedValue({
    branch: { id: detail.branch.id, name: detail.branch.name },
    now: detail.now,
    date: detail.date,
    limitMinutes: 120,
    usedMinutes: 60,
    remainingMinutes: 60,
  });
  const { container } = await displayHome();
  expect(screen.getByText(/가상 지점은 오늘 14:00까지 열어요/)).toBeVisible();
  const free = screen.getByRole("region", {
    name: "지금 비어 있는 공간 · 가상 지점",
  });
  expect(within(free).getByRole("link", { name: /회의실 C/ })).toHaveAttribute(
    "href",
    "/branches/branch/floors/floor?date=2026-10-07&space=space",
  );
  expect(
    screen.getByText("예약할 수 있는 공간 4곳 중 3곳이 비어 있어요"),
  ).toBeVisible();
  expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "60");
  expect(container.querySelector("a button")).toBeNull();
});

it.each(["no_floors", "outside_hours"] as const)(
  "shows the next step for %s",
  async (state) => {
    vi.mocked(getHomeFreeSpaces).mockResolvedValue({
      state,
      branch: detail.branch,
      now: detail.now,
      date: detail.date,
      operatingState: {
        ...operatingState,
        status: "after_close",
        nextOpening: "2026-10-08T00:00:00.000Z",
      },
      totalCount: 0,
      freeCount: 0,
      spaces: [],
    });
    await displayHome();
    if (state === "no_floors")
      expect(
        screen.getByText("이 지점에는 이용할 수 있는 층이 아직 없어요"),
      ).toBeVisible();
    else {
      expect(
        screen.getByText("지금은 운영 시간이 아니에요. 내일 09:00에 열어요"),
      ).toBeVisible();
      expect(
        screen.getByRole("link", { name: "다른 날짜 보기" }),
      ).toHaveAttribute("href", "/booking");
    }
  },
);

it("does not invent an opening for an entirely closed branch", async () => {
  vi.mocked(getHomeFreeSpaces).mockResolvedValue({
    state: "outside_hours",
    branch: detail.branch,
    now: detail.now,
    date: detail.date,
    operatingState: { ...operatingState, status: "closed", nextOpening: null },
    totalCount: 0,
    freeCount: 0,
    spaces: [],
  });
  await displayHome();
  expect(screen.getByText("운영 예정 시간이 없어요")).toBeVisible();
});

it("keeps all six server reads in separate Suspense regions after the direct page guard", async () => {
  const page = await resolvePageContent(Home());
  const boundaries: ReactNode[] = [];
  function visit(node: ReactNode) {
    if (!isValidElement<{ children?: ReactNode }>(node)) return;
    if (node.type === Suspense) boundaries.push(node);
    else Children.forEach(node.props.children, visit);
  }
  visit(page);
  expect(boundaries).toHaveLength(6);
  expect(requirePageSession).toHaveBeenCalledExactlyOnceWith("/");
  expect(getHomeHeader).not.toHaveBeenCalled();
  expect(getHomeUpcomingBookings).not.toHaveBeenCalled();
  expect(getHomeFreeSpaces).not.toHaveBeenCalled();
  expect(getHomeBookingLimits).not.toHaveBeenCalled();
  expect(getHomeTeams).not.toHaveBeenCalled();
});

it.each(["/branches", "/branches/branch", "/branches/branch/floors/floor"])(
  "guards booking entry and redirects once to %s",
  async (href) => {
    vi.mocked(getBookingDestination).mockResolvedValue(href);
    const shell = BookingPage();
    expect(shell.type).toBe(Suspense);
    expect(requirePageSession).not.toHaveBeenCalled();
    await expect(resolvePageContent(shell)).rejects.toThrow(`REDIRECT ${href}`);
    expect(requirePageSession).toHaveBeenCalledWith("/booking");
    expect(getBookingDestination).toHaveBeenCalledOnce();
  },
);
