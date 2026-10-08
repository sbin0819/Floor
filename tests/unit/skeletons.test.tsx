import { act, render, screen } from "@testing-library/react";
import { Suspense, use } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SkeletonRegion } from "@/components/skeleton-region";
import { SkeletonHeading } from "@/components/skeleton-shapes";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AdminBranchSkeleton,
  AdminFloorSkeleton,
  AdminHomeSkeleton,
  AdminNavSkeleton,
} from "@/features/admin/components/admin-skeletons";
import { AuthLoading } from "@/features/auth/components/auth-card";
import type { AuthSkeletonVariant } from "@/features/auth/components/auth-skeleton";
import {
  BranchFloorsSkeleton,
  BranchListSkeleton,
  FloorNavigationSkeleton,
  FloorPageSkeleton,
  FloorSpaceListSkeleton,
  MyBookingsSkeleton,
  SpaceDetailSkeleton,
} from "@/features/bookings/components/booking-skeletons";
import {
  HomeSkeleton,
  InviteSkeleton,
  TeamDetailSkeleton,
  TeamStartSkeleton,
} from "@/features/teams/components/team-skeletons";

const screens = [
  ["home", HomeSkeleton],
  ["branches", BranchListSkeleton],
  ["branch floors", BranchFloorsSkeleton],
  ["floor navigation", FloorNavigationSkeleton],
  ["floor list", FloorSpaceListSkeleton],
  ["whole floor", FloorPageSkeleton],
  ["space detail", SpaceDetailSkeleton],
  ["my bookings", MyBookingsSkeleton],
  ["team start", TeamStartSkeleton],
  ["team detail", TeamDetailSkeleton],
  ["invite", InviteSkeleton],
  ["admin home", AdminHomeSkeleton],
  ["admin branch", AdminBranchSkeleton],
  ["admin floor", AdminFloorSkeleton],
  ["admin navigation", AdminNavSkeleton],
  ["auth", AuthLoading],
] as const;

describe("accessible skeleton regions", () => {
  it.each(screens)(
    "%s has one busy region and one screen-reader announcement",
    (name, Component) => {
      const { container } = render(<Component />);
      const regions = container.querySelectorAll('[aria-busy="true"]');
      expect(regions).toHaveLength(1);
      if (name === "branches") {
        const heading = screen.getByRole("heading", { name: "지점" });
        expect(heading).toBeVisible();
        expect(regions[0]).not.toContainElement(heading);
      } else expect(container.firstElementChild).toBe(regions[0]);
      const status = screen.getAllByRole("status");
      expect(status).toHaveLength(1);
      expect(status[0]).toHaveClass("sr-only");
      expect(status[0]).toHaveTextContent("불러오고 있어요.");
      const pieces = container.querySelectorAll('[data-slot="skeleton"]');
      expect(pieces.length).toBeGreaterThan(1);
      for (const piece of pieces) {
        expect(piece).toHaveAttribute("aria-hidden", "true");
        expect(piece).toHaveClass("motion-reduce:animate-none");
        expect(piece).not.toHaveAttribute("aria-label");
      }
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      if (name === "team detail") {
        expect(screen.getByRole("link", { name: "‹ 팀" })).toHaveAttribute(
          "href",
          "/teams",
        );
        expect(screen.getAllByRole("link")).toHaveLength(1);
      } else expect(screen.queryByRole("link")).not.toBeInTheDocument();
    },
  );

  it("keeps decorative pieces hidden and supports size overrides", () => {
    const { container } = render(
      <Skeleton aria-hidden="false" className="h-11 w-24" />,
    );
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(container.firstElementChild).toHaveClass("h-11", "w-24", "bg-muted");
  });

  it("reserves heading and description lines without duplicate announcements", () => {
    const { container } = render(
      <SkeletonRegion>
        <SkeletonHeading />
      </SkeletonRegion>,
    );
    const heading = container.querySelector('[data-slot="skeleton-heading"]');
    expect(heading?.children).toHaveLength(2);
    expect(heading?.firstElementChild).toHaveClass("h-8");
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("removes the loading announcement and busy state after real content streams", async () => {
    let resolve: () => void = () => {};
    const ready = new Promise<void>((done) => {
      resolve = done;
    });
    function Content() {
      use(ready);
      return <h1>내 팀을 확인해요</h1>;
    }
    await act(async () => {
      render(
        <Suspense fallback={<HomeSkeleton />}>
          <Content />
        </Suspense>,
      );
    });
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    await act(async () => {
      resolve();
      await ready;
    });
    expect(
      screen.getByRole("heading", { name: "내 팀을 확인해요" }),
    ).toBeVisible();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(document.querySelector("[aria-busy]")).not.toBeInTheDocument();
  });
});

describe("screen-specific loading geometry", () => {
  it.each<[AuthSkeletonVariant, number]>([
    ["login", 2],
    ["signup", 3],
    ["email", 1],
    ["reset", 1],
    ["operator", 2],
  ])("%s reserves %i labelled 44px inputs", (variant, fields) => {
    const { container } = render(<AuthLoading variant={variant} />);
    const inputs = container.querySelectorAll('[data-slot="skeleton-field"]');
    expect(inputs).toHaveLength(fields);
    for (const input of inputs)
      expect(input.lastElementChild).toHaveClass("h-11");
    expect(container.firstElementChild).toHaveClass("rounded-xl", "bg-card");
  });

  it("matches the wide floor shell and uses CSS defaults for the unknown initial view", () => {
    const { container } = render(<FloorPageSkeleton />);
    expect(container.firstElementChild).toHaveClass("max-w-[1184px]");
    expect(
      container.querySelectorAll('[data-slot="skeleton-row"]'),
    ).toHaveLength(4);
    expect(
      container.querySelector('[data-slot="skeleton-floor-default-list"]'),
    ).toHaveClass("lg:hidden");
    expect(
      container.querySelector('[data-slot="skeleton-floor-default-timetable"]'),
    ).toHaveClass("hidden", "lg:block");
    expect(container.querySelector(".border-dashed")).not.toBeInTheDocument();
    expect(
      container.querySelectorAll('[data-slot="skeleton-timetable-row"]'),
    ).toHaveLength(4);
    expect(
      container.querySelector('[data-slot="skeleton-date-window"]')?.children,
    ).toHaveLength(7);
    expect(
      container.querySelectorAll('[data-slot="skeleton-availability"]'),
    ).toHaveLength(4);
    expect(
      container.querySelectorAll('[data-slot="skeleton-region"]'),
    ).toHaveLength(1);
  });

  it("renders both unknown-view shapes on the server without browser or URL hooks", () => {
    const html = renderToString(<FloorPageSkeleton />);
    expect(html).toContain('data-slot="skeleton-floor-default-list"');
    expect(html).toContain('data-slot="skeleton-floor-default-timetable"');
    expect(html.match(/aria-busy="true"/g)).toHaveLength(1);
    expect(html.match(/role="status"/g)).toHaveLength(1);
  });

  it("reserves the same three mobile toolbar rows without duplicating controls", () => {
    const { container } = render(<FloorNavigationSkeleton />);
    const states = container.querySelectorAll(
      '[data-slot="skeleton-operating-status"]',
    );
    const views = container.querySelectorAll(
      '[data-slot="skeleton-view-control"]',
    );
    expect(states).toHaveLength(1);
    expect(views).toHaveLength(1);
    expect(states[0]).toHaveClass("row-start-3", "lg:row-start-1");
    expect(views[0]).toHaveClass("row-start-3", "lg:row-start-1");
    const dates = container.querySelector('[data-slot="skeleton-date-window"]');
    const trigger = container.querySelector(
      '[data-slot="skeleton-calendar-trigger"]',
    );
    expect(dates?.children).toHaveLength(7);
    expect(dates).not.toContainElement(trigger as HTMLElement);
    expect(trigger).toHaveClass("shrink-0", "h-11");
  });

  it("reserves larger desktop thumbnails, status lines and availability bars in each list row", () => {
    const { container } = render(<FloorSpaceListSkeleton />);
    const rows = container.querySelectorAll('[data-slot="skeleton-row"]');
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.querySelector('[data-slot="skeleton-photo"]')).toHaveClass(
        "h-11",
        "w-14",
        "md:h-[54px]",
        "md:w-[72px]",
      );
      const status = row.querySelector('[data-slot="skeleton-status-line"]');
      expect(status?.children).toHaveLength(2);
      expect(status?.firstElementChild).toHaveClass("size-2", "rounded-full");
      expect(
        row.querySelector('[data-slot="skeleton-availability"]'),
      ).toBeInTheDocument();
    }
  });

  it("reserves four detail areas and prioritizes the day schedule over an expanded form", () => {
    const { container } = render(<SpaceDetailSkeleton />);
    expect(container.firstElementChild).toHaveClass(
      "flex",
      "h-full",
      "flex-col",
      "min-h-0",
    );
    expect(container.querySelector('[data-slot="skeleton-photo"]')).toHaveClass(
      "h-[160px]",
      "shrink-0",
      "[@media(max-height:759px)]:h-[120px]",
    );
    expect(
      container.querySelector('[data-slot="skeleton-detail-information"]'),
    ).toHaveClass("shrink-0");
    expect(
      container.querySelector('[data-slot="skeleton-detail-schedule"]'),
    ).toHaveClass("min-h-[280px]", "flex-1", "overflow-hidden");
    const slots = container.querySelectorAll(
      '[data-slot="skeleton-time-slot"]',
    );
    expect(slots).toHaveLength(12);
    for (const slot of slots) expect(slot).toHaveClass("h-11", "lg:h-7");
    const booking = container.querySelector(
      '[data-slot="skeleton-detail-booking"]',
    );
    expect(booking).toHaveClass("shrink-0", "border-t");
    expect(booking?.children).toHaveLength(2);
    expect(
      container.querySelector('[data-slot="skeleton-field"]'),
    ).not.toBeInTheDocument();
  });

  it("keeps booking tabs and one list within the standard content width", () => {
    const { container } = render(<MyBookingsSkeleton />);
    expect(container.firstElementChild).toHaveClass("max-w-[880px]");
    expect(
      container.querySelectorAll('[data-slot="skeleton-row"]'),
    ).toHaveLength(3);
    expect(
      container.querySelector('[data-slot="skeleton-booking-tabs"]')?.children,
    ).toHaveLength(2);
  });

  it("matches the team choice cards and the member table", () => {
    const start = render(<TeamStartSkeleton />);
    expect(start.container.firstElementChild).toHaveClass("max-w-[880px]");
    expect(
      start.container.querySelectorAll('[data-slot="skeleton-row"]'),
    ).toHaveLength(6);
    start.unmount();
    const detail = render(<TeamDetailSkeleton />);
    const rows = detail.container.querySelectorAll(
      '[data-slot="skeleton-row"]',
    );
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.children).toHaveLength(4);
  });

  it("reserves all seven operating-hour rows in branch administration", () => {
    const { container } = render(<AdminBranchSkeleton />);
    expect(
      container.querySelectorAll('[data-slot="skeleton-hours-row"]'),
    ).toHaveLength(7);
    expect(
      container.querySelectorAll('[data-slot="skeleton-field"]'),
    ).toHaveLength(2);
  });

  it("matches the paired floor/access forms and space table in floor administration", () => {
    const { container } = render(<AdminFloorSkeleton />);
    expect(
      container.querySelectorAll('[data-slot="skeleton-field"]'),
    ).toHaveLength(5);
    expect(
      container.querySelectorAll('[data-slot="skeleton-row"]'),
    ).toHaveLength(3);
  });
});
