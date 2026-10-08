import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  ChatNavSync,
  LiveChatRail,
  LiveChatSidebar,
  fetchChatNav,
} from "@/features/chat/components/chat-nav";
import {
  CHAT_NAV_KEY,
  chatNavRevision,
  clearRoomUnread,
  reportRoomViewport,
  releaseRoomViewport,
  mergeInitialChatNav,
} from "@/features/chat/nav-state";
import type { ChatNav, ChatSpaceNav } from "@/features/chat/types";
import type { RealtimeEvent } from "@/lib/realtime/types";
import type { RealtimeLifecycleEvent } from "@/lib/realtime/ably-browser";

const spaceId = "11111111-1111-4111-8111-111111111111";
const roomId = "22222222-2222-4222-8222-222222222222";
const secondId = "33333333-3333-4333-8333-333333333333";
const mocks = vi.hoisted(() => ({
  pathname: "/",
  subscribeSpaces: vi.fn(),
  lifecycle: (_event: RealtimeLifecycleEvent) => {
    void _event;
  },
  mention: (_event: RealtimeEvent) => {
    void _event;
  },
  toast: vi.fn(),
  refresh: vi.fn(),
  event: (_event: RealtimeEvent) => {
    void _event;
  },
}));
vi.mock("@/features/chat/actions", () => ({
  setRoomMuted: vi.fn(),
  setSpaceMuted: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: vi.fn(), refresh: mocks.refresh }),
}));
vi.mock("next/link", async (original) => ({
  ...(await original<typeof import("next/link")>()),
  useLinkStatus: () => ({ pending: false }),
}));
vi.mock("@/components/realtime-provider", async (original) => ({
  ...(await original<typeof import("@/components/realtime-provider")>()),
  useRealtimeChannel: (channel: string | null, event: typeof mocks.event) => {
    if (channel?.startsWith("user:")) {
      mocks.mention = event;
      return;
    }
  },
  useRealtimeSpaces: (event: typeof mocks.event) => {
    mocks.subscribeSpaces();
    mocks.event = event;
  },
  useRealtimeLifecycle: (event: typeof mocks.lifecycle) => {
    mocks.lifecycle = event;
  },
}));
const spaceFixture = (): ChatSpaceNav[] => [
  {
    id: spaceId,
    kind: "team",
    iconColor: "blue",
    role: "member",
    name: "디자인팀",
    initial: "디",
    unread: false,
    unreadMentions: 0,
    muted: false,
    channels: [
      {
        id: roomId,
        name: "일반",
        unread: false,
        unreadMentions: 0,
        muted: false,
      },
      {
        id: secondId,
        name: "자료",
        unread: false,
        unreadMentions: 0,
        muted: false,
      },
    ],
  },
];
const fixture = (): ChatNav => ({
  spaces: spaceFixture(),
  directMessages: [],
  myStatus: "online",
  blockedUserIds: [],
  meetings: [],
  now: "2026-10-08T03:00:00.000Z",
});
function mappedFixture(map: (space: ChatSpaceNav) => ChatSpaceNav): ChatNav {
  return {
    spaces: spaceFixture().map(map),
    directMessages: [],
    myStatus: "online",
    blockedUserIds: [],
    meetings: [],
    now: "2026-10-08T03:00:00.000Z",
  };
}
function activity(id = roomId, authorId: string | null = "other") {
  mocks.event({
    type: "room.activity",
    bookingId: null,
    roomKind: "text",
    preview: null,
    spaceId,
    roomId: id,
    seq: 2,
    authorId,
  });
}
function setup(read = vi.fn<typeof fetchChatNav>(async () => fixture())) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const spaces = fixture();
  const node = (data = spaces) => (
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ChatNavSync initialData={data} userId="me" read={read} />
        <LiveChatRail data={data} />
        <LiveChatSidebar data={data} />
      </TooltipProvider>
    </QueryClientProvider>
  );
  const result = render(node());
  return { ...result, client, read, node };
}
describe("space metadata changes", () => {
  it.each(["change-first", "reauth-first"])(
    "coalesces %s events and refreshes the current space",
    async (order) => {
      const read = vi.fn<typeof fetchChatNav>(async () => ({
        ...fixture(),
        spaces: [],
      }));
      const { client } = setup(read);
      act(() => {
        const change = () => mocks.event({ type: "space.changed", spaceId });
        const reauth = () => mocks.mention({ type: "realtime.reauth" });
        if (order === "change-first") {
          change();
          reauth();
        } else {
          reauth();
          change();
        }
        change();
      });
      expect(read).not.toHaveBeenCalled();
      await advance(250);
      expect(read).toHaveBeenCalledOnce();
      expect(mocks.refresh).toHaveBeenCalledOnce();
      expect(client.getQueryData<ChatNav>(CHAT_NAV_KEY)?.spaces).toEqual([]);
    },
  );
  it("refreshes settings for its current space but not a different space or a route left during coalescing", async () => {
    mocks.pathname = `/s/${spaceId}/settings`;
    const { read, rerender, node } = setup();
    act(() => mocks.event({ type: "space.changed", spaceId: secondId }));
    await advance(250);
    expect(read).toHaveBeenCalledOnce();
    expect(mocks.refresh).not.toHaveBeenCalled();
    act(() => mocks.event({ type: "space.changed", spaceId }));
    mocks.pathname = "/teams";
    rerender(node());
    await advance(250);
    expect(read).toHaveBeenCalledTimes(2);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("does not let late server navigation restore a space removed by a newer snapshot", () => {
    const client = new QueryClient();
    const latest = {
      ...fixture(),
      now: "2026-10-08T03:01:00.000Z",
      spaces: [],
    };
    client.setQueryData(CHAT_NAV_KEY, latest);
    mergeInitialChatNav(client, fixture());
    expect(client.getQueryData(CHAT_NAV_KEY)).toEqual(latest);
  });
});
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  document.title = "Floor";
  mocks.toast.mockReset();
  mocks.refresh.mockReset();
  mocks.subscribeSpaces.mockClear();
  mocks.pathname = `/s/${spaceId}/${roomId}`;
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("chat unread navigation", () => {
  it("refreshes once after a reconnect even when connecting is the intermediate state", async () => {
    const { read } = setup();
    act(() =>
      mocks.lifecycle({
        type: "connection",
        previous: "connecting",
        current: "connected",
      }),
    );
    await advance(1);
    expect(read).not.toHaveBeenCalled();
    act(() => {
      mocks.lifecycle({
        type: "connection",
        previous: "connected",
        current: "disconnected",
      });
      mocks.lifecycle({
        type: "connection",
        previous: "disconnected",
        current: "connecting",
      });
      mocks.lifecycle({
        type: "connection",
        previous: "connecting",
        current: "connected",
      });
    });
    await advance(1);
    expect(read).toHaveBeenCalledTimes(1);
    act(() =>
      mocks.lifecycle({
        type: "connection",
        previous: "connected",
        current: "connected",
      }),
    );
    await advance(1);
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("deduplicates mention counts and toasts, protects newer mentions from old reads, and restores title after metadata navigation", async () => {
    const { client, rerender, node } = setup();
    const event = {
      type: "mention.created" as const,
      bookingId: null,
      roomKind: "text" as const,
      spaceId,
      roomId: secondId,
      roomName: "자료",
      messageId: "mention-1",
      seq: 8,
      authorName: "서연",
      excerpt: "안녕하세요",
    };
    act(() => {
      mocks.mention(event);
      mocks.mention(event);
      clearRoomUnread(client, secondId, 7);
    });
    await advance(251);
    expect(
      client.getQueryData<ChatNav>(CHAT_NAV_KEY)!.spaces[0]!.unreadMentions,
    ).toBe(1);
    expect(
      screen.getByRole("link", { name: "자료, 멘션 1개" }),
    ).toBeInTheDocument();
    expect(mocks.toast).toHaveBeenCalledTimes(1);
    expect(document.title).toBe("(1) Floor");
    mocks.pathname = "/teams";
    rerender(node());
    await act(async () => {
      document.head.querySelector("title")?.remove();
      const title = document.createElement("title");
      title.textContent = "팀 | Floor";
      document.head.append(title);
    });
    expect(document.title).toBe("(1) 팀 | Floor");
    act(() => clearRoomUnread(client, secondId, 8));
    await advance(1);
    expect(document.title).toBe("팀 | Floor");
    act(() => mocks.mention(event));
    await advance(251);
    expect(mocks.toast).toHaveBeenCalledTimes(1);
  });
  it("retains muted mention badges and groups bursts but excludes the visible bottom", async () => {
    const { client } = setup();
    act(() =>
      client.setQueryData<ChatNav>(CHAT_NAV_KEY, (rows) => ({
        ...rows!,
        spaces: rows!.spaces.map((space) => ({ ...space, muted: true })),
      })),
    );
    act(() => {
      activity();
      for (let i = 0; i < 4; i++)
        mocks.mention({
          type: "mention.created",
          bookingId: null,
          roomKind: "text",
          spaceId,
          roomId: secondId,
          roomName: "자료",
          messageId: `m${i}`,
          seq: i + 3,
          authorName: "서연",
          excerpt: "멘션",
        });
      reportRoomViewport(client, roomId, true);
      mocks.mention({
        type: "mention.created",
        bookingId: null,
        roomKind: "text",
        spaceId,
        roomId,
        roomName: "일반",
        messageId: "visible",
        seq: 9,
        authorName: "서연",
        excerpt: "현재 방",
      });
    });
    await advance(251);
    expect(client.getQueryData<ChatNav>(CHAT_NAV_KEY)!.spaces[0]).toMatchObject(
      { unread: false, unreadMentions: 4 },
    );
    expect(mocks.toast).toHaveBeenCalledOnce();
    expect(mocks.toast).toHaveBeenCalledWith("새 멘션 4개", expect.anything());
    expect(screen.getByRole("link", { name: "일반" })).not.toHaveClass(
      "font-bold",
    );
  });
  it("preserves a newer unread poll while a send acknowledgment was in flight", async () => {
    const read = vi.fn(async () =>
      mappedFixture((space) => ({
        ...space,
        unread: true,
        channels: space.channels.map((room) => ({ ...room, unread: true })),
      })),
    );
    const { client } = setup(read);
    const sendingAt = chatNavRevision(client);
    await advance(60_001);
    act(() => clearRoomUnread(client, roomId, 5, sendingAt));
    expect(client.getQueryData<ChatNav>(CHAT_NAV_KEY)!.spaces[0]!.unread).toBe(
      true,
    );
  });
  it("does not let a late send or read acknowledgment clear a newer message", async () => {
    const { client } = setup();
    act(() => {
      mocks.event({
        type: "room.activity",
        bookingId: null,
        roomKind: "text",
        preview: null,
        spaceId,
        roomId,
        seq: 6,
        authorId: "other",
      });
      clearRoomUnread(client, roomId, 5);
    });
    await advance(1);
    expect(client.getQueryData<ChatNav>(CHAT_NAV_KEY)!.spaces[0]!.unread).toBe(
      true,
    );
    act(() => {
      clearRoomUnread(client, roomId, 6);
      activity();
    });
    expect(client.getQueryData<ChatNav>(CHAT_NAV_KEY)!.spaces[0]!.unread).toBe(
      false,
    );
  });
  it("listens to joined-space events and gives unread channels and rail accessible marks", async () => {
    const { container } = setup();
    expect(mocks.subscribeSpaces).toHaveBeenCalled();
    act(() => activity());
    await advance(1);
    expect(
      screen.getByRole("link", { name: "일반, 안 읽은 메시지 있음" }),
    ).toHaveClass("font-bold", "text-foreground");
    expect(
      screen.getByRole("link", { name: "디자인팀, 안 읽은 메시지 있음" }),
    ).toBeInTheDocument();
    expect(container.querySelector('[data-unread="true"]')).toHaveClass("h-7");
  });
  it("receives joined-space activity from home and keeps the 8px unread bar after polling", async () => {
    mocks.pathname = "/";
    const read = vi.fn(async () =>
      mappedFixture((space) => ({
        ...space,
        unread: true,
        channels: space.channels.map((room) => ({ ...room, unread: true })),
      })),
    );
    const { container, client } = setup(read);
    expect(mocks.subscribeSpaces).toHaveBeenCalled();
    act(() => activity());
    await advance(1);
    expect(client.getQueryData<ChatNav>(CHAT_NAV_KEY)!.spaces[0]!.unread).toBe(
      true,
    );
    expect(container.querySelector('[data-unread="true"]')).toHaveClass("h-2");
    await advance(60_001);
    expect(container.querySelector('[data-unread="true"]')).toHaveClass("h-2");
  });
  it("updates another joined space while the selected channel stays unchanged", async () => {
    const { client } = setup();
    const otherSpaceId = "44444444-4444-4444-8444-444444444444";
    const otherRoomId = "55555555-5555-4555-8555-555555555555";
    act(() => {
      client.setQueryData<ChatNav>(CHAT_NAV_KEY, (current) => ({
        ...current!,
        spaces: [
          ...current!.spaces,
          {
            ...spaceFixture()[0]!,
            id: otherSpaceId,
            name: "개발팀",
            initial: "개",
            channels: [{ ...spaceFixture()[0]!.channels[0]!, id: otherRoomId }],
          },
        ],
      }));
      mocks.event({
        type: "room.activity",
        bookingId: null,
        roomKind: "text",
        preview: null,
        spaceId: otherSpaceId,
        roomId: otherRoomId,
        seq: 2,
        authorId: "other",
      });
    });
    await advance(1);
    const spaces = client.getQueryData<ChatNav>(CHAT_NAV_KEY)!.spaces;
    expect(spaces.map((space) => space.unread)).toEqual([false, true]);
    expect(
      screen.getByRole("link", { name: "개발팀, 안 읽은 메시지 있음" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "일반" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
  it("ignores my messages and the visible bottom, but includes system messages and hidden tabs", async () => {
    const { client } = setup();
    act(() => activity(roomId, "me"));
    act(() => {
      reportRoomViewport(client, roomId, true);
      activity();
    });
    await advance(1);
    expect(client.getQueryData<ChatNav>(CHAT_NAV_KEY)?.spaces[0]?.unread).toBe(
      false,
    );
    act(() => {
      releaseRoomViewport(client, roomId);
      activity(roomId, null);
    });
    await advance(1);
    expect(client.getQueryData<ChatNav>(CHAT_NAV_KEY)?.spaces[0]?.unread).toBe(
      true,
    );
    act(() => {
      clearRoomUnread(client, roomId);
      reportRoomViewport(client, roomId, true);
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    act(() => activity());
    expect(client.getQueryData<ChatNav>(CHAT_NAV_KEY)?.spaces[0]?.unread).toBe(
      true,
    );
  });
  it("clears a read immediately without losing another channel's unread state", async () => {
    const { client } = setup();
    act(() => {
      activity();
      activity(secondId);
      clearRoomUnread(client, roomId);
    });
    await advance(1);
    const space = client.getQueryData<ChatNav>(CHAT_NAV_KEY)!.spaces[0]!;
    expect(space.unread).toBe(true);
    expect(space.channels.map((room) => room.unread)).toEqual([false, true]);
    act(() => clearRoomUnread(client, secondId));
    expect(client.getQueryData<ChatNav>(CHAT_NAV_KEY)!.spaces[0]!.unread).toBe(
      false,
    );
  });
  it("preserves activity and reads newer than a poll, while the next poll repairs failed optimistic reads", async () => {
    let resolve!: (value: ChatNav) => void;
    const read = vi.fn(
      () =>
        new Promise<ChatNav>((done) => {
          resolve = done;
        }),
    );
    const { client } = setup(read);
    await advance(60_000);
    act(() => {
      activity();
      activity(secondId);
      clearRoomUnread(client, secondId);
    });
    await act(async () =>
      resolve(
        mappedFixture((space) => ({
          ...space,
          channels: space.channels.map((room) => ({
            ...room,
            unread: room.id === secondId,
          })),
        })),
      ),
    );
    expect(
      client
        .getQueryData<ChatNav>(CHAT_NAV_KEY)!
        .spaces[0]!.channels.map((room) => room.unread),
    ).toEqual([true, false]);
    await advance(60_000);
    await act(async () =>
      resolve(
        mappedFixture((space) => ({
          ...space,
          channels: space.channels.map((room) => ({
            ...room,
            unread: room.id === secondId,
          })),
        })),
      ),
    );
    expect(
      client
        .getQueryData<ChatNav>(CHAT_NAV_KEY)!
        .spaces[0]!.channels.map((room) => room.unread),
    ).toEqual([false, true]);
  });
  it("does not let delayed SSR navigation erase a recent event", async () => {
    const { client, rerender, node } = setup();
    act(() => activity());
    rerender(node(fixture()));
    await advance(1);
    expect(client.getQueryData<ChatNav>(CHAT_NAV_KEY)!.spaces[0]!.unread).toBe(
      true,
    );
  });

  it("keeps a fresh poll's unread value when older SSR props arrive later", async () => {
    const read = vi.fn(async () =>
      mappedFixture((space) => ({
        ...space,
        unread: true,
        channels: space.channels.map((room) => ({ ...room, unread: true })),
      })),
    );
    const { client, rerender, node } = setup(read);
    await advance(60_001);
    rerender(node(fixture()));
    await advance(1);
    expect(client.getQueryData<ChatNav>(CHAT_NAV_KEY)!.spaces[0]!.unread).toBe(
      true,
    );
  });
  it("polls every minute, pauses when hidden or idle, and refreshes on focus/input", async () => {
    const { read } = setup();
    await advance(59_999);
    expect(read).not.toHaveBeenCalled();
    await advance(1);
    expect(read).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    fireEvent(document, new Event("visibilitychange"));
    await advance(120_000);
    expect(read).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    fireEvent(document, new Event("visibilitychange"));
    await advance(1);
    expect(read).toHaveBeenCalledTimes(2);
    await advance(600_001);
    const paused = read.mock.calls.length;
    await advance(120_000);
    expect(read).toHaveBeenCalledTimes(paused);
    fireEvent.keyDown(document, { key: "a" });
    await advance(1);
    expect(read.mock.calls.length).toBeGreaterThan(paused);
    const awake = read.mock.calls.length;
    fireEvent(window, new Event("focus"));
    await advance(1);
    expect(read.mock.calls.length).toBeGreaterThan(awake);
  });
  it("fetches privately with cancellation and strips unexpected response fields", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        mappedFixture((space) => ({ ...space, email: "private@example.test" })),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;
    expect(JSON.stringify(await fetchChatNav(signal))).not.toContain("@");
    expect(fetchMock).toHaveBeenCalledWith("/api/chat/nav", {
      signal,
      cache: "no-store",
      credentials: "same-origin",
    });
  });
  it("replaces an older in-flight poll when an unknown DM event needs a fresh membership snapshot", async () => {
    const directId = "44444444-4444-4444-8444-444444444444";
    let finishOld!: (data: ChatNav) => void;
    let oldSignal!: AbortSignal;
    const incoming: ChatNav = {
      ...fixture(),
      directMessages: [
        {
          kind: "dm",
          roomId: directId,
          other: {
            userId: "55555555-5555-4555-8555-555555555555",
            name: "서연",
            username: "seoyeon",
          },
          lastSeq: 4,
          lastMessageAt: "2026-10-08T03:00:00Z",
          unread: true,
          unreadCount: 1,
          unreadMentions: 0,
          muted: false,
        },
      ],
    };
    const read = vi
      .fn<typeof fetchChatNav>()
      .mockImplementationOnce((signal) => {
        oldSignal = signal;
        return new Promise<ChatNav>((resolve) => {
          finishOld = resolve;
        });
      })
      .mockResolvedValueOnce(incoming);
    const { client } = setup(read);
    await advance(60_000);
    expect(read).toHaveBeenCalledOnce();
    expect(oldSignal.aborted).toBe(false);
    act(() =>
      mocks.mention({
        type: "room.activity",
        bookingId: null,
        roomKind: "dm",
        spaceId: null,
        roomId: directId,
        seq: 4,
        authorId: "other",
        preview: {
          messageId: "new-direct-message",
          authorName: "서연",
          excerpt: "새 DM이에요",
        },
      }),
    );
    await advance(250);
    expect(oldSignal.aborted).toBe(true);
    expect(read).toHaveBeenCalledTimes(2);
    await advance(251);
    expect(client.getQueryData<ChatNav>(CHAT_NAV_KEY)?.directMessages).toEqual(
      incoming.directMessages,
    );
    expect(mocks.toast).toHaveBeenCalledExactlyOnceWith(
      "서연",
      expect.objectContaining({ id: "dm:new-direct-message" }),
    );
    await act(async () => finishOld(fixture()));
    expect(client.getQueryData<ChatNav>(CHAT_NAV_KEY)?.directMessages).toEqual(
      incoming.directMessages,
    );
  });
});
