import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { expect, it } from "vitest";
import { BranchListSkeleton } from "@/features/bookings/components/booking-skeletons";

it("matches the branch cards' 1040px width, desktop columns, photo, three figures and seven weekdays", () => {
  const html = renderToString(<BranchListSkeleton />);
  expect(html).toContain("max-w-[1040px]");
  expect(html).toContain("lg:grid-cols-2");
  const { container } = render(<BranchListSkeleton />);
  expect(container.firstElementChild).toHaveClass("max-w-[1040px]");
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(container.querySelectorAll('[aria-busy="true"]')).toHaveLength(1);
  const cards = container.querySelectorAll(
    '[data-slot="skeleton-branch-card"]',
  );
  expect(cards).toHaveLength(2);
  expect(cards[0]?.parentElement).toHaveClass(
    "grid",
    "gap-5",
    "lg:grid-cols-2",
  );
  for (const card of cards) {
    expect(
      card.querySelector('[data-slot="skeleton-photo"]')?.parentElement,
    ).toHaveClass("aspect-[16/6]");
    expect(
      card.querySelector('[data-slot="skeleton-branch-counts"]')?.children,
    ).toHaveLength(3);
    expect(
      card.querySelector('[data-slot="skeleton-branch-hours"]')?.children,
    ).toHaveLength(7);
    expect(card.lastElementChild).toHaveClass("min-h-[76px]");
  }
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
