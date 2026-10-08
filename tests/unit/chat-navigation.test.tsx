import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChatRailNavigation,
  ChatSidebarNavigation,
  ChatSidebarTitle,
} from "@/components/chat-navigation";
import { ChatRailPlaceholder } from "@/components/chat-shell-navigation";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  MessagesList,
  MessagesShell,
  MessagesSkeleton,
} from "@/features/chat/components/messages-list";
import type { ChatSpaceNav } from "@/features/chat/types";

const mocks = vi.hoisted(() => ({
  pathname: "/",
  push: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => mocks,
}));
vi.mock("next/link", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/link")>()),
  useLinkStatus: () => ({ pending: false }),
}));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/features/chat/queries", () => ({ getMyChatNav: vi.fn() }));

const spaces: ChatSpaceNav[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    kind: "team",
    name: "디자인팀",
    initial: "디",
    unread: false,
    channels: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        name: "일반",
        unread: false,
      },
      {
        id: "33333333-3333-4333-8333-333333333333",
        name: "자료",
        unread: false,
      },
    ],
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    kind: "team",
    name: "그로스팀",
    initial: "그",
    unread: false,
    channels: [],
  },
];
const space = spaces[0]!;
const room = space.channels[0]!;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.pathname = "/";
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function rail() {
  return (
    <TooltipProvider delayDuration={0}>
      <ChatRailNavigation spaces={spaces} />
    </TooltipProvider>
  );
}

describe("team chat navigation", () => {
  it("shows only supplied spaces as 44px links and reserves page selection for channels", () => {
    render(rail());
    expect(screen.getAllByRole("link")).toHaveLength(3);
    const team = screen.getByRole("link", { name: "디자인팀" });
    expect(team).toHaveAttribute("href", `/s/${space.id}`);
    expect(team).toHaveTextContent("디");
    expect(team).toHaveClass(
      "size-11",
      "rounded-xl",
      "focus-visible:outline-2",
    );
    expect(team).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Floor 홈" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(
      screen.queryByRole("link", { current: "page" }),
    ).not.toBeInTheDocument();
  });

  it("switches the rail highlight away from Floor for the selected space", () => {
    mocks.pathname = `/s/${space.id}/${room.id}`;
    const { container } = render(rail());
    expect(screen.getByRole("link", { name: "Floor 홈" })).not.toHaveAttribute(
      "aria-current",
    );
    expect(screen.getByRole("link", { name: "디자인팀" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(container.querySelectorAll(".w-1")).toHaveLength(1);
  });

  it("preserves modified links and immediately reflects a normal rail click", async () => {
    let finish!: () => void;
    mocks.push.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(rail());
    const team = screen.getByRole("link", { name: "디자인팀" });
    fireEvent.click(team, { metaKey: true });
    expect(mocks.push).not.toHaveBeenCalled();
    fireEvent.click(team);
    expect(mocks.push).toHaveBeenCalledWith(`/s/${space.id}`);
    expect(team).toHaveAttribute("aria-current", "true");
    await act(async () => {
      finish();
    });
  });

  it("provides the team name tooltip on keyboard focus", async () => {
    const user = userEvent.setup();
    render(rail());
    await user.tab();
    await user.tab();
    expect(
      await screen.findByRole("tooltip", { name: "디자인팀" }),
    ).toBeVisible();
  });

  it("uses the contextual title and channels without showing unrelated channels", () => {
    mocks.pathname = `/s/${space.id}/${room.id}`;
    render(
      <>
        <ChatSidebarTitle spaces={spaces} />
        <ChatSidebarNavigation spaces={spaces} />
      </>,
    );
    expect(screen.getByRole("link", { name: "디자인팀" })).toHaveAttribute(
      "href",
      `/s/${space.id}`,
    );
    const nav = screen.getByRole("navigation", {
      name: "디자인팀 텍스트 채널",
    });
    expect(within(nav).getAllByRole("link")).toHaveLength(2);
    expect(
      within(nav).getByRole("link", { current: "page" }),
    ).toHaveTextContent("일반");
    expect(screen.queryByText("그로스팀")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("navigation", { name: "회원 메뉴" }),
    ).not.toBeInTheDocument();
  });

  it("immediately selects a new channel while preserving modifier-key navigation", async () => {
    mocks.pathname = `/s/${space.id}/${room.id}`;
    let finish!: () => void;
    mocks.push.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(<ChatSidebarNavigation spaces={spaces} />);
    const next = screen.getByRole("link", { name: "자료" });
    fireEvent.click(next, { ctrlKey: true });
    expect(mocks.push).not.toHaveBeenCalled();
    fireEvent.click(next);
    expect(next).toHaveAttribute("aria-current", "page");
    expect(mocks.push).toHaveBeenCalledWith(
      `/s/${space.id}/${space.channels[1]!.id}`,
    );
    await act(async () => {
      finish();
    });
  });

  it.each(["/teams", "/bookings", "/messages", "/s/not-visible/room"])(
    "keeps home navigation without leaking unknown spaces at %s",
    (pathname) => {
      mocks.pathname = pathname;
      render(
        <>
          <ChatSidebarTitle spaces={spaces} />
          <ChatSidebarNavigation spaces={spaces} />
        </>,
      );
      expect(screen.getByRole("link", { name: "Floor" })).toHaveAttribute(
        "href",
        "/",
      );
      expect(
        screen.getByRole("navigation", { name: "회원 메뉴" }),
      ).toBeVisible();
      expect(screen.getByRole("link", { name: "팀 관리" })).toHaveAttribute(
        "href",
        "/teams",
      );
      expect(screen.queryByText("디자인팀")).not.toBeInTheDocument();
    },
  );

  it("keeps known links visible while the chat list is unresolved, without a false empty state", () => {
    render(
      <>
        <ChatRailPlaceholder />
        <MessagesShell>
          <MessagesSkeleton />
        </MessagesShell>
      </>,
    );
    expect(screen.getByRole("link", { name: "Floor 홈" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "메시지" })).toBeVisible();
    expect(screen.queryByText(/아직 참여한/)).not.toBeInTheDocument();
  });

  it("shows the real empty state with the team management link", () => {
    render(<MessagesList spaces={[]} />);
    expect(
      screen.getByText(
        "아직 참여한 스페이스가 없어요. 팀에 들어가면 팀 스페이스가 생겨요",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "팀 관리로 가기" }),
    ).toHaveAttribute("href", "/teams");
  });

  it("lists each permitted space and its channels as real links", () => {
    render(<MessagesList spaces={spaces} />);
    const section = screen.getByRole("region", { name: "디자인팀" });
    expect(within(section).getByRole("link", { name: "일반" })).toHaveAttribute(
      "href",
      `/s/${space.id}/${room.id}`,
    );
    expect(screen.getByRole("region", { name: "그로스팀" })).toHaveTextContent(
      "아직 열린 채널이 없어요",
    );
  });
});
