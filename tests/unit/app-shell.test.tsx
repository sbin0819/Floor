import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Link from "next/link";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShellFrame } from "@/components/app-shell-frame";
import { AccountMenu } from "@/components/account-menu";
import { CloseOnRouteChange } from "@/components/member-shell-route";
import { TooltipProvider } from "@/components/ui/tooltip";

const mocks = vi.hoisted(() => ({ pathname: "/", search: "", push: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useSearchParams: () => new URLSearchParams(mocks.search),
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock("@/lib/auth/client", () => ({ authClient: { signOut: vi.fn() } }));
vi.mock("@/lib/auth/redirect-after-sign-out", () => ({
  redirectAfterSignOut: vi.fn(),
}));

const media = {
  matches: false,
  media: "(min-width: 1280px)",
  onchange: null,
  addEventListener: vi.fn<(type: string, listener: () => void) => void>(),
  removeEventListener: vi.fn<(type: string, listener: () => void) => void>(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
  dispatchEvent: vi.fn(),
};
const matchMedia = vi.fn<(query: string) => typeof media>(() => media);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pathname = "/";
  mocks.search = "";
  media.matches = false;
  vi.stubGlobal("matchMedia", matchMedia);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

function frame({ anonymous = false, realAccount = false } = {}) {
  return (
    <TooltipProvider delayDuration={0}>
      <AppShellFrame
        menu={
          <nav aria-label="회원 메뉴">
            <Link href="/" aria-current="page">
              홈
            </Link>
            <Link
              href="/bookings"
              onClick={(event) => {
                event.preventDefault();
                mocks.push("/bookings");
              }}
            >
              내 예약
            </Link>
          </nav>
        }
        accountCard={
          anonymous ? null : realAccount ? (
            <AccountMenu
              name="가상 회원"
              email="member@example.test"
              isOperator
              variant="card"
            />
          ) : (
            <button>가상 회원 내 카드</button>
          )
        }
        accountAvatar={anonymous ? null : <button>가상 회원 아바타</button>}
        notifications={
          anonymous ? null : <button data-testid="bell">알림</button>
        }
      >
        <main>기존 페이지 내용</main>
      </AppShellFrame>
    </TooltipProvider>
  );
}

async function openDrawer() {
  const user = userEvent.setup();
  const trigger = screen.getByRole("button", { name: "메뉴 열기" });
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  await user.click(trigger);
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  const dialog = screen.getByRole("dialog", { name: "메뉴" });
  return { user, trigger, dialog };
}

async function expectClosed(trigger: HTMLElement) {
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "메뉴" }),
    ).not.toBeInTheDocument(),
  );
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(document.querySelector('[data-slot="drawer-sidebar"]')).toBeNull();
  expect(document.querySelector('[data-slot="drawer-rail"]')).toBeNull();
}

describe("member app shell frame", () => {
  it("keeps one rail, sidebar, top line and bell with distinct region and page selection", () => {
    const { container } = render(frame());
    const shell = container.querySelector('[data-slot="app-shell"]')!;
    const rail = shell.querySelector('[data-slot="app-rail"]')!;
    expect(shell.querySelectorAll('[data-slot="app-rail"]')).toHaveLength(1);
    expect(shell.querySelectorAll('[data-slot="app-sidebar"]')).toHaveLength(1);
    expect(shell.querySelectorAll("header")).toHaveLength(1);
    const floor = within(rail as HTMLElement).getByRole("link", {
      name: "Floor 홈",
    });
    expect(floor).toHaveAttribute("href", "/");
    expect(floor).toHaveAttribute("aria-current", "true");
    expect(floor).toHaveClass("size-11", "bg-primary");
    expect(floor.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(rail.querySelector(".w-1")).toHaveClass(
      "left-0",
      "bg-foreground",
      "h-7",
    );
    expect(shell.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(
      within(
        screen.getByRole("navigation", { name: "회원 메뉴" }),
      ).getAllByRole("link", { current: "page" }),
    ).toHaveLength(1);
    expect(screen.getAllByTestId("bell")).toHaveLength(1);
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.querySelector('[data-slot="drawer-sidebar"]')).toBeNull();
  });

  it("uses CSS breakpoints with sticky navigation while preserving document scrolling", () => {
    const { container } = render(frame());
    const shell = container.querySelector('[data-slot="app-shell"]')!;
    expect(shell).toHaveClass(
      "grid-cols-1",
      "md:grid-cols-[72px_minmax(0,1fr)]",
      "xl:grid-cols-[72px_248px_minmax(0,1fr)]",
    );
    const rail = container.querySelector('[data-slot="app-rail"]')!;
    const sidebar = container.querySelector('[data-slot="app-sidebar"]')!;
    expect(rail).toHaveClass(
      "hidden",
      "md:flex",
      "sticky",
      "top-0",
      "h-dvh",
      "overflow-y-auto",
      "bg-rail",
    );
    expect(sidebar).toHaveClass(
      "hidden",
      "xl:flex",
      "sticky",
      "top-0",
      "h-dvh",
      "bg-sidebar",
    );
    expect(
      screen.getByRole("navigation", { name: "회원 메뉴" }).parentElement,
    ).toHaveClass("min-h-0", "flex-1", "overflow-y-auto");
    expect(
      screen.getByRole("button", { name: "가상 회원 아바타" }).parentElement,
    ).toHaveClass("xl:hidden");
    expect(screen.getByRole("button", { name: "메뉴 열기" })).toHaveClass(
      "size-11",
      "xl:hidden",
    );
    const header = screen.getByRole("banner");
    expect(header).toHaveClass(
      "sticky",
      "top-0",
      "z-[45]",
      "h-14",
      "bg-card",
      "border-b",
    );
    expect(header).not.toHaveClass("fixed");
    const content = container.querySelector("#content")!;
    for (const element of [shell, content, content.parentElement!]) {
      expect(element).not.toHaveClass(
        "h-dvh",
        "overflow-y-auto",
        "overflow-auto",
        "overflow-hidden",
      );
    }
    expect(matchMedia).toHaveBeenCalledExactlyOnceWith("(min-width: 1280px)");
  });

  it("starts with an accessible skip link targeting the focusable content wrapper", () => {
    const { container } = render(frame());
    const link = screen.getByRole("link", { name: "본문으로 건너뛰기" });
    expect(container.firstElementChild).toBe(link);
    expect(link).toHaveAttribute("href", "#content");
    expect(link).toHaveClass("sr-only", "focus:not-sr-only");
    const content = container.querySelector("#content")!;
    expect(content.tagName).toBe("DIV");
    expect(content).toHaveAttribute("tabindex", "-1");
    expect(content).toHaveClass("scroll-mt-14");
    expect(content).toContainElement(screen.getByRole("main"));
  });

  it.each(["pointer", "keyboard"] as const)(
    "shows a home tooltip for %s users",
    async (input) => {
      const user = userEvent.setup();
      render(frame());
      const floor = screen.getByRole("link", { name: "Floor 홈" });
      if (input === "pointer") await user.hover(floor);
      else act(() => floor.focus());
      expect(await screen.findByRole("tooltip", { name: "홈" })).toBeVisible();
    },
  );

  it("mounts only rail, menu and account card inside the drawer, never another bell or avatar", async () => {
    render(frame());
    const { dialog } = await openDrawer();
    expect(dialog).toHaveAttribute("data-side", "left");
    expect(dialog).not.toHaveAttribute("aria-describedby");
    expect(dialog).toHaveClass(
      "flex-row",
      "gap-0",
      "p-0",
      "bg-sidebar",
      "data-[side=left]:w-80",
      "data-[side=left]:sm:max-w-none",
    );
    expect(within(dialog).getByRole("heading", { name: "메뉴" })).toHaveClass(
      "sr-only",
    );
    expect(
      within(dialog).getByRole("navigation", { name: "회원 메뉴" }),
    ).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: "가상 회원 내 카드" }),
    ).toBeVisible();
    expect(
      within(dialog).queryByRole("button", { name: "가상 회원 아바타" }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "알림" }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "공간 상세 시트 닫기" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByTestId("bell")).toHaveLength(1);
    expect(
      within(dialog).getByRole("link", { name: "Floor 홈" }),
    ).toHaveAttribute("aria-current", "true");
  });

  it("closes and restores trigger focus when an optimistic menu link prevents the default action", async () => {
    const { rerender } = render(frame());
    const { user, dialog, trigger } = await openDrawer();
    await user.click(within(dialog).getByRole("link", { name: "내 예약" }));
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith("/bookings");
    await expectClosed(trigger);
    mocks.pathname = "/bookings";
    rerender(frame());
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes for rail and brand navigation links as well as menu links", async () => {
    render(frame());
    const { dialog, trigger } = await openDrawer();
    fireEvent.click(within(dialog).getByRole("link", { name: "Floor 홈" }));
    await expectClosed(trigger);
    await userEvent.click(trigger);
    const reopened = screen.getByRole("dialog", { name: "메뉴" });
    fireEvent.click(within(reopened).getByRole("link", { name: "Floor" }));
    await expectClosed(trigger);
  });

  it("closes from the portalled account operator link and returns focus to the drawer trigger", async () => {
    render(frame({ realAccount: true }));
    const { user, dialog, trigger } = await openDrawer();
    await user.click(
      within(dialog).getByRole("button", { name: "가상 회원님 사용자 메뉴" }),
    );
    const operator = screen.getByRole("menuitem", { name: "운영자 화면" });
    expect(operator).toHaveAttribute("href", "/admin");
    expect(dialog).not.toContainElement(operator);
    operator.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(operator);
    await expectClosed(trigger);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it.each(["close-button", "escape", "outside"] as const)(
    "closes via %s and restores trigger focus",
    async (method) => {
      render(frame());
      const { user, dialog, trigger } = await openDrawer();
      if (method === "close-button") {
        const close = within(dialog).getByRole("button", { name: "메뉴 닫기" });
        expect(close).toHaveClass("size-11");
        await user.click(close);
      } else if (method === "escape") await user.keyboard("{Escape}");
      else {
        const overlay = document.querySelector('[data-slot="sheet-overlay"]')!;
        await user.click(overlay);
      }
      await expectClosed(trigger);
    },
  );

  it("keeps the first route mounted and closes only when the pathname actually changes", async () => {
    const { rerender } = render(frame());
    const { trigger, dialog } = await openDrawer();
    rerender(frame());
    expect(screen.getByRole("dialog", { name: "메뉴" })).toBe(dialog);
    mocks.pathname = "/bookings/reservation/edit";
    rerender(frame());
    await expectClosed(trigger);
    expect(within(screen.getByRole("banner")).getByText("내 예약")).toHaveClass(
      "text-base",
      "font-semibold",
    );
  });

  it("closes at the sidebar breakpoint but not on narrower resize events", async () => {
    const { unmount } = render(frame());
    const { trigger, dialog } = await openDrawer();
    const callback = media.addEventListener.mock.calls[0]?.[1];
    expect(callback).toBeDefined();
    act(() => callback?.());
    expect(screen.getByRole("dialog", { name: "메뉴" })).toBe(dialog);
    act(() => {
      media.matches = true;
      callback?.();
    });
    await expectClosed(trigger);
    unmount();
    expect(media.removeEventListener).toHaveBeenCalledExactlyOnceWith(
      "change",
      callback,
    );
  });

  it("closes on query-only back and forward navigation", async () => {
    mocks.pathname = "/bookings";
    mocks.search = "month=2026-10";
    const { rerender } = render(frame());
    const { trigger } = await openDrawer();
    mocks.search = "month=2026-11";
    rerender(frame());
    await expectClosed(trigger);
    await userEvent.click(trigger);
    mocks.search = "month=2026-10";
    rerender(frame());
    await expectClosed(trigger);
  });

  it.each([
    ["/", "홈"],
    ["/branches/a/floors/b", "공간 예약"],
    ["/bookings/x/edit", "내 예약"],
    ["/teams/start", "팀 관리"],
    ["/notifications", "알림"],
    ["/notifications/x", "알림"],
    ["/notificationsx", null],
  ] as const)(
    "shows the auxiliary section name at %s without adding a page heading",
    (pathname, label) => {
      mocks.pathname = pathname;
      render(frame());
      const header = screen.getByRole("banner");
      expect(within(header).queryByRole("heading")).not.toBeInTheDocument();
      if (label)
        expect(
          within(header).getByText(label, { selector: "span" }),
        ).toBeVisible();
      else expect(header.querySelector("span.text-base")).toBeEmptyDOMElement();
    },
  );

  it("keeps the static navigation and body when all session-based slots are empty", () => {
    render(frame({ anonymous: true }));
    expect(screen.getByRole("link", { name: "Floor 홈" })).toBeVisible();
    expect(screen.getByRole("navigation", { name: "회원 메뉴" })).toBeVisible();
    expect(screen.getByRole("main")).toHaveTextContent("기존 페이지 내용");
    expect(screen.queryByText("가상 회원 내 카드")).not.toBeInTheDocument();
    expect(screen.queryByText("가상 회원 아바타")).not.toBeInTheDocument();
    expect(screen.queryByTestId("bell")).not.toBeInTheDocument();
  });
});

describe("shell route observer", () => {
  it("does not call close on mount or unchanged routes", () => {
    const onChange = vi.fn();
    const { rerender } = render(<CloseOnRouteChange onChange={onChange} />);
    expect(onChange).not.toHaveBeenCalled();
    rerender(<CloseOnRouteChange onChange={onChange} />);
    expect(onChange).not.toHaveBeenCalled();
    mocks.pathname = "/teams";
    rerender(<CloseOnRouteChange onChange={onChange} />);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
