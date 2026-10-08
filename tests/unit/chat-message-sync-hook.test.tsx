import { act, render, renderHook, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Activity, type PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChannelMessages } from "@/features/chat/components/use-channel-messages";
import {
  roomMessagesKey,
  type DisplayMessage,
} from "@/features/chat/components/message-state";
import { requestMessagePage } from "@/features/chat/message-requests";
import {
  emptyMessageDetails,
  type ChannelView,
  type ChatMessage,
  type RoomMessagesPage,
} from "@/features/chat/types";
import type { RealtimeEvent } from "@/lib/realtime/types";
import type { RealtimeLifecycleEvent } from "@/lib/realtime/ably-browser";

const realtime = vi.hoisted(() => ({
  events: new Map<string, (event: RealtimeEvent) => void>(),
  lifecycle: new Set<(event: RealtimeLifecycleEvent) => void>(),
}));
vi.mock("@/features/chat/actions", () => ({
  sendMessage: vi.fn(),
  editMessage: vi.fn(),
  deleteMessage: vi.fn(),
  setReaction: vi.fn(),
}));
vi.mock("@/features/chat/message-requests", () => ({
  requestMessagePage: vi.fn(),
}));
vi.mock("@/components/realtime-provider", async () => {
  const { useEffect } = await import("react");
  return {
    useRealtimeConnectionState: () => "disabled",
    useRealtimeChannel(
      channel: string,
      callback: (event: RealtimeEvent) => void,
    ) {
      useEffect(() => {
        realtime.events.set(channel, callback);
        return () => {
          realtime.events.delete(channel);
        };
      }, [channel, callback]);
    },
    useRealtimeLifecycle(callback: (event: RealtimeLifecycleEvent) => void) {
      useEffect(() => {
        realtime.lifecycle.add(callback);
        return () => {
          realtime.lifecycle.delete(callback);
        };
      }, [callback]);
    },
  };
});

const now = "2026-10-08T00:00:00.000Z";
function message(seq: number, extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    ...emptyMessageDetails(),
    id: `message-${seq}`,
    seq,
    authorId: "other",
    authorName: "이서연",
    kind: "text",
    body: `${seq}번째`,
    clientId: null,
    createdAt: now,
    ...extra,
  };
}
function view(roomId = "room-a", messages = [message(1)]): ChannelView {
  return {
    call: null,
    canCall: false,
    room: {
      kind: "text",
      id: roomId,
      name: "일반",
      topic: null,
      archived: false,
      adminOnly: false,
      lastSeq: Math.max(0, ...messages.map((message) => message.seq)),
      muted: false,
      unreadMentions: 0,
    },
    space: { id: "space-a", name: "디자인팀", muted: false },
    user: { id: "me", name: "박지훈" },
    members: [],
    messages,
    canWrite: true,
    now,
    firstUnreadSeq: null,
    lastReadSeq: null,
  };
}
function page(messages: ChatMessage[]): RoomMessagesPage {
  return {
    messages,
    hasMore: false,
    lastSeq: Math.max(1, ...messages.map((message) => message.seq)),
    peerReadSeq: null,
    lastReadSeq: null,
    firstUnreadSeq: null,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function emit(event: RealtimeEvent, channel = "room:room-a") {
  act(() => realtime.events.get(channel)?.(event));
}
function lifecycle(event: RealtimeLifecycleEvent) {
  act(() => {
    for (const listener of [...realtime.lifecycle]) listener(event);
  });
}
async function tick(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
const clients: QueryClient[] = [];
const unmounts: (() => void)[] = [];
function setup(initial = view()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  const result = renderHook(({ data }) => useChannelMessages(data), {
    initialProps: { data: initial },
    wrapper: ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  unmounts.push(result.unmount);
  return {
    ...result,
    client,
    read: (roomId = initial.room.id) =>
      client.getQueryData<DisplayMessage[]>(roomMessagesKey(roomId))!,
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  realtime.events.clear();
  realtime.lifecycle.clear();
  vi.mocked(requestMessagePage).mockReset().mockResolvedValue(page([]));
});
afterEach(() => {
  unmounts.splice(0).forEach((unmount) => unmount());
  clients.splice(0).forEach((client) => client.clear());
  vi.useRealTimers();
});

describe("channel message reconciliation integration", () => {
  it("uses a reaction event as a page signal, not an authoritative count or identity list", async () => {
    const { read, result } = setup();
    const reaction: RealtimeEvent = {
      type: "reaction.changed",
      roomId: "room-a",
      messageId: "message-1",
      emoji: "heart",
      userId: "other",
      added: true,
      count: 999,
    };
    vi.mocked(requestMessagePage).mockResolvedValue(
      page([
        message(1, {
          reactions: [
            {
              emoji: "heart",
              count: 2,
              mine: false,
              names: ["김민지", "이서연"],
            },
          ],
        }),
      ]),
    );
    emit({ ...reaction, roomId: "other-room" });
    emit({ ...reaction, messageId: "unknown" });
    await tick(250);
    expect(requestMessagePage).not.toHaveBeenCalled();
    emit(reaction);
    emit({ ...reaction, count: 1, added: false });
    expect(read()[0]?.reactions).toEqual([]);
    await tick(250);
    expect(requestMessagePage).toHaveBeenCalledTimes(1);
    expect(read()[0]?.reactions[0]?.count).toBe(2);
    await tick(1);
    expect(result.current.messages[0]?.reactions).toEqual([
      { emoji: "heart", count: 2, mine: false, names: ["김민지", "이서연"] },
    ]);
  });

  it("applies edit and delete immediately and cannot resurrect a deleted row with a delayed created event", async () => {
    const { read, result } = setup();
    emit({
      type: "message.updated",
      roomId: "room-a",
      id: "message-1",
      seq: 1,
      body: "바뀐 본문",
      mentions: [],
      mentionsEveryone: false,
      editedAt: "2026-10-08T00:01:00.000Z",
    });
    expect(read()[0]?.body).toBe("바뀐 본문");
    emit({
      type: "message.deleted",
      roomId: "room-a",
      id: "message-1",
      seq: 1,
    });
    const original = message(1);
    emit({
      ...original,
      type: "message.created",
      roomId: "room-a",
      editedAt: null,
      deletedAt: null,
      reactions: [],
    });
    await tick();
    expect(read()[0]).toMatchObject({
      body: "",
      deletedAt: expect.any(String),
    });
    expect(result.current.liveMessages).toEqual([]);
    await tick(250);
    expect(requestMessagePage).toHaveBeenCalledTimes(1);
  });

  it("keeps a not-yet-loaded message deleted when its created event arrives later", async () => {
    const { read, result } = setup();
    emit({
      type: "message.deleted",
      roomId: "room-a",
      id: "message-2",
      seq: 2,
    });
    expect(read().map((row) => row.seq)).toEqual([1]);
    emit({
      ...message(2, { body: "늦은 비밀 원문" }),
      type: "message.created",
      roomId: "room-a",
      editedAt: null,
      deletedAt: null,
      reactions: [],
    });
    await tick(1);
    expect(read()[1]).toMatchObject({
      id: "message-2",
      body: "",
      deletedAt: expect.any(String),
    });
    expect(JSON.stringify(result.current.messages)).not.toContain(
      "늦은 비밀 원문",
    );
    expect(result.current.liveMessages).toEqual([]);
  });

  it("retains the newest unseen edit over older edits and a delayed created event", async () => {
    const { read, result } = setup();
    const update: RealtimeEvent = {
      type: "message.updated",
      roomId: "room-a",
      id: "message-2",
      seq: 2,
      body: "먼저 도착한 최신 편집",
      mentions: [],
      mentionsEveryone: false,
      editedAt: "2026-10-08T00:02:00.000Z",
    };
    emit(update);
    emit({
      ...update,
      body: "나중에 도착한 옛 편집",
      editedAt: "2026-10-08T00:01:00.000Z",
    });
    expect(read()).toHaveLength(1);
    emit({
      ...message(2),
      type: "message.created",
      roomId: "room-a",
      editedAt: null,
      deletedAt: null,
      reactions: [],
    });
    await tick(1);
    expect(read()[1]).toMatchObject({
      body: update.body,
      editedAt: update.editedAt,
    });
    expect(result.current.liveMessages).toEqual([
      expect.objectContaining({ body: update.body }),
    ]);
  });

  it("preserves an unseen tombstone over a later edit and an HTTP cache acknowledgment", async () => {
    const { client, read, result } = setup();
    emit({
      type: "message.deleted",
      roomId: "room-a",
      id: "message-2",
      seq: 2,
    });
    emit({
      type: "message.updated",
      roomId: "room-a",
      id: "message-2",
      seq: 2,
      body: "삭제 뒤 늦은 편집",
      mentions: [],
      mentionsEveryone: false,
      editedAt: "2026-10-08T00:02:00.000Z",
    });
    act(() =>
      client.setQueryData(roomMessagesKey("room-a"), [
        ...read(),
        message(2, { body: "삭제 전 HTTP 본문" }),
      ]),
    );
    await tick(1);
    expect(read()[1]).toMatchObject({
      body: "",
      deletedAt: expect.any(String),
    });
    expect(result.current.messages[1]?.body).toBe("");
  });

  it("keeps unseen deletion safe when a preserved Activity receives its HTTP result while hidden", async () => {
    const client = new QueryClient();
    clients.push(client);
    const data = view();
    function Reader() {
      const state = useChannelMessages(data);
      return (
        <output aria-label="보존된 채널">
          {JSON.stringify(state.messages)}
        </output>
      );
    }
    const ui = (mode: "visible" | "hidden") => (
      <QueryClientProvider client={client}>
        <Activity mode={mode}>
          <Reader />
        </Activity>
      </QueryClientProvider>
    );
    const rendered = render(ui("visible"));
    unmounts.push(rendered.unmount);
    emit({
      type: "message.deleted",
      roomId: "room-a",
      id: "message-2",
      seq: 2,
    });
    rendered.rerender(ui("hidden"));
    expect(realtime.events.has("room:room-a")).toBe(false);
    act(() =>
      client.setQueryData(roomMessagesKey("room-a"), [
        message(1),
        message(2, { body: "숨김 중 늦은 원문" }),
      ]),
    );
    rendered.rerender(ui("visible"));
    await tick(1);
    expect(screen.getByLabelText("보존된 채널")).not.toHaveTextContent(
      "숨김 중 늦은 원문",
    );
    expect(
      client.getQueryData<DisplayMessage[]>(roomMessagesKey("room-a"))?.[1],
    ).toMatchObject({ body: "", deletedAt: expect.any(String) });
  });

  it("protects a newer event from an in-flight stale server page", async () => {
    const first = deferred<RoomMessagesPage>();
    const { read } = setup();
    vi.mocked(requestMessagePage).mockReturnValueOnce(first.promise);
    emit({
      type: "reaction.changed",
      roomId: "room-a",
      messageId: "message-1",
      emoji: "heart",
      userId: "other",
      added: true,
      count: 1,
    });
    await tick(250);
    emit({
      type: "message.updated",
      roomId: "room-a",
      id: "message-1",
      seq: 1,
      body: "응답 중에 바뀜",
      mentions: [],
      mentionsEveryone: false,
      editedAt: "2026-10-08T00:01:00.000Z",
    });
    first.resolve(page([message(1)]));
    await tick();
    expect(read()[0]?.body).toBe("응답 중에 바뀜");
    await tick(2_000);
    expect(requestMessagePage).toHaveBeenCalledTimes(2);
  });

  it("refreshes loaded reply pages after their off-screen source changes", async () => {
    const reply = message(51, {
      replyTo: {
        attachmentSummary: null,
        id: "message-1",
        authorName: "이서연",
        excerpt: "기존 원문",
        deleted: false,
      },
    });
    const { read } = setup(view("room-a", [reply]));
    emit({
      type: "message.updated",
      roomId: "room-a",
      id: "message-1",
      seq: 1,
      body: "수정한 원문",
      mentions: [],
      mentionsEveryone: false,
      editedAt: "2026-10-08T00:01:00.000Z",
    });
    expect(read()[0]?.replyTo?.excerpt).toBe("수정한 원문");
    await tick(250);
    expect(
      vi.mocked(requestMessagePage).mock.calls.map((call) => call[2]),
    ).toEqual([{ before: 101 }]);
  });

  it("aborts an old room page and never lets its late result overwrite either room", async () => {
    const late = deferred<RoomMessagesPage>();
    const { read, rerender } = setup();
    vi.mocked(requestMessagePage).mockReturnValueOnce(late.promise);
    emit({
      type: "reaction.changed",
      roomId: "room-a",
      messageId: "message-1",
      emoji: "heart",
      userId: "other",
      added: true,
      count: 1,
    });
    await tick(250);
    const signal = vi.mocked(requestMessagePage).mock.calls[0]![3]?.signal;
    rerender({ data: view("room-b", [message(7)]) });
    expect(signal?.aborted).toBe(true);
    expect(realtime.events.has("room:room-a")).toBe(false);
    late.resolve(page([message(1, { body: "이전 방 늦은 결과" })]));
    await tick();
    expect(read("room-a")[0]?.body).toBe("1번째");
    expect(read("room-b")[0]?.body).toBe("7번째");
  });

  it("reconciles visible pages before latest and remaining pages on reconnection, preserving the read boundary", async () => {
    const initial = {
      ...view("room-a", [message(1), message(51), message(101)]),
      lastReadSeq: 50,
      firstUnreadSeq: 51,
    };
    const { result, read } = setup(initial);
    act(() => result.current.reportVisible(51));
    lifecycle({
      type: "connection",
      current: "disconnected",
      previous: "connected",
    });
    lifecycle({
      type: "connection",
      current: "connected",
      previous: "disconnected",
    });
    await tick();
    const before = vi
      .mocked(requestMessagePage)
      .mock.calls.map((call) => call[2])
      .filter((query) => "before" in query);
    expect(before).toEqual([{ before: 101 }, { before: 151 }, { before: 51 }]);
    expect(read().map((row) => row.id)).toEqual([
      "message-1",
      "message-51",
      "message-101",
    ]);
    expect(result.current.historyReset).toBeNull();
    expect(initial.lastReadSeq).toBe(50);
  });
});
