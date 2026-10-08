import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ChatSidebarNavigation } from "@/components/chat-navigation";
import { CallIndicator } from "@/features/calls/components/call-indicator";
import { callNavigationTargets } from "@/features/calls/nav-targets";
import { DirectMessageList } from "@/features/chat/components/direct-message-list";
import { MeetingList } from "@/features/chat/components/meeting-list";
import {
  filterQuickSwitchItems,
  quickSwitchItems,
} from "@/features/chat/quick-switch";
import type { ChatNav, ChatSpaceNav } from "@/features/chat/types";
import { nav as originalNav, id } from "./quick-switch-fixture";

const mocks = vi.hoisted(() => ({
  pathname: "/",
  router: { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => mocks.router,
}));
vi.mock("next/link", async (original) => ({
  ...(await original<typeof import("next/link")>()),
  useLinkStatus: () => ({ pending: false }),
}));
vi.mock("@/features/chat/actions", () => ({
  setRoomMuted: vi.fn(),
  setSpaceMuted: vi.fn(),
}));
vi.mock("@/features/calls/components/call-provider", () => ({
  useCall: () => ({ call: null, participants: [], join: vi.fn() }),
}));

function nav(): ChatNav {
  const value = structuredClone(originalNav);
  value.spaces[0]!.voiceChannels = [
    {
      id: id(8),
      name: "음성 회의실",
      capacity: 10,
      participantCount: 1,
      participants: [
        {
          avatar: { color: "blue" as const, photoUrl: null },
          userId: id(20),
          name: "김하은",
        },
      ],
    },
  ];
  value.callsEnabled = true;
  value.calls = [
    { roomId: id(2), participantCount: 2 },
    { roomId: id(4), participantCount: 3 },
    { roomId: id(5), participantCount: 5 },
    { roomId: id(6), participantCount: 4 },
  ];
  return value;
}
function renderWithQueries(children: ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.pathname = "/";
});

describe("safe navigation call targets", () => {
  it("derives all room kinds from eight supplied spaces without inventing missing targets", () => {
    const data = nav();
    const base = data.spaces[0]!;
    data.spaces = Array.from({ length: 8 }, (_, index): ChatSpaceNav => ({
      ...base,
      id: id(100 + index),
      name: `가상 스페이스 ${index}`,
      kind: index === 1 ? "branch" : index === 2 ? "community" : "team",
      channels: [{ ...base.channels[0]!, id: id(200 + index) }],
      voiceChannels: [{ ...base.voiceChannels[0]!, id: id(300 + index) }],
    }));
    const targets = callNavigationTargets(data);
    expect(targets).toHaveLength(19);
    expect(targets.map(({ roomKind }) => roomKind)).toEqual([
      ...Array.from({ length: 8 }, () => ["text", "voice"]).flat(),
      "dm",
      "group_dm",
      "meeting",
    ]);
    for (const [index, space] of data.spaces.entries()) {
      expect(targets[index * 2]).toEqual({
        roomId: id(200 + index),
        roomKind: "text",
        name: space.channels[0]!.name,
        href: `/s/${space.id}/${id(200 + index)}`,
        participants: [],
      });
    }
    expect(targets.find(({ roomKind }) => roomKind === "dm")?.href).toBe(
      `/dm/${id(4)}`,
    );
    expect(targets.find(({ roomKind }) => roomKind === "meeting")?.href).toBe(
      `/m/${id(7)}`,
    );
    expect(
      targets.find(({ roomKind }) => roomKind === "group_dm")?.name,
    ).toContain("서연");
    expect(
      targets.every(
        (target) =>
          Object.keys(target).sort().join() ===
          ["roomId", "roomKind", "name", "href", "participants"].sort().join(),
      ),
    ).toBe(true);
  });
  it("never turns a lounge navigation roster into name metadata", () => {
    const data = nav();
    data.spaces[0]!.kind = "branch";
    const targets = callNavigationTargets(data);
    expect(
      targets.find(({ roomKind }) => roomKind === "voice")?.participants,
    ).toEqual([]);
    expect(data.spaces[0]!.voiceChannels[0]!.participants).toHaveLength(1);
    data.spaces[0]!.kind = "community";
    expect(
      callNavigationTargets(data).find(({ roomKind }) => roomKind === "voice")
        ?.participants,
    ).toEqual([
      {
        userId: id(20),
        name: "김하은",
        avatar: { color: "blue", photoUrl: null },
      },
    ]);
  });
  it("does not synthesize a target from stale myCall or calls records absent from navigation", () => {
    const data = nav();
    data.spaces = [];
    data.directMessages = [];
    data.meetings = [];
    data.myCall = {
      roomId: id(8),
      participantId: id(40),
      sessionId: id(41),
      kind: "voice",
      joinedAt: data.now,
      stale: true,
    };
    expect(callNavigationTargets(data)).toEqual([]);
  });
});

describe("voice quick switching", () => {
  it("labels voice separately from text but searches by the same normalized room and space names", () => {
    const data = nav();
    data.spaces[0]!.voiceChannels[0]!.name = "일반";
    const items = quickSwitchItems(data, []);
    expect(items.find(({ id: key }) => key === id(8))).toEqual({
      id: id(8),
      kind: "room",
      label: "🔊 일반 · 한글 모임",
      search: "일반 한글 모임",
      href: `/s/${id(1)}/${id(8)}`,
      unread: false,
    });
    expect(items.find(({ id: key }) => key === id(2))?.label).toMatch(/^#/);
    expect(
      filterQuickSwitchItems(items, " 한글 ", []).some(
        ({ id: key }) => key === id(8),
      ),
    ).toBe(true);
  });
  it("preserves visited voice rooms in recent order without treating them as unread text", () => {
    const data = nav();
    const items = quickSwitchItems(data, []);
    expect(
      filterQuickSwitchItems(items, "", []).some(
        ({ id: key }) => key === id(8),
      ),
    ).toBe(false);
    const recent = filterQuickSwitchItems(items, "", [id(8), id(2)]);
    expect(recent.slice(0, 2).map(({ id: key }) => key)).toEqual([
      id(8),
      id(2),
    ]);
    expect(recent.filter(({ id: key }) => key === id(8))).toHaveLength(1);
    data.spaces[0]!.voiceChannels = [];
    expect(
      filterQuickSwitchItems(quickSwitchItems(data, []), "", [id(8)]).some(
        ({ id: key }) => key === id(8),
      ),
    ).toBe(false);
  });
});

describe("call indicators on navigation links", () => {
  it("exposes the phone count through text and an accessible name", () => {
    render(<CallIndicator count={3} />);
    expect(screen.getByRole("img", { name: "통화 중, 3명" })).toHaveTextContent(
      "3",
    );
    expect(screen.getByRole("img")).toHaveClass("tabular-nums");
  });
  it.each([undefined, 0])(
    "does not describe an absent or stale-only call as ongoing (%s)",
    (count) => {
      const { container } = render(<CallIndicator count={count} />);
      expect(container).toBeEmptyDOMElement();
    },
  );
  it("adds count to a text-channel link without losing unread or selected semantics", () => {
    const data = nav();
    mocks.pathname = `/s/${id(1)}/${id(2)}`;
    renderWithQueries(<ChatSidebarNavigation {...data} />);
    const link = screen.getByRole("link", { name: /통화 중, 2명/ });
    expect(link).toHaveAttribute("href", `/s/${id(1)}/${id(2)}`);
    expect(link).toHaveAttribute("aria-current", "page");
    expect(link).toHaveAccessibleName(/안 읽은 메시지 있음/);
    expect(
      within(link).getByRole("img", { name: "통화 중, 2명" }),
    ).toBeInTheDocument();
  });
  it("adds independent counts to direct and group links and leaves names and membership size intact", () => {
    const data = nav();
    mocks.pathname = `/dm/${id(4)}`;
    render(<DirectMessageList rows={data.directMessages} calls={data.calls} />);
    const direct = screen.getByRole("link", { name: /통화 중, 3명/ });
    expect(direct).toHaveAttribute("href", `/dm/${id(4)}`);
    expect(direct).toHaveAttribute("aria-current", "page");
    expect(direct).toHaveAccessibleName(/김하은/);
    const group = screen.getByRole("link", { name: /통화 중, 5명/ });
    expect(group).toHaveAttribute("href", `/dm/${id(5)}`);
    expect(group).toHaveAccessibleName(/서연/);
    expect(group).toHaveAccessibleName(/3명/);
  });
  it("keeps meeting links on the booking URL and announces the independent call count", () => {
    const data = nav();
    mocks.pathname = `/m/${id(7)}`;
    render(
      <MeetingList rows={data.meetings} now={data.now} calls={data.calls} />,
    );
    const link = screen.getByRole("link", { name: /통화 중, 4명/ });
    expect(link).toHaveAttribute("href", `/m/${id(7)}`);
    expect(link).toHaveAttribute("aria-current", "page");
    expect(
      within(link).getByRole("img", { name: "통화 중, 4명" }),
    ).toBeInTheDocument();
  });
  it("does not announce zero active people as a live call on any navigation link", () => {
    const data = nav();
    data.calls = data.calls.map((call) => ({ ...call, participantCount: 0 }));
    mocks.pathname = `/s/${id(1)}/${id(2)}`;
    const { rerender } = renderWithQueries(<ChatSidebarNavigation {...data} />);
    expect(
      screen.queryByRole("link", { name: /통화 중/ }),
    ).not.toBeInTheDocument();
    rerender(
      <>
        <DirectMessageList rows={data.directMessages} calls={data.calls} />
        <MeetingList rows={data.meetings} now={data.now} calls={data.calls} />
      </>,
    );
    expect(
      screen.queryByRole("link", { name: /통화 중/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: /통화 중/ }),
    ).not.toBeInTheDocument();
  });
});
