import { act, cleanup, render, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { ChatMentions } from "@/features/chat/components/chat-mentions";
import {
  CHAT_NAV_KEY,
  applyMyStatus,
  chatNavRevision,
  mergeChatNav,
  mergeInitialChatNav,
} from "@/features/chat/nav-state";
import type { ChatNav } from "@/features/chat/types";
import { useNotificationToasts } from "@/features/notifications/components/use-notification-toasts";
import type { NotificationSummary } from "@/features/notifications/types";
import type { RealtimeEvent } from "@/lib/realtime/types";

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  reauthorize: vi.fn(),
  receive: (_event: RealtimeEvent) => {
    void _event;
  },
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/components/realtime-provider", () => ({
  useRealtimeReauthorize: () => mocks.reauthorize,
  useRealtimeChannel: (_channel: string, receive: typeof mocks.receive) => {
    mocks.receive = receive;
  },
}));
const nav = (): ChatNav => ({
  callsEnabled: false,
  calls: [],
  myCall: null,
  myStatus: "online",
  blockedUserIds: [],
  meetings: [],
  now: "2026-10-08T03:00:00.000Z",
  spaces: [],
  directMessages: [
    {
      kind: "dm",
      roomId: "room",
      other: { userId: "peer", name: "가상 상대", username: null },
      lastSeq: 0,
      lastMessageAt: "2026-10-08T00:00:00Z",
      unread: false,
      unreadCount: 0,
      unreadMentions: 0,
      muted: false,
    },
  ],
});
const event = (seq = 1): Extract<RealtimeEvent, { type: "room.activity" }> => ({
  type: "room.activity",
  bookingId: null,
  roomId: "room",
  spaceId: null,
  roomKind: "dm",
  seq,
  authorId: "peer",
  preview: {
    messageId: `m-${seq}`,
    authorName: "가상 상대",
    excerpt: "안녕하세요",
  },
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const wrap = (client: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
describe("manual status suppresses only message toast surfaces", () => {
  it("uses a group display name and author excerpt, but refreshes system activity without a toast", async () => {
    const client = new QueryClient();
    const base = nav().directMessages[0]!;
    client.setQueryData<ChatNav>(CHAT_NAV_KEY, {
      ...nav(),
      directMessages: [
        {
          roomId: base.roomId,
          kind: "group_dm",
          name: "가상 프로젝트",
          memberCount: 3,
          members: [
            { userId: "peer", name: "가상 상대" },
            { userId: "other", name: "다른 사람" },
          ],
          lastSeq: 0,
          lastMessageAt: base.lastMessageAt,
          unread: false,
          unreadCount: 0,
          unreadMentions: 0,
          muted: false,
        },
      ],
    });
    const refresh = vi.fn(async () =>
      client.getQueryData<ChatNav>(CHAT_NAV_KEY),
    );
    render(<ChatMentions userId="me" count={0} refresh={refresh} />, {
      wrapper: wrap(client),
    });
    act(() => mocks.receive({ ...event(), roomKind: "group_dm" }));
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(mocks.toast).toHaveBeenCalledWith(
      "가상 프로젝트",
      expect.objectContaining({ description: "가상 상대: 안녕하세요" }),
    );
    mocks.toast.mockClear();
    act(() =>
      mocks.receive({
        ...event(2),
        roomKind: "group_dm",
        authorId: null,
        preview: null,
      }),
    );
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(mocks.toast).not.toHaveBeenCalled();
  });
  it("keeps a status saved before navigation arrives without inventing empty server lists", () => {
    const client = new QueryClient();
    applyMyStatus(client, "dnd");
    expect(client.getQueryData(CHAT_NAV_KEY)).toBeUndefined();
    mergeInitialChatNav(client, nav());
    expect(client.getQueryData<ChatNav>(CHAT_NAV_KEY)?.myStatus).toBe("dnd");
    const fresh = mergeChatNav(client, nav(), chatNavRevision(client));
    client.setQueryData(CHAT_NAV_KEY, fresh);
    mergeInitialChatNav(client, nav());
    expect(client.getQueryData<ChatNav>(CHAT_NAV_KEY)?.myStatus).toBe("online");
  });
  it("keeps DM counts changing while dnd and suppresses a toast already queued before the change", async () => {
    const client = new QueryClient();
    client.setQueryData(CHAT_NAV_KEY, nav());
    render(<ChatMentions userId="me" count={0} refresh={async () => nav()} />, {
      wrapper: wrap(client),
    });
    act(() => mocks.receive(event()));
    act(() => mocks.receive({ type: "status.changed", status: "dnd" }));
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(client.getQueryData<ChatNav>(CHAT_NAV_KEY)).toMatchObject({
      myStatus: "dnd",
      directMessages: [{ unreadCount: 1 }],
    });
    act(() => mocks.receive(event(2)));
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(
      client.getQueryData<ChatNav>(CHAT_NAV_KEY)?.directMessages[0]
        ?.unreadCount,
    ).toBe(2);
    act(() => mocks.receive({ type: "status.changed", status: "online" }));
    act(() => mocks.receive(event(3)));
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(mocks.toast).toHaveBeenCalledTimes(1);
  });
  it("suppresses blocked authors and reauthenticates without exposing the event contents", async () => {
    const client = new QueryClient();
    client.setQueryData(CHAT_NAV_KEY, { ...nav(), blockedUserIds: ["peer"] });
    const refresh = vi.fn(async () => nav());
    render(<ChatMentions userId="me" count={0} refresh={refresh} />, {
      wrapper: wrap(client),
    });
    act(() => mocks.receive(event()));
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(mocks.toast).not.toHaveBeenCalled();
    act(() => mocks.receive({ type: "realtime.reauth" }));
    expect(mocks.reauthorize).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it("does not overwrite a newer status event with an older pending navigation response", () => {
    const client = new QueryClient();
    client.setQueryData(CHAT_NAV_KEY, nav());
    const revision = chatNavRevision(client);
    applyMyStatus(client, "dnd");
    expect(mergeChatNav(client, nav(), revision).myStatus).toBe("dnd");
    expect(mergeChatNav(client, nav(), chatNavRevision(client)).myStatus).toBe(
      "online",
    );
  });
  it("advances the notification cursor while dnd without losing count data or replaying old toasts", async () => {
    const client = new QueryClient();
    client.setQueryData(CHAT_NAV_KEY, { ...nav(), myStatus: "dnd" });
    const initial: NotificationSummary = {
      now: "2026-10-08T00:00:00Z",
      items: [],
      unreadCount: 0,
      nextAt: null,
    };
    const updated: NotificationSummary = {
      ...initial,
      now: "2026-10-08T00:01:00Z",
      unreadCount: 1,
      items: [
        {
          id: "notification",
          type: "friend_request",
          data: { actorName: "가상 상대" },
          read: false,
          bookingId: null,
          href: "/friends?tab=requests",
          scheduledFor: "2026-10-08T00:00:30Z",
        },
      ],
    };
    const activate = vi.fn(async () => true);
    const view = renderHook(
      ({ data }) => useNotificationToasts(data, activate),
      { initialProps: { data: initial }, wrapper: wrap(client) },
    );
    view.rerender({ data: updated });
    expect(mocks.toast).not.toHaveBeenCalled();
    act(() => applyMyStatus(client, "online"));
    await act(() => vi.advanceTimersByTimeAsync(10));
    view.rerender({ data: { ...updated, now: "2026-10-08T00:02:00Z" } });
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(updated.unreadCount).toBe(1);
  });
});
