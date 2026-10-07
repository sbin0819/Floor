import { fireEvent, render, screen, within } from "@testing-library/react";
import Link from "next/link";
import { describe, expect, it, vi } from "vitest";
import { SegmentedLink, SegmentedLinks } from "@/components/segmented-links";
import { StatusLine, type StatusLineKind } from "@/components/status-line";
import { BookingChip, type BookingChipKind } from "@/components/booking-chip";
import { SectionLabel } from "@/components/section-label";
import { Card, CardTitle } from "@/components/ui/card";

describe("second-round UI primitives", () => {
  it("keeps segmented choices ordinary links with one current item", () => {
    render(
      <SegmentedLinks label="층 선택">
        <SegmentedLink href="/six" selected={false}>
          6F
        </SegmentedLink>
        <SegmentedLink href="/seven" selected>
          7F
        </SegmentedLink>
      </SegmentedLinks>,
    );
    const nav = screen.getByRole("navigation", { name: "층 선택" });
    expect(nav).toHaveClass("bg-muted");
    expect(within(nav).getAllByRole("link")).toHaveLength(2);
    const selected = within(nav).getByRole("link", { current: "page" });
    expect(selected).toHaveAttribute("href", "/seven");
    expect(selected).toHaveClass("bg-card", "shadow-card", "min-h-11");
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("composes a Next link without replacing its navigation callback", () => {
    const navigate = vi.fn((event: React.MouseEvent<HTMLAnchorElement>) =>
      event.preventDefault(),
    );
    render(
      <SegmentedLinks label="보기 선택">
        <SegmentedLink asChild selected>
          <Link href="/bookings" onClick={navigate}>
            내 예약
          </Link>
        </SegmentedLink>
      </SegmentedLinks>,
    );
    fireEvent.click(screen.getByRole("link", { name: "내 예약" }));
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it.each([
    ["free", "bg-status-free-strong", "text-status-free-foreground"],
    ["busy", "bg-booked-strong", "text-secondary-foreground"],
    ["mine", "bg-primary", "text-accent-foreground"],
    ["maintenance", "bg-input", "text-muted-foreground"],
  ] satisfies [StatusLineKind, string, string][])(
    "uses a decorative dot and semantic text for %s",
    (kind, dot, text) => {
      const { container } = render(
        <StatusLine kind={kind}>뜻을 전하는 글자</StatusLine>,
      );
      expect(screen.getByText("뜻을 전하는 글자")).toBeVisible();
      expect(container.firstElementChild).toHaveClass(text);
      expect(
        container.querySelector('[data-slot="status-dot"]'),
      ).toHaveAttribute("aria-hidden", "true");
      expect(container.querySelector('[data-slot="status-dot"]')).toHaveClass(
        dot,
      );
    },
  );

  it("renders no dot for an uncolored status", () => {
    const { container } = render(
      <StatusLine kind="none">08:00에 열어요</StatusLine>,
    );
    expect(screen.getByText("08:00에 열어요")).toBeVisible();
    expect(container.querySelector('[data-slot="status-dot"]')).toBeNull();
  });

  it.each([
    ["upcoming", "bg-accent", "text-accent-foreground"],
    ["ongoing", "bg-primary", "text-primary-foreground"],
    ["past", "bg-muted", "text-muted-foreground"],
  ] satisfies [BookingChipKind, string, string][])(
    "keeps %s booking text readable and truncatable",
    (kind, background, color) => {
      render(<BookingChip kind={kind}>15:00 회의실 C</BookingChip>);
      expect(screen.getByText("15:00 회의실 C")).toHaveClass(
        background,
        color,
        "truncate",
        "tabular-nums",
        "rounded-md",
      );
    },
  );

  it("provides a semantic section label and a token-based card", () => {
    render(
      <>
        <SectionLabel as="h2">이번 주</SectionLabel>
        <Card>
          <CardTitle>내 예약</CardTitle>
        </Card>
      </>,
    );
    expect(screen.getByRole("heading", { name: "이번 주" })).toHaveClass(
      "text-xs",
      "font-semibold",
      "text-muted-foreground",
    );
    expect(screen.getByText("내 예약")).toHaveClass(
      "text-[15px]",
      "font-semibold",
    );
    expect(screen.getByText("내 예약").parentElement).toHaveClass(
      "rounded-xl",
      "border",
      "shadow-card",
    );
  });
});
