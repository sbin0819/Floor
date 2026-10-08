import { cleanup, render, screen } from "@testing-library/react";
import { isValidElement, Suspense, type SuspenseProps } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AppShell,
  HeaderNotifications,
  ShellRealtimeSession,
} from "@/components/app-shell";
import { AppShellFrame } from "@/components/app-shell-frame";
import {
  RealtimeProvider,
  RealtimeSession,
} from "@/components/realtime-provider";
import {
  ChatRailSlot,
  ChatSidebarSlot,
  ChatSidebarTitleSlot,
} from "@/components/chat-shell-navigation";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NotificationBell } from "@/features/notifications/components/notification-bell";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  account: vi.fn(),
  summary: vi.fn(),
  nav: vi.fn(),
  pathname: vi.fn(() => "/"),
}));
vi.mock("@/lib/auth/session", () => ({ getSession: mocks.session }));
vi.mock("@/features/auth/queries", () => ({
  getAccountMenuData: mocks.account,
}));
vi.mock("@/features/notifications/queries", () => ({
  getNotificationSummary: mocks.summary,
}));
vi.mock("@/features/chat/queries", () => ({ getMyChatNav: mocks.nav }));
vi.mock("@/features/notifications/components/notification-bell", () => ({
  NotificationBell: () => null,
}));
vi.mock("next/navigation", () => ({
  usePathname: mocks.pathname,
  useSearchParams: () => new URLSearchParams(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pathname.mockReturnValue("/");
});

describe("member shell streaming", () => {
  function frame() {
    const shell = AppShell({ children: <main>페이지 내용</main> });
    expect(shell.type).toBe(RealtimeProvider);
    const [session, body] = shell.props.children;
    expect(session.type).toBe(Suspense);
    expect(session.props.fallback).toBeNull();
    expect(session.props.children.type).toBe(ShellRealtimeSession);
    expect(body.type).toBe(AppShellFrame);
    return body;
  }

  it.each([
    "menu",
    "accountCard",
    "accountAvatar",
    "notifications",
    "rail",
    "sidebarTitle",
  ] as const)(
    "renders the %s fallback synchronously without reading session or data",
    (slot) => {
      const shell = frame();
      const boundary = shell.props[slot];
      if (!isValidElement<SuspenseProps>(boundary))
        throw new Error("Missing boundary");
      expect(boundary.type).toBe(Suspense);
      expect(isValidElement(boundary.props.children)).toBe(true);
      const { container } = render(boundary.props.fallback);
      expect(screen.getAllByRole("status")).toHaveLength(1);
      expect(screen.getByRole("status")).toHaveTextContent("불러오고 있어요");
      expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
      expect(mocks.session).not.toHaveBeenCalled();
      expect(mocks.account).not.toHaveBeenCalled();
      expect(mocks.summary).not.toHaveBeenCalled();
      expect(mocks.nav).not.toHaveBeenCalled();
    },
  );

  it("does not read chat navigation or start realtime without a session", async () => {
    mocks.session.mockResolvedValue(null);
    expect(await ShellRealtimeSession()).toBeNull();
    for (const slot of [ChatRailSlot, ChatSidebarSlot, ChatSidebarTitleSlot]) {
      expect((await slot()).props.data).toEqual({
        spaces: [],
        directMessages: [],
        myStatus: "online",
        blockedUserIds: [],
      });
    }
    expect(mocks.nav).not.toHaveBeenCalled();
  });

  it("passes only the authenticated user id to the realtime session leaf", async () => {
    mocks.session.mockResolvedValue({
      userId: "member",
      name: "가상 회원",
      email: "private@example.test",
    });
    const session = await ShellRealtimeSession();
    expect(session?.type).toBe(RealtimeSession);
    expect(session?.props).toEqual({ userId: "member" });
    expect(mocks.nav).not.toHaveBeenCalled();
  });

  it("keeps the document shell and page rendered while route leaves suspend", () => {
    const pending = new Promise<never>(() => {});
    mocks.pathname.mockImplementation(() => {
      throw pending;
    });
    const html = renderToString(
      <TooltipProvider>
        <AppShellFrame
          menu={<div>메뉴 자리</div>}
          accountCard={null}
          accountAvatar={null}
          notifications={<span>알림 자리</span>}
        >
          <main>서버 페이지 내용</main>
        </AppShellFrame>
      </TooltipProvider>,
    );
    expect(html).toContain("서버 페이지 내용");
    expect(html).toContain('data-slot="app-rail"');
    expect(html).toContain('data-slot="app-sidebar"');
    expect(html).toContain("알림 자리");
    expect(html).toContain('id="content"');
    expect(html).not.toContain('role="dialog"');
    expect(mocks.pathname).toHaveBeenCalled();
  });

  it("does not query notifications or mount the polling bell without a session", async () => {
    mocks.session.mockResolvedValue(null);
    expect(await HeaderNotifications()).toBeNull();
    expect(mocks.summary).not.toHaveBeenCalled();
  });

  it("passes the authenticated summary to one unchanged bell", async () => {
    mocks.session.mockResolvedValue({
      userId: "member",
      name: "가상 회원",
      email: "member@example.test",
    });
    const summary = {
      now: "2026-10-08T05:55:00Z",
      nextAt: null,
      unreadCount: 0,
      items: [],
    };
    mocks.summary.mockResolvedValue(summary);
    const bell = await HeaderNotifications();
    expect(bell?.type).toBe(NotificationBell);
    expect(bell?.props.initialData).toBe(summary);
    expect(mocks.summary).toHaveBeenCalledOnce();
  });

  it("reserves five 44px menu rows and matching account/bell dimensions", () => {
    const shell = frame();
    for (const [slot, expectedClass] of [
      ["accountCard", "h-14"],
      ["accountAvatar", "size-11"],
      ["notifications", "size-11"],
    ] as const) {
      const { container } = render(shell.props[slot].props.fallback);
      expect(container.firstElementChild).toHaveClass(expectedClass);
      cleanup();
    }
    const { container } = render(shell.props.menu.props.fallback);
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(5);
    for (const row of container.querySelectorAll('[aria-hidden="true"]'))
      expect(row).toHaveClass("h-11");
  });
});
