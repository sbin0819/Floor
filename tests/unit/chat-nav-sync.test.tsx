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
} from "@/features/chat/nav-state";
import type { ChatSpaceNav } from "@/features/chat/types";
import type { RealtimeEvent } from "@/lib/realtime/types";

const spaceId = "11111111-1111-4111-8111-111111111111";
const roomId = "22222222-2222-4222-8222-222222222222";
const secondId = "33333333-3333-4333-8333-333333333333";
const mocks = vi.hoisted(() => ({
  pathname: "/",
  channel: null as string | null,
  event: (_event: RealtimeEvent) => {
    void _event;
  },
}));
vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("next/link", async (original) => ({
  ...(await original<typeof import("next/link")>()),
  useLinkStatus: () => ({ pending: false }),
}));
vi.mock("@/components/realtime-provider", () => ({
  useRealtimeChannel: (channel: string | null, event: typeof mocks.event) => {
    mocks.channel = channel;
    mocks.event = event;
  },
}));
const fixture = (): ChatSpaceNav[] => [
  {
    id: spaceId,
    kind: "team",
    name: "디자인팀",
    initial: "디",
    unread: false,
    channels: [
      { id: roomId, name: "일반", unread: false },
      { id: secondId, name: "자료", unread: false },
    ],
  },
];
function activity(id = roomId, authorId: string | null = "other") {
  mocks.event({ type: "room.activity", spaceId, roomId: id, seq: 2, authorId });
}
function setup(read = vi.fn(async () => fixture())) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const spaces = fixture();
  const node = (data = spaces) => (
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ChatNavSync initialData={data} userId="me" read={read} />
        <LiveChatRail spaces={data} />
        <LiveChatSidebar spaces={data} />
      </TooltipProvider>
    </QueryClientProvider>
  );
  const result = render(node());
  return { ...result, client, read, node };
}
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
beforeEach(() => {
  vi.useFakeTimers();
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
  it("preserves a newer unread poll while a send acknowledgment was in flight", async () => {
    const read = vi.fn(async () =>
      fixture().map((space) => ({
        ...space,
        unread: true,
        channels: space.channels.map((room) => ({ ...room, unread: true })),
      })),
    );
    const { client } = setup(read);
    const sendingAt = chatNavRevision(client);
    await advance(60_001);
    act(() => clearRoomUnread(client, roomId, 5, sendingAt));
    expect(client.getQueryData<ChatSpaceNav[]>(CHAT_NAV_KEY)![0]!.unread).toBe(
      true,
    );
  });
  it("does not let a late send or read acknowledgment clear a newer message", async () => {
    const { client } = setup();
    act(() => {
      mocks.event({
        type: "room.activity",
        spaceId,
        roomId,
        seq: 6,
        authorId: "other",
      });
      clearRoomUnread(client, roomId, 5);
    });
    await advance(1);
    expect(client.getQueryData<ChatSpaceNav[]>(CHAT_NAV_KEY)![0]!.unread).toBe(
      true,
    );
    act(() => {
      clearRoomUnread(client, roomId, 6);
      activity();
    });
    expect(client.getQueryData<ChatSpaceNav[]>(CHAT_NAV_KEY)![0]!.unread).toBe(
      false,
    );
  });
  it("subscribes only the selected space and gives unread channels and rail accessible marks", async () => {
    const { container } = setup();
    expect(mocks.channel).toBe(`space:${spaceId}`);
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
  it("does not subscribe from home and shows an 8px unread bar on another space", async () => {
    mocks.pathname = "/";
    const read = vi.fn(async () =>
      fixture().map((space) => ({
        ...space,
        unread: true,
        channels: space.channels.map((room) => ({ ...room, unread: true })),
      })),
    );
    const { container } = setup(read);
    expect(mocks.channel).toBeNull();
    await advance(60_001);
    expect(container.querySelector('[data-unread="true"]')).toHaveClass("h-2");
  });
  it("ignores my messages and the visible bottom, but includes system messages and hidden tabs", async () => {
    const { client } = setup();
    act(() => activity(roomId, "me"));
    act(() => {
      reportRoomViewport(client, roomId, true);
      activity();
    });
    await advance(1);
    expect(client.getQueryData<ChatSpaceNav[]>(CHAT_NAV_KEY)?.[0]?.unread).toBe(
      false,
    );
    act(() => {
      releaseRoomViewport(client, roomId);
      activity(roomId, null);
    });
    await advance(1);
    expect(client.getQueryData<ChatSpaceNav[]>(CHAT_NAV_KEY)?.[0]?.unread).toBe(
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
    expect(client.getQueryData<ChatSpaceNav[]>(CHAT_NAV_KEY)?.[0]?.unread).toBe(
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
    const space = client.getQueryData<ChatSpaceNav[]>(CHAT_NAV_KEY)![0]!;
    expect(space.unread).toBe(true);
    expect(space.channels.map((room) => room.unread)).toEqual([false, true]);
    act(() => clearRoomUnread(client, secondId));
    expect(client.getQueryData<ChatSpaceNav[]>(CHAT_NAV_KEY)![0]!.unread).toBe(
      false,
    );
  });
  it("preserves activity and reads newer than a poll, while the next poll repairs failed optimistic reads", async () => {
    let resolve!: (value: ChatSpaceNav[]) => void;
    const read = vi.fn(
      () =>
        new Promise<ChatSpaceNav[]>((done) => {
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
        fixture().map((space) => ({
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
        .getQueryData<ChatSpaceNav[]>(CHAT_NAV_KEY)![0]!
        .channels.map((room) => room.unread),
    ).toEqual([true, false]);
    await advance(60_000);
    await act(async () =>
      resolve(
        fixture().map((space) => ({
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
        .getQueryData<ChatSpaceNav[]>(CHAT_NAV_KEY)![0]!
        .channels.map((room) => room.unread),
    ).toEqual([false, true]);
  });
  it("does not let delayed SSR navigation erase a recent event", async () => {
    const { client, rerender, node } = setup();
    act(() => activity());
    rerender(node(fixture()));
    await advance(1);
    expect(client.getQueryData<ChatSpaceNav[]>(CHAT_NAV_KEY)![0]!.unread).toBe(
      true,
    );
  });

  it("keeps a fresh poll's unread value when older SSR props arrive later", async () => {
    const read = vi.fn(async () =>
      fixture().map((space) => ({
        ...space,
        unread: true,
        channels: space.channels.map((room) => ({ ...room, unread: true })),
      })),
    );
    const { client, rerender, node } = setup(read);
    await advance(60_001);
    rerender(node(fixture()));
    await advance(1);
    expect(client.getQueryData<ChatSpaceNav[]>(CHAT_NAV_KEY)![0]!.unread).toBe(
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
        fixture().map((space) => ({ ...space, email: "private@example.test" })),
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
});
