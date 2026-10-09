import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminShellFrame } from "@/features/admin/components/admin-shell-frame";
import { AdminShellNavigation } from "@/features/admin/components/admin-shell-navigation";
import { AdminBreadcrumb } from "@/features/admin/components/admin-breadcrumb";
import {
  AdminHomeSkeleton,
  AdminBranchSkeleton,
  AdminFloorSkeleton,
} from "@/features/admin/components/admin-skeletons";
import { OperatorBranchCards } from "@/features/admin/components/operator-branch-cards";
import type { OperatorBranchCard } from "@/features/admin/types";
import { getOperatingState } from "@/features/bookings/operating-state";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/branches/branch",
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/components/sign-out-button", () => ({
  SignOutButton: () => <button>로그아웃</button>,
}));

const branch = { id: "branch", name: "가상점" };
const floor = { id: "floor", name: "7층" };
function card(
  status: OperatorBranchCard["operatingState"]["status"],
): OperatorBranchCard {
  return {
    ...branch,
    address: "가상로 7",
    floorCount: 2,
    spaceCount: 6,
    operatingState: {
      ...getOperatingState(new Date("2026-10-07T03:00:00Z"), "Asia/Seoul", {}),
      status,
    },
  };
}

describe("operator breadcrumb", () => {
  it.each([
    { props: {}, names: ["지점"], paths: ["/admin"] },
    {
      props: { branch },
      names: ["지점", "가상점"],
      paths: ["/admin", "/admin/branches/branch/spaces"],
    },
    {
      props: { branch, floor },
      names: ["지점", "가상점", "7층"],
      paths: [
        "/admin",
        "/admin/branches/branch/spaces",
        "/admin/branches/branch/floors/floor",
      ],
    },
  ])(
    "uses linked authorized names and only one current page at depth $names.length",
    ({ props, names, paths }) => {
      const { container } = render(<AdminBreadcrumb {...props} />);
      const links = within(
        screen.getByRole("navigation", { name: "경로" }),
      ).getAllByRole("link");
      expect(links).toHaveLength(names.length);
      links.forEach((link, index) => {
        expect(link).toHaveAccessibleName(names[index]);
        expect(link).toHaveAttribute("href", paths[index]);
        expect(link).toHaveClass("min-h-11");
        if (index === links.length - 1)
          expect(link).toHaveAttribute("aria-current", "page");
        else expect(link).not.toHaveAttribute("aria-current");
      });
      for (const icon of container.querySelectorAll("svg"))
        expect(icon).toHaveAttribute("aria-hidden", "true");
    },
  );
});

describe("operator home", () => {
  it.each([
    ["open", "영업 중 · 22:00까지"],
    ["before_open", "09:00에 열어요"],
    ["after_close", "오늘 영업이 끝났어요"],
    ["closed", "쉬는 날이에요"],
  ] as const)(
    "renders %s state and counts inside one whole-card link",
    (status, label) => {
      render(<OperatorBranchCards branches={[card(status)]} />);
      const link = screen.getByRole("link", { name: /가상점/ });
      expect(link).toHaveAttribute("href", "/admin/branches/branch");
      expect(within(link).getByText("가상로 7")).toBeVisible();
      expect(within(link).getByText(label)).toBeVisible();
      expect(within(link).getByText("층 2개 · 공간 6곳")).toHaveClass(
        "tabular-nums",
      );
      expect(screen.getAllByRole("link")).toHaveLength(1);
      expect(within(link).queryByRole("button")).not.toBeInTheDocument();
    },
  );

  it("shows an explicit address fallback and zero counts", () => {
    render(
      <OperatorBranchCards
        branches={[
          { ...card("closed"), address: null, floorCount: 0, spaceCount: 0 },
        ]}
      />,
    );
    expect(screen.getByText("주소 정보가 없어요")).toBeVisible();
    expect(screen.getByText("층 0개 · 공간 0곳")).toBeVisible();
  });

  it("keeps desktop navigation scroll separate from bottom logout and fixes the mobile header", () => {
    const { container } = render(
      <AdminShellFrame
        sidebar={<AdminShellNavigation />}
        mobile={<AdminShellNavigation mobile />}
      >
        <main>내용</main>
      </AdminShellFrame>,
    );
    const aside = container.querySelector("aside")!;
    expect(aside).toHaveClass(
      "lg:sticky",
      "lg:top-0",
      "lg:h-dvh",
      "lg:self-start",
    );
    expect(aside).not.toHaveClass("fixed", "sticky", "h-dvh");
    const menu = screen.getByRole("navigation", { name: "운영자 메뉴" });
    expect(menu.parentElement).toHaveClass(
      "min-h-0",
      "flex-1",
      "overflow-y-auto",
    );
    const logout = screen.getByRole("button", { name: "로그아웃" });
    expect(logout.parentElement).toBe(aside.lastElementChild);
    expect(logout.parentElement).toHaveClass(
      "shrink-0",
      "pb-[env(safe-area-inset-bottom)]",
    );
    expect(
      within(menu)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["지점"]);
    expect(screen.getByRole("link", { name: "멤버 화면으로" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(container.querySelector("header")).toHaveClass(
      "sticky",
      "top-0",
      "z-45",
    );
    expect(screen.getByRole("main")).toHaveTextContent("내용");
  });

  it.each([
    [AdminHomeSkeleton, 1],
    [AdminBranchSkeleton, 2],
    [AdminFloorSkeleton, 3],
  ] as const)(
    "includes breadcrumb placeholders in the content busy region",
    (Component, depth) => {
      const { container } = render(<Component />);
      const breadcrumb = container.querySelector(
        '[data-slot="skeleton-breadcrumb"]',
      )!;
      expect(breadcrumb.children).toHaveLength(depth);
      expect(breadcrumb).toHaveAttribute("aria-hidden", "true");
      expect(screen.getAllByRole("status")).toHaveLength(1);
      expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    },
  );

  it("reserves the same responsive two-card grid while the home is loading", () => {
    const { container } = render(<AdminHomeSkeleton />);
    const cards = container.querySelectorAll(
      '[data-slot="skeleton-branch-card"]',
    );
    expect(cards).toHaveLength(2);
    expect(cards[0]?.parentElement).toHaveClass(
      "grid",
      "gap-5",
      "sm:grid-cols-2",
    );
  });

  it("renders only non-sensitive fixed branch headings, weekdays and columns before data", () => {
    render(<AdminBranchSkeleton />);
    for (const title of ["지점 정보", "운영 시간", "층"])
      expect(screen.getByRole("heading", { name: title })).toBeVisible();
    expect(
      within(screen.getByRole("table", { name: "요일별 운영 시간" }))
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["요일", "쉬는 날", "시작", "끝"]);
    expect(
      within(screen.getByRole("table", { name: "요일별 운영 시간" }))
        .getAllByRole("rowheader")
        .map((cell) => cell.textContent),
    ).toEqual([
      "월요일",
      "화요일",
      "수요일",
      "목요일",
      "금요일",
      "토요일",
      "일요일",
    ]);
    expect(
      within(screen.getByRole("table", { name: "층 목록" }))
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["층 번호", "이름", "이용 대상", "공간 수"]);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText("가상점")).not.toBeInTheDocument();
  });

  it("renders fixed floor and space columns without names, counts or actions", () => {
    render(<AdminFloorSkeleton />);
    for (const title of ["층 정보", "층 이용 대상", "공간"])
      expect(screen.getByRole("heading", { name: title })).toBeVisible();
    expect(
      screen.getAllByRole("columnheader").map((cell) => cell.textContent),
    ).toEqual(["이름", "정원", "예약 가능", "편의 시설", "이용 대상", "동작"]);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText("7층")).not.toBeInTheDocument();
  });
});
