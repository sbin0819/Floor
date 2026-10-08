import { act, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  ChatRailNavigation,
  ChatSidebarNavigation,
} from "@/components/chat-navigation";
import {
  ChatNavSync,
  LiveChatRail,
  LiveChatSidebar,
  fetchChatNav,
} from "@/features/chat/components/chat-nav";
import { MessagesList } from "@/features/chat/components/messages-list";
import {
  CHAT_NAV_KEY,
  applyDirectActivity,
  applyMention,
  chatNavRevision,
  clearRoomUnread,
  directUnreadCount,
  mergeChatNav,
  mergeInitialChatNav,
  reportRoomViewport,
  releaseRoomViewport,
} from "@/features/chat/nav-state";
import type { ChatNav, DirectMessageNav } from "@/features/chat/types";
import type { RealtimeEvent } from "@/lib/realtime/types";

const userId = "61000000-0000-4000-8000-000000000001";
const roomId = "62000000-0000-4000-8000-000000000001";
const secondRoom = "62000000-0000-4000-8000-000000000002";
const unknownRoom = "62000000-0000-4000-8000-000000000099";
const now = "2026-10-08T03:00:00.000Z";
const mocks = vi.hoisted(() => ({
  pathname: "/",
  push: vi.fn(),
  toast: vi.fn(),
  receive: (_event: RealtimeEvent) => {
    void _event;
  },
}));
vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock("next/link", async (original) => ({
  ...(await original<typeof import("next/link")>()),
  useLinkStatus: () => ({ pending: false }),
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/features/chat/actions", () => ({
  setRoomMuted: vi.fn(),
  setSpaceMuted: vi.fn(),
}));
vi.mock("@/components/realtime-provider", async (original) => ({
  ...(await original<typeof import("@/components/realtime-provider")>()),
  useRealtimeChannel: (
    channel: string | null,
    receive: typeof mocks.receive,
  ) => {
    if (channel === `user:${userId}`) mocks.receive = receive;
  },
}));

type DirectNav = Extract<DirectMessageNav, { kind: "dm" }>;
const direct = (patch: Partial<DirectNav> = {}): DirectNav => ({
  kind: "dm",
  roomId,
  other: {
    userId: "61000000-0000-4000-8000-000000000002",
    name: "이서연",
    username: "seoyeon",
  },
  lastSeq: 3,
  lastMessageAt: "2026-10-08T01:00:00.000Z",
  unread: false,
  unreadCount: 0,
  unreadMentions: 0,
  muted: false,
  ...patch,
});
const fixture = (rows: DirectMessageNav[] = [direct()]): ChatNav => ({
  spaces: [],
  directMessages: rows,
  myStatus: "online",
  blockedUserIds: [],
  meetings: [],
  now: "2026-10-08T03:00:00.000Z",
});
const activity = (
  patch: Partial<Extract<RealtimeEvent, { type: "room.activity" }>> = {},
): Extract<RealtimeEvent, { type: "room.activity" }> => ({
  type: "room.activity",
  bookingId: null,
  roomKind: "dm",
  spaceId: null,
  roomId,
  seq: 4,
  authorId: "other-user",
  preview: {
    messageId: "message-4",
    authorName: "이서연",
    excerpt: "다음 주에 만나요",
  },
  ...patch,
});
const mention = (
  patch: Partial<Extract<RealtimeEvent, { type: "mention.created" }>> = {},
): Extract<RealtimeEvent, { type: "mention.created" }> => ({
  type: "mention.created",
  bookingId: null,
  roomKind: "dm",
  spaceId: null,
  roomId,
  messageId: "message-4",
  seq: 4,
  roomName: "이서연",
  authorName: "이서연",
  excerpt: "다음 주에 만나요",
  ...patch,
});
function cache(data = fixture()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  client.setQueryData(CHAT_NAV_KEY, data);
  return client;
}
const snapshot = (client: QueryClient) =>
  client.getQueryData<ChatNav>(CHAT_NAV_KEY)!;
function setup(
  initialData = fixture(),
  read: (signal: AbortSignal) => Promise<ChatNav> = vi.fn(
    async () => initialData,
  ),
) {
  const client = cache(initialData);
  const tree = (data = initialData) => (
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ChatNavSync initialData={data} userId={userId} read={read} />
        <LiveChatRail data={data} />
        <LiveChatSidebar data={data} />
      </TooltipProvider>
    </QueryClientProvider>
  );
  return { ...render(tree()), client, read, tree };
}
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
  document.title = "Floor";
  mocks.pathname = "/";
  mocks.toast.mockReset();
  mocks.push.mockReset();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("direct navigation cache", () => {
  it("moves a known room to the top, increments once, and ignores duplicate/older sequences", () => {
    const client = cache(
      fixture([
        direct({
          roomId: secondRoom,
          lastMessageAt: "2026-10-08T02:00:00.000Z",
        }),
        direct(),
      ]),
    );
    expect(applyDirectActivity(client, activity(), userId, now)).toBe(
      "applied",
    );
    expect(snapshot(client).directMessages.map(({ roomId }) => roomId)).toEqual(
      [roomId, secondRoom],
    );
    expect(snapshot(client).directMessages[0]).toMatchObject({
      lastSeq: 4,
      lastMessageAt: now,
      unread: true,
      unreadCount: 1,
    });
    expect(applyDirectActivity(client, activity(), userId, now)).toBe(
      "duplicate",
    );
    expect(applyDirectActivity(client, activity({ seq: 2 }), userId, now)).toBe(
      "duplicate",
    );
    expect(snapshot(client).directMessages[0]?.unreadCount).toBe(1);
    expect(
      applyDirectActivity(
        client,
        activity({ roomId: unknownRoom }),
        userId,
        now,
      ),
    ).toBe("missing");
    expect(snapshot(client).directMessages).toHaveLength(2);
  });
  it.each(["mention-first", "activity-first"] as const)(
    "counts activity once and mention separately for %s",
    (order) => {
      const client = cache();
      const apply = () => applyDirectActivity(client, activity(), userId, now);
      const mentioned = () => applyMention(client, mention());
      if (order === "mention-first") {
        mentioned();
        apply();
      } else {
        apply();
        mentioned();
      }
      apply();
      mentioned();
      expect(snapshot(client).directMessages[0]).toMatchObject({
        lastSeq: 4,
        unread: true,
        unreadCount: 1,
        unreadMentions: 1,
      });
      expect(directUnreadCount(snapshot(client))).toBe(1);
    },
  );
  it("bounds unread count at 100 and uses only mentions from muted rooms in the total", () => {
    const client = cache(
      fixture([
        direct({ unread: true, unreadCount: 100 }),
        direct({
          roomId: secondRoom,
          muted: true,
          unreadCount: 70,
          unreadMentions: 2,
        }),
      ]),
    );
    applyDirectActivity(client, activity(), userId, now);
    expect(
      snapshot(client).directMessages.find((row) => row.roomId === roomId)
        ?.unreadCount,
    ).toBe(100);
    expect(directUnreadCount(snapshot(client))).toBe(102);
  });
  it("updates own sent room order and sequence without adding unread", () => {
    const client = cache(
      fixture([
        direct({
          roomId: secondRoom,
          lastMessageAt: "2026-10-08T02:00:00.000Z",
        }),
        direct(),
      ]),
    );
    applyDirectActivity(client, activity({ authorId: userId }), userId, now);
    expect(snapshot(client).directMessages[0]).toMatchObject({
      roomId,
      lastSeq: 4,
      lastMessageAt: now,
      unread: false,
      unreadCount: 0,
    });
  });
  it("does not count a visible bottom but counts a hidden tab or a scrolled-up viewport", () => {
    const client = cache();
    reportRoomViewport(client, roomId, true);
    applyDirectActivity(client, activity(), userId, now);
    expect(snapshot(client).directMessages[0]?.unreadCount).toBe(0);
    reportRoomViewport(client, roomId, false);
    applyDirectActivity(client, activity({ seq: 5 }), userId, now);
    expect(snapshot(client).directMessages[0]?.unreadCount).toBe(1);
    reportRoomViewport(client, roomId, true);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    applyDirectActivity(client, activity({ seq: 6 }), userId, now);
    expect(snapshot(client).directMessages[0]?.unreadCount).toBe(2);
  });
  it("clears all three read indicators but protects newer activity from a late read", () => {
    const client = cache();
    applyMention(client, mention());
    applyDirectActivity(client, activity(), userId, now);
    clearRoomUnread(client, roomId, 3);
    expect(snapshot(client).directMessages[0]).toMatchObject({
      unread: true,
      unreadCount: 1,
      unreadMentions: 1,
    });
    clearRoomUnread(client, roomId, 4);
    expect(snapshot(client).directMessages[0]).toMatchObject({
      unread: false,
      unreadCount: 0,
      unreadMentions: 0,
    });
    applyMention(client, mention({ messageId: "late", seq: 3 }));
    expect(snapshot(client).directMessages[0]?.unreadMentions).toBe(0);
  });
  it("keeps changes newer than a pending poll, then accepts a fresh correction", () => {
    const client = cache();
    const revision = chatNavRevision(client);
    applyDirectActivity(client, activity(), userId, now);
    client.setQueryData(
      CHAT_NAV_KEY,
      mergeChatNav(client, fixture(), revision),
    );
    expect(snapshot(client).directMessages[0]).toMatchObject({
      lastSeq: 4,
      unreadCount: 1,
    });
    const readRevision = chatNavRevision(client);
    clearRoomUnread(client, roomId, 4);
    client.setQueryData(
      CHAT_NAV_KEY,
      mergeChatNav(
        client,
        fixture([direct({ lastSeq: 4, unread: true, unreadCount: 1 })]),
        readRevision,
      ),
    );
    expect(snapshot(client).directMessages[0]?.unreadCount).toBe(0);
    const correction = chatNavRevision(client);
    client.setQueryData(
      CHAT_NAV_KEY,
      mergeChatNav(
        client,
        fixture([direct({ lastSeq: 4, unread: true, unreadCount: 1 })]),
        correction,
      ),
    );
    expect(snapshot(client).directMessages[0]?.unreadCount).toBe(1);
  });
  it("keeps a recently changed room missing from an older response but removes it on the next fresh poll", () => {
    const client = cache();
    const revision = chatNavRevision(client);
    applyDirectActivity(client, activity(), userId, now);
    client.setQueryData(
      CHAT_NAV_KEY,
      mergeChatNav(client, fixture([]), revision),
    );
    expect(snapshot(client).directMessages[0]?.roomId).toBe(roomId);
    const freshRevision = chatNavRevision(client);
    client.setQueryData(
      CHAT_NAV_KEY,
      mergeChatNav(client, fixture([]), freshRevision),
    );
    expect(snapshot(client).directMessages).toEqual([]);
  });
  it("does not let old SSR props erase a newer direct message", () => {
    const client = cache();
    applyDirectActivity(client, activity(), userId, now);
    mergeInitialChatNav(client, fixture());
    expect(snapshot(client).directMessages[0]).toMatchObject({
      lastSeq: 4,
      unreadCount: 1,
    });
  });
  it.each(["poll", "SSR"] as const)(
    "accepts mute/profile metadata from %s while preserving newer live read fields",
    (source) => {
      const client = cache();
      const revision = chatNavRevision(client);
      applyDirectActivity(client, activity(), userId, now);
      applyMention(client, mention());
      const incoming = fixture([
        direct({
          muted: true,
          other: { ...direct().other, name: "새 이름", username: "new_name" },
        }),
      ]);
      if (source === "SSR") mergeInitialChatNav(client, incoming);
      else
        client.setQueryData(
          CHAT_NAV_KEY,
          mergeChatNav(client, incoming, revision),
        );
      expect(snapshot(client).directMessages[0]).toEqual({
        ...incoming.directMessages[0],
        lastSeq: 4,
        lastMessageAt: now,
        unread: true,
        unreadCount: 1,
        unreadMentions: 1,
      });
    },
  );
  it.each(["poll", "SSR"] as const)(
    "accepts group membership/name metadata from %s without replacing newer unread state",
    (source) => {
      const group: DirectMessageNav = {
        kind: "group_dm",
        roomId,
        name: null,
        memberCount: 3,
        members: [
          { userId, name: "나" },
          { userId: "peer", name: "서연" },
          { userId: "third", name: "지훈" },
        ],
        lastSeq: 3,
        lastMessageAt: "2026-10-08T01:00:00.000Z",
        unread: false,
        unreadCount: 0,
        unreadMentions: 0,
        muted: false,
      };
      const client = cache(fixture([group]));
      const revision = chatNavRevision(client);
      applyDirectActivity(
        client,
        activity({ roomKind: "group_dm" }),
        userId,
        now,
      );
      applyMention(client, mention({ roomKind: "group_dm" }));
      const incoming = fixture([
        {
          ...group,
          name: "새 그룹 이름",
          memberCount: 2,
          members: group.members.slice(0, 2),
          muted: true,
        },
      ]);
      if (source === "SSR") mergeInitialChatNav(client, incoming);
      else
        client.setQueryData(
          CHAT_NAV_KEY,
          mergeChatNav(client, incoming, revision),
        );
      expect(snapshot(client).directMessages[0]).toEqual({
        ...incoming.directMessages[0],
        lastSeq: 4,
        lastMessageAt: now,
        unread: true,
        unreadCount: 1,
        unreadMentions: 1,
      });
      clearRoomUnread(client, roomId, 4);
      expect(snapshot(client).directMessages[0]).toEqual({
        ...incoming.directMessages[0],
        lastSeq: 4,
        lastMessageAt: now,
        unread: false,
        unreadCount: 0,
        unreadMentions: 0,
      });
    },
  );
});

describe("direct activity toasts and navigation", () => {
  it.each(["mention-first", "activity-first"] as const)(
    "shows one DM toast for %s without channel wording or links",
    async (order) => {
      const { client } = setup();
      act(() => {
        if (order === "mention-first") {
          mocks.receive(mention());
          mocks.receive(activity());
        } else {
          mocks.receive(activity());
          mocks.receive(mention());
        }
        mocks.receive(activity());
        mocks.receive(mention());
      });
      await advance(251);
      expect(mocks.toast).toHaveBeenCalledExactlyOnceWith(
        "이서연",
        expect.objectContaining({
          id: "dm:message-4",
          description: "다음 주에 만나요",
          action: expect.objectContaining({ label: "보기" }),
        }),
      );
      const options = mocks.toast.mock.calls[0]![1] as {
        action: { onClick: () => void };
      };
      act(() => options.action.onClick());
      expect(mocks.push).toHaveBeenCalledWith(`/dm/${roomId}`);
      expect(JSON.stringify(mocks.toast.mock.calls)).not.toContain("#");
      expect(snapshot(client).directMessages[0]).toMatchObject({
        unreadCount: 1,
        unreadMentions: 1,
      });
      expect(document.title).toBe("(1) Floor");
    },
  );
  it("shows no ordinary muted DM toast, but its later mention gets one DM-shaped toast", async () => {
    setup(fixture([direct({ muted: true })]));
    act(() => mocks.receive(activity()));
    await advance(251);
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(document.title).toBe("Floor");
    act(() => mocks.receive(mention()));
    await advance(251);
    expect(mocks.toast).toHaveBeenCalledExactlyOnceWith(
      "이서연",
      expect.objectContaining({ id: "dm:message-4" }),
    );
    expect(document.title).toBe("(1) Floor");
  });
  it("does not toast an unmuted DM mention without its activity event", async () => {
    setup();
    act(() => mocks.receive(mention()));
    await advance(251);
    expect(mocks.toast).not.toHaveBeenCalled();
  });
  it("deduplicates a muted mention before its delayed activity without marking it as shown too early", async () => {
    const { client } = setup(fixture([direct({ muted: true })]));
    act(() => mocks.receive(mention()));
    await advance(251);
    act(() => {
      mocks.receive(activity());
      mocks.receive(mention());
    });
    await advance(251);
    expect(mocks.toast).toHaveBeenCalledExactlyOnceWith(
      "이서연",
      expect.objectContaining({ id: "dm:message-4" }),
    );
    expect(snapshot(client).directMessages[0]).toMatchObject({
      unreadCount: 1,
      unreadMentions: 1,
    });
  });
  it("suppresses toasts on the current DM route before its message viewport is mounted", async () => {
    mocks.pathname = `/dm/${roomId}`;
    setup();
    act(() => {
      mocks.receive(activity());
      mocks.receive(mention());
    });
    await advance(251);
    expect(mocks.toast).not.toHaveBeenCalled();
  });
  it("does not toast my own message or a system event, and refreshes metadata for the system event", async () => {
    const read = vi.fn(async () =>
      fixture([direct({ lastSeq: 5, unreadCount: 1, unread: true })]),
    );
    const { client } = setup(fixture(), read);
    act(() => {
      mocks.receive(activity({ authorId: userId }));
      mocks.receive(activity({ seq: 5, authorId: null, preview: null }));
    });
    await advance(251);
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(1);
    expect(snapshot(client).directMessages[0]).toMatchObject({
      lastSeq: 5,
      unreadCount: 1,
    });
  });
  it.each([true, false])(
    "suppresses toasts while viewing a DM even when bottom=%s",
    async (atBottom) => {
      const { client } = setup();
      reportRoomViewport(client, roomId, atBottom);
      act(() => {
        mocks.receive(activity());
        mocks.receive(mention());
      });
      await advance(251);
      expect(mocks.toast).not.toHaveBeenCalled();
      expect(snapshot(client).directMessages[0]?.unreadCount).toBe(
        atBottom ? 0 : 1,
      );
    },
  );
  it("rechecks the active room at toast delivery instead of showing a notification after entering it", async () => {
    const { client } = setup();
    act(() => mocks.receive(activity()));
    reportRoomViewport(client, roomId, false);
    await advance(251);
    expect(mocks.toast).not.toHaveBeenCalled();
    releaseRoomViewport(client, roomId);
  });
  it("batches four DM messages into one toast and keeps duplicate events out", async () => {
    setup();
    act(() => {
      for (let index = 4; index < 8; index++) {
        const event = activity({
          seq: index,
          preview: {
            messageId: `m${index}`,
            authorName: "이서연",
            excerpt: `메시지 ${index}`,
          },
        });
        mocks.receive(event);
        mocks.receive(event);
      }
    });
    await advance(251);
    expect(mocks.toast).toHaveBeenCalledExactlyOnceWith(
      "새 메시지 4개",
      expect.objectContaining({ id: "messages:batch" }),
    );
  });
  it("coalesces unknown DM activity into one nav read and toasts only after confirmed membership", async () => {
    const data = fixture([
      direct({ roomId: unknownRoom, lastSeq: 5, unreadCount: 2, unread: true }),
    ]);
    const read = vi.fn(async () => data);
    const { client } = setup(fixture([]), read);
    const first = activity({ roomId: unknownRoom });
    const second = activity({
      roomId: unknownRoom,
      seq: 5,
      preview: {
        messageId: "message-5",
        authorName: "이서연",
        excerpt: "다시 안녕",
      },
    });
    act(() => {
      mocks.receive(first);
      mocks.receive(first);
      mocks.receive(second);
    });
    await advance(249);
    expect(read).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
    await advance(1);
    expect(read).toHaveBeenCalledTimes(1);
    await advance(251);
    expect(mocks.toast).toHaveBeenCalledTimes(2);
    expect(snapshot(client).directMessages).toEqual(data.directMessages);
    act(() => mocks.receive(first));
    await advance(501);
    expect(read).toHaveBeenCalledTimes(1);
    expect(mocks.toast).toHaveBeenCalledTimes(2);
  });
  it("handles an unknown muted DM mention before its activity with one lookup and one toast", async () => {
    const data = fixture([
      direct({
        roomId: unknownRoom,
        muted: true,
        lastSeq: 4,
        unread: true,
        unreadCount: 1,
        unreadMentions: 1,
      }),
    ]);
    const read = vi.fn(async () => data);
    const { client } = setup(fixture([]), read);
    act(() => {
      mocks.receive(mention({ roomId: unknownRoom }));
      mocks.receive(activity({ roomId: unknownRoom }));
      mocks.receive(mention({ roomId: unknownRoom }));
    });
    await advance(501);
    expect(read).toHaveBeenCalledOnce();
    expect(mocks.toast).toHaveBeenCalledExactlyOnceWith(
      "이서연",
      expect.objectContaining({ id: "dm:message-4" }),
    );
    expect(snapshot(client).directMessages[0]).toMatchObject({
      unreadCount: 1,
      unreadMentions: 1,
    });
    expect(document.title).toBe("(1) Floor");
  });
  it("does not show an unknown room's preview if the refreshed nav cannot expose it", async () => {
    const read = vi.fn(async () => fixture([]));
    setup(fixture([]), read);
    act(() => mocks.receive(activity({ roomId: unknownRoom })));
    await advance(501);
    expect(read).toHaveBeenCalledOnce();
    expect(mocks.toast).not.toHaveBeenCalled();
  });
  it("drops a queued DM toast when the message is read before the batch is displayed", async () => {
    const { client } = setup();
    act(() => mocks.receive(activity()));
    act(() => clearRoomUnread(client, roomId, 4));
    await advance(251);
    expect(mocks.toast).not.toHaveBeenCalled();
  });
  it("drops a queued DM toast after entering its route while the viewport still loads", async () => {
    const mounted = setup();
    act(() => mocks.receive(activity()));
    mocks.pathname = `/dm/${roomId}`;
    mounted.rerender(mounted.tree());
    await advance(251);
    expect(mocks.toast).not.toHaveBeenCalled();
  });
  it("cancels unknown-room and toast timers when unmounted", async () => {
    const read = vi.fn(async () => fixture());
    const mounted = setup(fixture(), read);
    act(() => {
      mocks.receive(activity());
      mocks.receive(activity({ roomId: unknownRoom }));
    });
    mounted.unmount();
    await advance(1000);
    expect(read).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });
  it("does not toast an unknown DM after its awaited lookup finishes following unmount", async () => {
    let finish!: (value: ChatNav) => void;
    const read = vi.fn(
      () =>
        new Promise<ChatNav>((resolve) => {
          finish = resolve;
        }),
    );
    const mounted = setup(fixture([]), read);
    act(() => mocks.receive(activity({ roomId: unknownRoom })));
    await advance(250);
    expect(read).toHaveBeenCalledOnce();
    mounted.unmount();
    await act(async () =>
      finish(fixture([direct({ roomId: unknownRoom, lastSeq: 4 })])),
    );
    await advance(1000);
    expect(mocks.toast).not.toHaveBeenCalled();
  });
  it("combines channel mentions with unmuted DM counts and only muted DM mentions in title and rail", async () => {
    const data = fixture([
      direct({ unread: true, unreadCount: 3, unreadMentions: 2 }),
      direct({
        roomId: secondRoom,
        muted: true,
        unreadCount: 80,
        unreadMentions: 2,
      }),
    ]);
    data.spaces = [
      {
        id: "63000000-0000-4000-8000-000000000001",
        kind: "team",
        name: "디자인팀",
        initial: "디",
        unread: false,
        unreadMentions: 4,
        muted: false,
        channels: [
          {
            id: "64000000-0000-4000-8000-000000000001",
            name: "일반",
            unread: false,
            unreadMentions: 4,
            muted: false,
          },
        ],
      },
    ];
    const { client } = setup(data);
    await advance(1);
    expect(document.title).toBe("(9) Floor");
    expect(
      screen.getByRole("link", { name: "Floor 홈, 읽지 않은 메시지 5개" }),
    ).toHaveAttribute("href", "/");
    act(() => clearRoomUnread(client, roomId, 3));
    await advance(1);
    expect(document.title).toBe("(6) Floor");
    expect(
      screen.getByRole("link", { name: "Floor 홈, 읽지 않은 메시지 2개" }),
    ).toBeInTheDocument();
  });
  it("fetches and validates both nav domains while excluding extra identity fields", async () => {
    const data = fixture();
    const fetch = vi.fn(async () =>
      Response.json({
        ...data,
        directMessages: data.directMessages.map((room) => ({
          ...room,
          ...(room.kind === "dm"
            ? { other: { ...room.other, email: "secret@example.test" } }
            : {}),
        })),
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;
    expect(await fetchChatNav(signal)).toEqual(data);
    expect(fetch).toHaveBeenCalledWith("/api/chat/nav", {
      signal,
      cache: "no-store",
      credentials: "same-origin",
    });
  });
});

describe("direct message list presentation", () => {
  function renderNav(data: ChatNav, messages = false) {
    const client = cache(data);
    return render(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          {messages ? (
            <MessagesList data={data} />
          ) : (
            <>
              <ChatRailNavigation
                spaces={data.spaces}
                directMessages={data.directMessages}
              />
              <ChatSidebarNavigation
                spaces={data.spaces}
                directMessages={data.directMessages}
              />
            </>
          )}
        </TooltipProvider>
      </QueryClientProvider>,
    );
  }
  it("shows the first ten sidebar DMs, a new message link, and all-messages link", () => {
    const rows = Array.from({ length: 11 }, (_, index) =>
      direct({
        roomId: `65000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        other: { userId, name: `친구${index}`, username: null },
      }),
    );
    renderNav(fixture(rows));
    const region = screen.getByRole("region", { name: "다이렉트 메시지" });
    expect(within(region).getAllByRole("listitem")).toHaveLength(10);
    expect(within(region).queryByText("친구10")).not.toBeInTheDocument();
    expect(
      within(region).getByRole("link", { name: "새 메시지" }),
    ).toHaveAttribute("href", "/messages/new");
    expect(
      within(region).getByRole("link", { name: "모두 보기" }),
    ).toHaveAttribute("href", "/messages");
  });
  it("uses independent mute/count styles, 24px avatar, 44px targets and current DM marker", () => {
    mocks.pathname = `/dm/${roomId}`;
    const { container } = renderNav(
      fixture([
        direct({ unread: true, unreadCount: 100 }),
        direct({
          roomId: secondRoom,
          other: { userId, name: "박지훈", username: null },
          unread: true,
          unreadCount: 70,
          unreadMentions: 2,
          muted: true,
        }),
      ]),
    );
    const current = screen.getByRole("link", {
      name: "이서연, 읽지 않은 메시지 100개",
    });
    expect(current).toHaveAttribute("aria-current", "page");
    expect(current).toHaveClass("font-bold", "min-h-11");
    expect(current).toHaveTextContent("99+");
    expect(current.querySelector(".size-6")).not.toBeNull();
    const muted = screen.getByRole("link", {
      name: "박지훈, 읽지 않은 메시지 2개",
    });
    expect(muted).toHaveClass("text-muted-foreground");
    expect(muted).not.toHaveClass("font-bold");
    expect(container).not.toHaveTextContent("70");
    expect(
      screen.getByRole("link", { name: "Floor 홈, 읽지 않은 메시지 102개" }),
    ).toHaveAttribute("aria-current", "true");
  });
  it("shows a true empty state with friend discovery and no all-messages link", () => {
    renderNav(fixture([]));
    const region = screen.getByRole("region", { name: "다이렉트 메시지" });
    expect(
      within(region).getByText("친구에게 메시지를 보내 보세요"),
    ).toBeVisible();
    expect(
      within(region).getByRole("link", { name: "친구 보기" }),
    ).toHaveAttribute("href", "/friends");
    expect(
      within(region).queryByRole("link", { name: "모두 보기" }),
    ).not.toBeInTheDocument();
  });
  it("does not render all-messages at the exact ten-room sidebar boundary", () => {
    renderNav(
      fixture(
        Array.from({ length: 10 }, (_, index) =>
          direct({
            roomId: `65000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          }),
        ),
      ),
    );
    const region = screen.getByRole("region", { name: "다이렉트 메시지" });
    expect(within(region).getAllByRole("listitem")).toHaveLength(10);
    expect(
      within(region).queryByRole("link", { name: "모두 보기" }),
    ).not.toBeInTheDocument();
  });
  it("renders all fifty messages-page rows instead of applying the sidebar limit", () => {
    const rows = Array.from({ length: 50 }, (_, index) =>
      direct({
        roomId: `65000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      }),
    );
    renderNav(fixture(rows), true);
    expect(
      within(
        screen.getByRole("region", { name: "다이렉트 메시지" }),
      ).getAllByRole("listitem"),
    ).toHaveLength(50);
    expect(
      screen.getByText(
        "아직 참여한 스페이스가 없어요. 팀에 들어가면 팀 스페이스가 생겨요",
      ),
    ).toBeVisible();
  });
});
