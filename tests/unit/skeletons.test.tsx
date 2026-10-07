import { act, render, screen } from "@testing-library/react";
import { Suspense, use } from "react";
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
    (_, Component) => {
      const { container } = render(<Component />);
      const regions = container.querySelectorAll('[aria-busy="true"]');
      expect(regions).toHaveLength(1);
      expect(container.firstElementChild).toBe(regions[0]);
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
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
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

  it("matches the wide floor shell and preserves a separate empty-detail placeholder", () => {
    const { container } = render(<FloorPageSkeleton />);
    expect(container.firstElementChild).toHaveClass("max-w-[1184px]");
    expect(
      container.querySelectorAll('[data-slot="skeleton-row"]'),
    ).toHaveLength(4);
    expect(container.querySelector(".border-dashed")).toBeInTheDocument();
    expect(
      container.querySelectorAll('[data-slot="skeleton-region"]'),
    ).toHaveLength(1);
  });

  it("keeps both booking-history sections and uses the standard content width", () => {
    const { container } = render(<MyBookingsSkeleton />);
    expect(container.firstElementChild).toHaveClass("max-w-[880px]");
    expect(
      container.querySelectorAll('[data-slot="skeleton-row"]'),
    ).toHaveLength(4);
  });

  it("matches the team creation fields and the member table", () => {
    const start = render(<TeamStartSkeleton />);
    expect(start.container.firstElementChild).toHaveClass("max-w-[640px]");
    expect(
      start.container.querySelectorAll('[data-slot="skeleton-field"]'),
    ).toHaveLength(5);
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
