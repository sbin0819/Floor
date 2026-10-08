import { render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { describe, expect, it, vi } from "vitest";
import MemberLayout from "@/app/(app)/layout";
import { AppShell } from "@/components/app-shell";
import { MobileNav } from "@/components/mobile-nav";
import { HomeDashboardSkeleton } from "@/features/bookings/components/home-skeletons";

vi.mock("@/components/app-shell", () => ({ AppShell: () => null }));

describe("member layout integration", () => {
  it("keeps page streaming, mobile padding and the unchanged bottom tabs inside the new shell", () => {
    const child = <main>원래 페이지</main>;
    const layout = MemberLayout({ children: child });
    expect(layout.type).toBe(AppShell);
    const [content, mobile] = layout.props.children;
    expect(content.type).toBe("div");
    expect(content.props.className).toBe(
      "pb-[calc(4rem+env(safe-area-inset-bottom))] has-[[data-chat-screen]]:pb-0 md:pb-0",
    );
    expect(content.props.children.type).toBe(Suspense);
    expect(content.props.children.props.children).toBe(child);
    expect(content.props.children.props.fallback.type).toBe(
      HomeDashboardSkeleton,
    );
    expect(mobile.type).toBe(MobileNav);
    render(content.props.children.props.fallback);
    expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
    expect(screen.queryByText("원래 페이지")).not.toBeInTheDocument();
  });
});
