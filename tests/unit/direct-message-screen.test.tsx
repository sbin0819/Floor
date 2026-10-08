import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DirectMessageScreen,
  ChannelScreen,
} from "@/features/chat/components/channel-screen";
import { useDirectPeerRead } from "@/features/chat/components/use-direct-peer-read";
import { PeopleRealtimeSync } from "@/features/people/components/people-realtime-sync";
import {
  emptyMessageDetails,
  type ChatMessage,
  type ChannelView,
  type DirectMessageView,
} from "@/features/chat/types";
import type { RealtimeEvent } from "@/lib/realtime/types";
import type { RealtimeLifecycleEvent } from "@/lib/realtime/ably-browser";
import { fetchRoomMessagesPage } from "@/features/chat/client";
import { roomMessagesKey } from "@/features/chat/components/message-state";
import { CHAT_NAV_KEY } from "@/features/chat/nav-state";
import { installChatViewport } from "../helpers/chat-viewport";

const live = vi.hoisted(() => ({
  listeners: new Set<(event: RealtimeEvent) => void>(),
  lifecycle: new Set<(event: RealtimeLifecycleEvent) => void>(),
  presence: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/dm/room",
  useRouter: () => ({ refresh: live.refresh }),
}));
vi.mock("@/features/chat/actions", () => ({
  sendMessage: vi.fn(),
  setRoomMuted: vi.fn(async () => ({ ok: true, data: undefined })),
  setSpaceMuted: vi.fn(),
  editMessage: vi.fn(),
  deleteMessage: vi.fn(),
  setReaction: vi.fn(),
  respondMessageRequest: vi.fn(async () => ({ ok: true, data: {} })),
  markRoomRead: vi.fn(async ({ seq }: { seq: number }) => ({
    ok: true,
    data: { lastReadSeq: seq },
  })),
}));
vi.mock("@/features/chat/client", () => ({ fetchRoomMessagesPage: vi.fn() }));
vi.mock("@/components/realtime-provider", () => ({
  useRealtimeScope: () => ({ channels: null, requestedRooms: [] }),
  usePresenceStatus: () => "unknown",
  usePresenceStatuses: () => ({}),
  useRealtimeChannel: (
    channel: string | null,
    receive: (event: RealtimeEvent) => void,
  ) =>
    useEffect(() => {
      if (!channel) return;
      live.listeners.add(receive);
      return () => {
        live.listeners.delete(receive);
      };
    }, [channel, receive]),
  useRealtimeLifecycle: (receive: (event: RealtimeLifecycleEvent) => void) =>
    useEffect(() => {
      live.lifecycle.add(receive);
      return () => {
        live.lifecycle.delete(receive);
      };
    }, [receive]),
  useRealtimeConnectionState: () => "disabled",
  useRealtimePresence: () => live.presence,
}));

const me = "10000000-0000-4000-8000-000000000001";
const peer = "10000000-0000-4000-8000-000000000002";
const now = "2030-01-01T03:00:00Z";
function message(seq: number, authorId = me): ChatMessage {
  return {
    ...emptyMessageDetails(),
    id: `message-${seq}`,
    seq,
    authorId,
    authorName: authorId === me ? "김하은" : "이서연",
    kind: "text",
    body: `본문 ${seq}`,
    createdAt: now,
    clientId: null,
  };
}
type DmView = Extract<DirectMessageView, { kind: "dm" }>;
function view(extra: Partial<DmView> = {}): DmView {
  return {
    call: null,
    canCall: false,
    kind: "dm",
    request: null,
    blockedByMe: false,
    room: {
      id: "room",
      archived: false,
      lastSeq: 3,
      muted: false,
      unreadMentions: 0,
    },
    other: {
      userId: peer,
      name: "이서연",
      username: "seoyeon.lee",
      sharesSpace: false,
    },
    user: { id: me, name: "김하은" },
    members: [
      { id: me, name: "김하은", admin: false },
      { id: peer, name: "이서연", admin: false },
    ],
    messages: [message(1, peer), message(2), message(3)],
    lastReadSeq: 3,
    firstUnreadSeq: null,
    peerReadSeq: 0,
    canWrite: true,
    now,
    ...extra,
  };
}
function emit(event: RealtimeEvent) {
  act(() => {
    for (const receive of [...live.listeners]) receive(event);
  });
}
function created(seq: number, authorId = peer): RealtimeEvent {
  return {
    ...message(seq, authorId),
    type: "message.created",
    roomId: "room",
    editedAt: null,
    deletedAt: null,
    reactions: [],
  };
}
function setup(
  data = view(),
  send = vi.fn(
    async ({ body, clientId }: { body: string; clientId: string }) => ({
      ok: true as const,
      data: { ...message(4), body, clientId },
    }),
  ),
  withPeopleSync = false,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const ui = (snapshot: DirectMessageView) => (
    <QueryClientProvider client={client}>
      {withPeopleSync && <PeopleRealtimeSync userId={me} />}
      <DirectMessageScreen data={snapshot} send={send} />
    </QueryClientProvider>
  );
  return { ...render(ui(data)), ui, client, send, user: userEvent.setup() };
}
let restore: () => void;
beforeEach(() => {
  vi.clearAllMocks();
  live.refresh.mockReset();
  live.listeners.clear();
  live.lifecycle.clear();
  restore = installChatViewport();
});
afterEach(() => restore());

describe("shared direct message screen", () => {
  it("replaces stale DM permissions and composer after another tab blocks the peer", async () => {
    const { rerender, ui } = setup(view(), undefined, true);
    expect(screen.getByRole("combobox", { name: "메시지" })).toBeVisible();
    live.refresh.mockImplementation(() => {
      rerender(ui(view({ blockedByMe: true, canWrite: false })));
    });
    act(() => {
      for (const receive of live.listeners) receive({ type: "friend.changed" });
    });
    await waitFor(() =>
      expect(screen.getByText("차단한 사용자예요")).toBeVisible(),
    );
    expect(
      screen.queryByRole("combobox", { name: "메시지" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "차단 풀기" })).toBeVisible();
    expect(live.refresh).toHaveBeenCalledOnce();
  });
  it("shows the recipient request, allows an accepting reply, and never shows a pending read receipt", () => {
    setup(view({ request: { role: "recipient" }, peerReadSeq: 3 }));
    expect(
      screen.getByText("이서연 님이 메시지를 보내고 싶어 해요"),
    ).toBeVisible();
    expect(screen.getByRole("combobox", { name: "메시지" })).toHaveAttribute(
      "placeholder",
      "답장하면 요청을 수락해요",
    );
    expect(screen.queryByText("읽음")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "수락" })).toBeEnabled();
  });
  it("replaces the sender composer at the third message including a just-saved send", async () => {
    const data = view({
      request: { role: "sender", sentCount: 2 },
      peerReadSeq: 3,
    });
    const { user, send, ui, rerender } = setup(data);
    expect(screen.queryByText("읽음")).not.toBeInTheDocument();
    await user.type(
      screen.getByRole("combobox", { name: "메시지" }),
      "세 번째 요청",
    );
    await user.click(screen.getByRole("button", { name: "보내기" }));
    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(
      screen.queryByRole("combobox", { name: "메시지" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("상대가 수락하면 더 보낼 수 있어요")).toBeVisible();
    rerender(ui(view({ request: null, peerReadSeq: 4 })));
    expect(screen.getByRole("combobox", { name: "메시지" })).toBeVisible();
    expect(screen.queryByText(/수락하면 대화가/)).not.toBeInTheDocument();
  });
  it("identifies only my own block and leaves every other denial generic", () => {
    const { ui, rerender } = setup(
      view({ blockedByMe: true, canWrite: false }),
    );
    expect(screen.getByText("차단한 사용자예요")).toBeVisible();
    expect(screen.getByRole("button", { name: "차단 풀기" })).toBeEnabled();
    rerender(ui(view({ blockedByMe: false, canWrite: false })));
    expect(
      screen.getByText("이 대화에는 메시지를 보낼 수 없어요"),
    ).toBeVisible();
    expect(screen.queryByText("차단한 사용자예요")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "차단 풀기" }),
    ).not.toBeInTheDocument();
  });
  it("uses the common chat viewport with a person heading, DM placeholder and no member list", () => {
    const { container } = setup(view({ messages: [] }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "이서연",
    );
    expect(screen.getByRole("button", { name: "이서연 프로필" })).toBeVisible();
    expect(
      screen.getByText("이서연 님과 나눈 대화의 처음이에요"),
    ).toBeVisible();
    expect(
      screen.getByPlaceholderText("이서연 님에게 메시지 보내기"),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /멤버 \d/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("complementary", { name: "채널 멤버" }),
    ).not.toBeInTheDocument();
    expect(container.querySelector("[data-chat-screen]")).toHaveClass("h-full");
    expect(container.querySelector("[data-call-room]")).toHaveClass(
      "h-[calc(100dvh-3.5rem)]",
    );
    expect(
      screen.getByRole("button", { name: "이서연 알림 설정" }),
    ).toBeVisible();
  });
  it("shows the first-conversation introduction when older history is exhausted", () => {
    setup();
    expect(
      screen.getByText("이서연 님과 나눈 대화의 처음이에요"),
    ).toBeVisible();
    expect(screen.queryByText(/#이서연/)).not.toBeInTheDocument();
  });
  it("does not show a username placeholder when the peer has none", () => {
    setup(
      view({
        other: {
          userId: peer,
          name: "이서연",
          username: null,
          sharesSpace: false,
        },
      }),
    );
    expect(screen.queryByText(/^@/)).not.toBeInTheDocument();
  });
  it("offers only the peer and everyone to either member", async () => {
    const { user } = setup();
    await user.type(screen.getByRole("combobox", { name: "메시지" }), "@");
    const list = within(screen.getByRole("listbox"));
    expect(list.getByRole("option", { name: /이서연/ })).toBeVisible();
    expect(list.getByRole("option", { name: /모두/ })).toBeVisible();
    expect(
      list.queryByRole("option", { name: /김하은/ }),
    ).not.toBeInTheDocument();
  });
  it("replaces input with the DM-only read-only notice", () => {
    setup(view({ canWrite: false }));
    expect(
      screen.getByText("이 대화에는 메시지를 보낼 수 없어요"),
    ).toBeVisible();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByText(/관리자만/)).not.toBeInTheDocument();
  });
  it("places one read receipt only beneath the latest saved own message", () => {
    const { container } = setup(view({ peerReadSeq: 3 }));
    expect(screen.getAllByText("읽음")).toHaveLength(1);
    expect(
      container.querySelector('[data-message-id="message-3"]'),
    ).toHaveTextContent("읽음");
    expect(
      container.querySelector('[data-message-id="message-2"]'),
    ).not.toHaveTextContent("읽음");
  });
  it("accepts only the peer read cursor, never regresses and also advances on a peer message", async () => {
    const { client } = setup();
    emit({ type: "room.read", roomId: "room", userId: me, seq: 99 });
    emit({ type: "room.read", roomId: "other-room", userId: peer, seq: 99 });
    expect(screen.queryByText("읽음")).not.toBeInTheDocument();
    emit({ type: "room.read", roomId: "room", userId: peer, seq: 3 });
    expect(screen.getByText("읽음")).toBeVisible();
    emit({ type: "room.read", roomId: "room", userId: peer, seq: 1 });
    expect(screen.getByText("읽음")).toBeVisible();
    act(() =>
      client.setQueryData(roomMessagesKey("room"), [
        message(1, peer),
        message(2),
        message(3),
        message(4),
      ]),
    );
    await waitFor(() =>
      expect(screen.queryByText("읽음")).not.toBeInTheDocument(),
    );
    emit(created(5));
    await waitFor(() => expect(screen.getByText("읽음")).toBeVisible());
  });
  it("uses the higher peer cursor from reconnect pages", async () => {
    setup();
    vi.mocked(fetchRoomMessagesPage).mockResolvedValue({
      messages: [],
      hasMore: false,
      lastSeq: 3,
      lastReadSeq: 3,
      firstUnreadSeq: null,
      peerReadSeq: 3,
    });
    act(() => {
      for (const receive of [...live.lifecycle])
        receive({
          type: "channel",
          channel: "room:room",
          state: "attached",
          resumed: false,
        });
    });
    await waitFor(() => expect(screen.getByText("읽음")).toBeVisible());
    expect(fetchRoomMessagesPage).toHaveBeenCalledWith(
      "room",
      { after: 3 },
      expect.any(Object),
    );
  });
  it("refreshes the nav after a first saved DM but never sends internal room kind to the action", async () => {
    const { user, client, send } = setup(view({ messages: [] }));
    client.setQueryData(CHAT_NAV_KEY, {
      callsEnabled: false,
      calls: [],
      myCall: null,
      spaces: [],
      directMessages: [],
      myStatus: "online",
      blockedUserIds: [],
      meetings: [],
      now: "2026-10-08T03:00:00.000Z",
    });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await user.type(screen.getByRole("combobox", { name: "메시지" }), "첫 DM");
    await user.click(screen.getByRole("button", { name: "보내기" }));
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: CHAT_NAV_KEY }),
    );
    expect(send.mock.calls[0]?.[0]).toEqual({
      roomId: "room",
      body: "첫 DM",
      clientId: expect.any(String),
    });
  });
  it("moves a known DM to the first position after a saved send", async () => {
    const { user, client } = setup();
    const row = {
      kind: "dm",
      roomId: "room",
      other: view().other,
      lastSeq: 3,
      lastMessageAt: "2029-12-31T00:00:00Z",
      unread: false,
      unreadCount: 0,
      unreadMentions: 0,
      muted: false,
    };
    client.setQueryData(CHAT_NAV_KEY, {
      callsEnabled: false,
      calls: [],
      myCall: null,
      spaces: [],
      myStatus: "online",
      blockedUserIds: [],
      meetings: [],
      now: "2026-10-08T03:00:00.000Z",
      directMessages: [
        { ...row, roomId: "other-room", lastMessageAt: "2029-12-31T01:00:00Z" },
        row,
      ],
    });
    await user.type(screen.getByRole("combobox", { name: "메시지" }), "내 DM");
    await user.click(screen.getByRole("button", { name: "보내기" }));
    await waitFor(() =>
      expect(
        client.getQueryData<{ directMessages: { roomId: string }[] }>(
          CHAT_NAV_KEY,
        )?.directMessages[0]?.roomId,
      ).toBe("room"),
    );
  });
  it("does not query DM navigation after an ordinary channel send", async () => {
    const base = view();
    const data: ChannelView = {
      ...base,
      space: { id: "space", name: "팀", muted: false },
      room: {
        ...base.room,
        kind: "text",
        name: "일반",
        topic: null,
        adminOnly: false,
      },
    };
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    render(
      <QueryClientProvider client={client}>
        <ChannelScreen
          data={data}
          send={async (input) => ({
            ok: true,
            data: { ...message(4), ...input },
          })}
        />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "메시지" }), {
      target: { value: "채널" },
    });
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe("direct read cursor scope", () => {
  it("ignores a late page response from a previous room and merges new server values monotonically", () => {
    const { result, rerender } = renderHook(
      ({ roomId, initial }) => useDirectPeerRead(roomId, peer, initial),
      { initialProps: { roomId: "a", initial: 2 } },
    );
    act(() => result.current.receivePage("a", 5));
    expect(result.current.seq).toBe(5);
    rerender({ roomId: "a", initial: 3 });
    expect(result.current.seq).toBe(5);
    const previousReceive = result.current.receivePage;
    rerender({ roomId: "b", initial: 1 });
    act(() => result.current.receivePage("a", 99));
    expect(result.current.seq).toBe(1);
    act(() => result.current.receivePage("b", 4));
    act(() => previousReceive("a", 99));
    expect(result.current.seq).toBe(4);
  });
});
