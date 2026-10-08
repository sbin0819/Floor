import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FloorDay } from "@/features/bookings/components/floor-day";
import { SpaceDetail } from "@/features/bookings/components/space-detail";
import { BranchList } from "@/features/bookings/components/branch-list";
import { BranchNavigation } from "@/features/bookings/components/branch-navigation";
import { MyBookings } from "@/features/bookings/components/my-bookings";
import {
  HomeFreeSpaces,
  HomeUpcomingBookings,
} from "@/features/bookings/components/home-dashboard";
import {
  FloorSpaceListSkeleton,
  SpaceDetailSkeleton,
  BranchListSkeleton,
  MyBookingsSkeleton,
} from "@/features/bookings/components/booking-skeletons";
import { HomeCardSkeleton } from "@/features/bookings/components/home-skeletons";
import type { MyBooking } from "@/features/bookings/types";
import { floorDayFixture, spaceDayFixture } from "./booking-ui-fixtures";

vi.mock("next/navigation", () => ({
  useSelectedLayoutSegments: () => ["floors", "floor"],
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ branchId: "branch", floorId: "floor" }),
  useSearchParams: () => new URLSearchParams("date=2026-10-07"),
}));
vi.mock("@/features/bookings/components/floor-view", () => ({
  useFloorView: () => ({ effectiveView: "list" }),
  useFloorPeople: () => ({
    people: null,
    override: undefined,
    setOverride: undefined,
  }),
}));
vi.mock("@/features/bookings/actions", () => ({
  setDefaultBranch: vi.fn(),
  cancelBooking: vi.fn(),
}));
vi.mock("@/features/bookings/components/booking-form", () => ({
  BookingForm: () => <div>기존 예약 양식</div>,
}));

const photo = {
  path: "/seed/photos/meeting-small-sage.webp",
  alt: "가상 회의실의 테이블과 화이트보드",
};
function bookingFixture(): MyBooking {
  return {
    relation: "owner",
    meetingRoomId: null,
    invitedByName: null,
    participantNames: [],
    desk: null,
    id: "booking",
    start: "2026-10-07T02:00:00Z",
    end: "2026-10-07T03:00:00Z",
    date: "2026-10-07",
    timezone: "Asia/Seoul",
    title: null,
    attendeeCount: null,
    teamName: null,
    status: "confirmed",
    cancelledAt: null,
    branchId: "branch",
    branchName: "가상 지점",
    floorId: "floor",
    floorName: "7F",
    spaceId: "space",
    spaceName: "회의실 C",
    spaceType: "meeting_room",
    photo,
  };
}

describe("photos in existing member screens", () => {
  it("adds a responsive 72 by 54 decorative photo without changing the space link, and no image for restricted rows", () => {
    const data = floorDayFixture();
    const space = data.spaces[0]!;
    if (space.kind !== "accessible")
      throw new Error("Expected visible fixture");
    space.photo = photo;
    render(<FloorDay data={data} />);
    const link = screen.getByRole("link", { name: /회의실 C/ });
    expect(link).toHaveAttribute(
      "href",
      "/branches/branch/floors/floor?date=2026-10-07&space=space",
    );
    expect(link.querySelector("img")).toHaveAttribute("alt", "");
    expect(link.querySelector("img")).toHaveAttribute(
      "sizes",
      "(min-width: 768px) 72px, 56px",
    );
    expect(link.querySelector('[data-slot="space-photo"]')).toHaveClass(
      "h-11",
      "w-14",
      "md:h-[54px]",
      "md:w-[72px]",
    );
    const restricted = screen.getByText("전용 공간").closest("li");
    expect(restricted?.querySelector("img, a, button")).toBeNull();
    expect(
      restricted?.querySelector('[data-slot="photo-placeholder"]'),
    ).toHaveClass("bg-status-maintenance-hatch");
  });

  it("places a responsive 160px gallery above the detail and keeps its named close action", () => {
    const data = spaceDayFixture();
    data.photos = [photo];
    render(<SpaceDetail data={data} />);
    expect(screen.getByRole("group", { name: "회의실 C 사진" })).toHaveClass(
      "h-[160px]",
      "[@media(max-height:759px)]:h-[120px]",
    );
    expect(screen.getByRole("img", { name: photo.alt })).toHaveAttribute(
      "loading",
      "eager",
    );
    expect(
      screen.getByRole("link", { name: "공간 상세 닫기" }),
    ).toHaveAttribute("href", "/branches/branch/floors/floor?date=2026-10-07");
    expect(screen.getByRole("link", { name: "공간 상세 닫기" })).toHaveClass(
      "absolute",
      "top-2",
      "right-2",
    );
    expect(screen.getByText("기존 예약 양식")).toBeVisible();
  });

  it("uses the branch cover on the card and navigation button without duplicating their names", () => {
    const data = floorDayFixture();
    data.branch.cover = photo;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <BranchList
          branches={[
            {
              ...data.branch,
              isDefault: false,
              todayHours: data.openHours,
              accessibleFloorCount: 1,
              bookableSpaceCount: 2,
              freeSpaceCount: 1,
              operatingState: data.operatingState,
            },
          ]}
        />
        <BranchNavigation
          data={{
            branch: data.branch,
            floors: data.floors,
            branches: [],
            today: data.date,
            bookingDates: [],
            now: data.now,
          }}
        />
      </QueryClientProvider>,
    );
    const branch = screen.getByRole("button", {
      name: "가상 지점 · 지점 바꾸기",
    });
    expect(branch.querySelector("img")).toHaveAttribute("alt", "");
    expect(branch.querySelector("img")).toHaveAttribute("sizes", "32px");
    const card = screen.getByRole("link", { name: "가상 지점" });
    expect(card.closest("article")?.querySelector("img")).toHaveAttribute(
      "alt",
      photo.alt,
    );
    expect(card.querySelector("button")).toBeNull();
  });

  it("adds representative photos to upcoming home and personal booking rows", () => {
    const booking = bookingFixture();
    const data = { now: "2026-10-07T01:10:00Z", upcoming: [booking], past: [] };
    render(
      <QueryClientProvider client={new QueryClient()}>
        <HomeUpcomingBookings
          data={{ now: data.now, bookings: [{ ...booking, canCancel: true }] }}
        />
        <MyBookings data={data} />
      </QueryClientProvider>,
    );
    const upcoming = screen.getByRole("region", { name: "다음 예약" });
    expect(upcoming.querySelector("img")).toHaveAttribute("alt", "");
    expect(upcoming.querySelector("img")).toHaveAttribute("loading", "eager");
    expect(
      within(upcoming).getByRole("link", { name: "일정 보기" }),
    ).toHaveAttribute(
      "href",
      "/branches/branch/floors/floor?date=2026-10-07&space=space",
    );
    const history = screen.getByRole("main");
    expect(history.querySelector("img")).toHaveAttribute("alt", "");
    expect(history.querySelector("img")).toHaveAttribute("loading", "lazy");
    expect(
      within(history).getByRole("link", { name: "회의실 C" }),
    ).toHaveAttribute(
      "href",
      "/branches/branch/floors/floor?date=2026-10-07&space=space",
    );
  });

  it("adds a photo to a free-space row while preserving availability and branch information", () => {
    const data = floorDayFixture();
    render(
      <HomeFreeSpaces
        data={{
          state: "ready",
          branch: data.branch,
          now: data.now,
          date: data.date,
          operatingState: data.operatingState,
          totalCount: 1,
          freeCount: 1,
          spaces: [
            {
              id: "space",
              name: "회의실 C",
              type: "meeting_room",
              capacity: 6,
              amenities: [],
              floor: data.floor,
              intervals: [],
              freeUntil: "2026-10-07T03:00:00Z",
              photo,
            },
          ],
        }}
      />,
    );
    const row = screen.getByRole("link", { name: /회의실 C/ });
    expect(row.querySelector("img")).toHaveAttribute("alt", "");
    expect(row).toHaveTextContent("12:00까지 비어 있음");
    expect(
      within(row).getByRole("img", { name: "예약된 시간이 없어요" }),
    ).toBeVisible();
  });

  it.each([
    ["floor list", FloorSpaceListSkeleton, 4],
    ["detail", SpaceDetailSkeleton, 1],
    ["branch cards", BranchListSkeleton, 2],
    ["personal bookings", MyBookingsSkeleton, 3],
  ] as const)(
    "reserves photo geometry in %s loading",
    (_, Component, count) => {
      const { container } = render(<Component />);
      expect(
        container.querySelectorAll('[data-slot="skeleton-photo"]'),
      ).toHaveLength(count);
      expect(screen.getAllByRole("status")).toHaveLength(1);
    },
  );

  it("uses photo skeletons only for home cards that will contain images", () => {
    const view = render(<HomeCardSkeleton rows={4} photo />);
    expect(
      view.container.querySelectorAll('[data-slot="skeleton-photo"]'),
    ).toHaveLength(4);
    view.rerender(<HomeCardSkeleton rows={1} />);
    expect(
      view.container.querySelector('[data-slot="skeleton-photo"]'),
    ).toBeNull();
  });
});
