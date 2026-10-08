import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { HomeDashboardSkeleton } from "@/features/bookings/components/home-skeletons";
import {
  HomeNextBookingSkeleton,
  HomeWeekBookingsSkeleton,
  HomeFrequentSpacesSkeleton,
  HomeFreeSpacesSkeleton,
} from "@/features/bookings/components/home-card-skeletons";

it("matches the three dashboard rows without the removed team card or nested loading announcements", () => {
  const { container } = render(<HomeDashboardSkeleton />);
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(container.querySelectorAll("[data-home-row]")).toHaveLength(3);
  expect(
    screen.queryByRole("heading", { name: "내 팀" }),
  ).not.toBeInTheDocument();
  for (const slot of [
    "home-next-shape",
    "home-free-shape",
    "home-frequent-shape",
    "home-week-shape",
  ])
    expect(container.querySelector(`[data-slot="${slot}"]`)).not.toBeNull();
  expect(
    container.querySelectorAll('[data-slot="skeleton-week-day"]'),
  ).toHaveLength(7);
  expect(
    container.querySelector(
      '[data-slot="home-next-shape"] [data-slot="skeleton-photo"]',
    ),
  ).toHaveClass("w-full", "h-[150px]", "md:w-[232px]");
  expect(
    container.querySelector('[data-slot="home-frequent-shape"] .grid'),
  ).toHaveClass("sm:grid-cols-3");
});
it.each([
  [HomeNextBookingSkeleton, 1],
  [HomeFrequentSpacesSkeleton, 3],
  [HomeFreeSpacesSkeleton, 4],
  [HomeWeekBookingsSkeleton, 0],
] as const)(
  "reserves each card's photo geometry with one live status",
  (Component, photos) => {
    const { container } = render(<Component />);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(
      container.querySelectorAll('[data-slot="skeleton-photo"]'),
    ).toHaveLength(photos);
  },
);
