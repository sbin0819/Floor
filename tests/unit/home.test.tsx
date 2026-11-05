import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import {
  getHomeChecklist,
  getHomeRecentChats,
  getHomeTodo,
} from "@/features/home/queries";
import { homeChecklist, homeChats, homeTodo } from "../helpers/home";
import { getAccountMenuData } from "@/features/auth/queries";
import {
  getHomeHeader,
  getHomeUpcomingBookings,
  getHomeFreeSpaces,
  getHomeBookingLimits,
  getHomeWeekBookings,
  getHomeFrequentSpaces,
  getBookingDestination,
} from "@/features/bookings/queries";
import { getOperatingState } from "@/features/bookings/operating-state";
import { resolvePageContent } from "./page-test-utils";
import { spaceDayFixture } from "./booking-ui-fixtures";

vi.mock("@/lib/auth/session", () => ({ requirePageSession: vi.fn() }));
vi.mock("@/features/home/queries", () => ({
  getHomeChecklist: vi.fn(),
  getHomeRecentChats: vi.fn(),
  getHomeTodo: vi.fn(),
}));
vi.mock("@/features/home/actions", () => ({ dismissHomeChecklist: vi.fn() }));
vi.mock("@/features/auth/queries", () => ({ getAccountMenuData: vi.fn() }));
vi.mock("@/features/bookings/actions", () => ({ cancelBooking: vi.fn() }));
vi.mock("@/features/bookings/queries", () => ({
  getHomeHeader: vi.fn(),
  getHomeUpcomingBookings: vi.fn(),
  getHomeFreeSpaces: vi.fn(),
  getHomeBookingLimits: vi.fn(),
  getHomeWeekBookings: vi.fn(),
  getHomeFrequentSpaces: vi.fn(),
  getBookingDestination: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ refresh: vi.fn() }),
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
  if (!isValidElement<Record<string, ReactNode>>(node)) return node;
  if (
    typeof node.type === "function" &&
    node.type.constructor.name === "AsyncFunction"
  ) {
    const component = node.type as (props: object) => Promise<ReactNode>;
    return resolveRegions(await component(node.props));
  }
  const slots: Record<string, ReactNode> = {};
  for (const key of [
    "children",
    "header",
    "todo",
    "firstRow",
    "week",
    "thirdRow",
    "operator",
  ]) {
    if (!(key in node.props)) continue;
    slots[key] = await Promise.all(
      Children.toArray(node.props[key]).map(resolveRegions),
    );
  }
  return cloneElement(node, slots);
}
async function displayHome() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      {await resolveRegions(Home())}
    </QueryClientProvider>,
  );
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
    firstVisit: false,
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
  vi.mocked(getHomeWeekBookings).mockResolvedValue({
    now: detail.now,
    today: detail.date,
    timezone: "Asia/Seoul",
    openHours: null,
    days: [],
  });
  vi.mocked(getHomeFrequentSpaces).mockResolvedValue({ spaces: [] });
  vi.mocked(getHomeTodo).mockResolvedValue({ ...homeTodo, teamInvites: 2 });
  vi.mocked(getHomeChecklist).mockResolvedValue(homeChecklist);
  vi.mocked(getHomeRecentChats).mockResolvedValue([]);
  vi.mocked(getAccountMenuData).mockResolvedValue({
    name: "가상 회원",
    avatar: { color: "blue", photoUrl: null },
    email: "member@example.test",
    isOperator: false,
    myStatus: "online",
    username: null,
  });
});

it("shows fixed titles and links before session data and preserves the booking link on arrival", async () => {
  const page = Home();
  const pending = cloneElement(page, {
    header: page.props.header.props.fallback,
    children: page.props.children.props.fallback,
  });
  const client = new QueryClient();
  const view = render(
    <QueryClientProvider client={client}>{pending}</QueryClientProvider>,
  );
  for (const name of [
    "다음 예약",
    "지금 비어 있는 공간",
    "자주 쓰는 공간",
    "이번 주 내 예약",
    "오늘 예약 한도",
  ])
    expect(screen.getByRole("heading", { name })).toBeVisible();
  const bookingLink = screen.getByRole("link", { name: "공간 예약하기" });
  bookingLink.focus();
  expect(requirePageSession).not.toHaveBeenCalled();
  expect(screen.queryByText("예약 없음")).not.toBeInTheDocument();
  expect(screen.queryByText("예약이 아직 없어요")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "운영자 화면" }),
  ).not.toBeInTheDocument();
  view.rerender(
    <QueryClientProvider client={client}>
      {await resolveRegions(page)}
    </QueryClientProvider>,
  );
  expect(screen.getAllByRole("link", { name: "공간 예약하기" })[0]).toBe(
    bookingLink,
  );
  expect(bookingLink).toHaveFocus();
});

it("checks the page session and greets the member with branch selection, invites and empty next steps", async () => {
  await displayHome();
  expect(requirePageSession).toHaveBeenCalledWith("/");
  expect(
    screen.getByRole("heading", { name: "안녕하세요, 가상 회원님" }),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: "팀 찾기" })).toHaveAttribute(
    "href",
    "/teams/start",
  );
  expect(
    screen.getByRole("link", { name: "받은 팀 초대 2개" }),
  ).toHaveAttribute("href", "/teams");
  expect(screen.getByText("팀 만들기 또는 들어가기")).toBeVisible();
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

it("shows team requests in their new destination and the operator link without a personal limit card", async () => {
  vi.mocked(getHomeTodo).mockResolvedValue({
    ...homeTodo,
    joinRequests: {
      top: { teamId: "team", teamName: "가상 팀", count: 3 },
      rest: 0,
    },
  });
  vi.mocked(getHomeChecklist).mockResolvedValue({
    ...homeChecklist,
    visible: false,
    isOperator: true,
  });
  vi.mocked(getAccountMenuData).mockResolvedValue({
    name: "가상 회원",
    avatar: { color: "blue", photoUrl: null },
    email: "member@example.test",
    isOperator: true,
    myStatus: "online",
    username: null,
  });
  await displayHome();
  expect(screen.getByRole("link", { name: /가상 팀/ })).toHaveAttribute(
    "href",
    "/teams/team?tab=requests",
  );
  expect(
    screen.queryByRole("region", { name: "내 팀" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("region", { name: "Floor 시작하기" }),
  ).not.toBeInTheDocument();
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
    firstVisit: false,
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

it("creates the shared placement promises only after the content session guard", async () => {
  const page = Home();
  expect(requirePageSession).not.toHaveBeenCalled();
  const boundaries: ReactNode[] = [];
  function visit(node: ReactNode) {
    if (!isValidElement<Record<string, ReactNode>>(node)) return;
    if (node.type === Suspense) boundaries.push(node);
    else
      for (const key of [
        "children",
        "todo",
        "firstRow",
        "week",
        "thirdRow",
        "operator",
      ])
        Children.forEach(node.props[key], visit);
  }
  visit(page.props.header);
  visit(await resolvePageContent(page.props.children));
  expect(boundaries).toHaveLength(8);
  expect(requirePageSession).toHaveBeenCalledTimes(1);
  expect(requirePageSession).toHaveBeenCalledWith("/");
  expect(getHomeHeader).not.toHaveBeenCalled();
  expect(getHomeUpcomingBookings).not.toHaveBeenCalled();
  expect(getHomeFreeSpaces).not.toHaveBeenCalled();
  expect(getHomeBookingLimits).not.toHaveBeenCalled();
  expect(getHomeWeekBookings).not.toHaveBeenCalled();
  expect(getHomeFrequentSpaces).not.toHaveBeenCalled();
  expect(getHomeChecklist).toHaveBeenCalledOnce();
  expect(getHomeRecentChats).toHaveBeenCalledOnce();
  expect(getHomeTodo).not.toHaveBeenCalled();
});

it.each([
  [true, true, "Floor 시작하기", true],
  [true, false, "Floor 시작하기", true],
  [false, false, "다음 예약", true],
  [false, true, "다음 예약", false],
] as const)(
  "places one free-spaces card with checklist=%s and chats=%s",
  async (visible, hasChats, left, firstFree) => {
    vi.mocked(getHomeChecklist).mockResolvedValue({
      ...homeChecklist,
      visible,
    });
    vi.mocked(getHomeRecentChats).mockResolvedValue(hasChats ? homeChats : []);
    const { container } = await displayHome();
    const first = container.querySelector(
      '[data-home-row="first"]',
    )! as HTMLElement;
    const third = container.querySelector(
      '[data-home-row="third"]',
    )! as HTMLElement;
    expect(within(first).getByRole("region", { name: left })).toBeVisible();
    expect(
      within(firstFree ? first : third).getByRole("region", {
        name: "지금 비어 있는 공간",
      }),
    ).toBeVisible();
    expect(
      screen.getAllByRole("region", { name: "지금 비어 있는 공간" }),
    ).toHaveLength(1);
    expect(Boolean(screen.queryByRole("region", { name: "최근 대화" }))).toBe(
      !firstFree,
    );
    expect(getHomeChecklist).toHaveBeenCalledOnce();
    expect(getHomeRecentChats).toHaveBeenCalledOnce();
    expect(getHomeFreeSpaces).toHaveBeenCalledOnce();
    expect(getHomeUpcomingBookings).toHaveBeenCalledTimes(visible ? 0 : 1);
  },
);

it("does not start any home lookup if the direct page guard rejects", async () => {
  vi.mocked(requirePageSession).mockRejectedValue(new Error("REDIRECT login"));
  await expect(resolvePageContent(Home().props.children)).rejects.toThrow(
    "REDIRECT login",
  );
  for (const read of [
    getHomeChecklist,
    getHomeRecentChats,
    getHomeTodo,
    getHomeUpcomingBookings,
    getHomeFreeSpaces,
    getHomeBookingLimits,
    getHomeWeekBookings,
    getHomeFrequentSpaces,
  ])
    expect(read).not.toHaveBeenCalled();
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
