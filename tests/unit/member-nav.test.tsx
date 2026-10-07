import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemberNav } from "@/components/member-nav";
import { MobileNav } from "@/components/mobile-nav";
import { activeMemberNav } from "@/components/member-navigation";

const mocks = vi.hoisted(() => ({ pathname: "/", pending: false }));
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => router,
}));
vi.mock("next/link", async (importOriginal) => {
  const original = await importOriginal<typeof import("next/link")>();
  return { ...original, useLinkStatus: () => ({ pending: mocks.pending }) };
});

beforeEach(() => {
  mocks.pathname = "/";
  mocks.pending = false;
});

describe("member navigation", () => {
  it("selects the clicked menu before server navigation finishes and returns to the current route", async () => {
    let finish: () => void = () => {};
    const response = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const navigateAction = vi.fn(() => response);
    render(<MemberNav navigateAction={navigateAction} />);
    fireEvent.click(screen.getByRole("link", { name: "내 예약" }));
    expect(screen.getByRole("link", { current: "page" })).toHaveTextContent(
      "내 예약",
    );
    expect(navigateAction).toHaveBeenCalledWith("/bookings", {});
    await act(async () => {
      finish();
      await response;
    });
    expect(screen.getByRole("link", { current: "page" })).toHaveTextContent(
      "홈",
    );
  });

  it("does not intercept a modified menu link", () => {
    const navigateAction = vi.fn();
    render(<MemberNav navigateAction={navigateAction} />);
    fireEvent.click(screen.getByRole("link", { name: "내 예약" }), {
      metaKey: true,
    });
    expect(navigateAction).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { current: "page" })).toHaveTextContent(
      "홈",
    );
  });

  it.each([
    ["/", "홈"],
    ["/branches", "공간 예약"],
    ["/branches/a/floors/b", "공간 예약"],
    ["/booking", "공간 예약"],
    ["/booking/entry", "공간 예약"],
    ["/bookings", "내 예약"],
    ["/bookings/past", "내 예약"],
    ["/teams", "팀"],
    ["/teams/start", "팀"],
    ["/teams/team-a", "팀"],
    ["/invite/private-token", "팀"],
  ])("selects exactly one item at %s", (pathname, label) => {
    mocks.pathname = pathname;
    render(<MemberNav />);
    expect(screen.getByRole("link", { current: "page" })).toHaveTextContent(
      label,
    );
    expect(screen.getAllByRole("link")).toHaveLength(4);
    expect(screen.getByRole("link", { name: "공간 예약" })).toHaveAttribute(
      "href",
      "/booking",
    );
    expect(screen.getByRole("link", { name: "팀" })).toHaveAttribute(
      "href",
      "/teams",
    );
  });

  it.each([
    "/bookings-extra",
    "/branchestest",
    "/teamster",
    "/invited",
    "/admin",
  ])("does not match another route segment at %s", (pathname) => {
    expect(activeMemberNav(pathname)).toBeNull();
  });

  it("keeps ordinary anchors and keyboard focus styling on all items", () => {
    render(<MemberNav />);
    for (const link of screen.getAllByRole("link")) {
      expect(link.tagName).toBe("A");
      expect(link).toHaveClass("min-h-11", "focus-visible:outline-2");
    }
    expect(screen.getByRole("navigation")).toHaveClass("hidden", "md:flex");
  });

  it("uses the same selection in a 64px safe-area-aware mobile bar", () => {
    mocks.pathname = "/invite/token";
    const { container } = render(<MobileNav />);
    const navigation = screen.getByRole("navigation", {
      name: "하단 회원 메뉴",
    });
    expect(navigation).toHaveClass("h-16", "grid-cols-4");
    expect(screen.getByRole("link", { current: "page" })).toHaveTextContent(
      "팀",
    );
    expect(container.firstElementChild).toHaveClass(
      "fixed",
      "md:hidden",
      "pb-[env(safe-area-inset-bottom)]",
    );
  });

  it("shows a pending hint without changing the destination or dimensions", () => {
    mocks.pending = true;
    const { container } = render(<MemberNav />);
    expect(container.querySelectorAll('[data-pending="true"]')).toHaveLength(4);
    for (const hint of container.querySelectorAll('[data-pending="true"]'))
      expect(hint).toHaveClass("absolute", "inset-0", "opacity-100");
    expect(screen.getByRole("link", { name: "공간 예약" })).toHaveAttribute(
      "href",
      "/booking",
    );
  });
});
