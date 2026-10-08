import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChannelMessages } from "@/features/chat/components/use-channel-messages";
import {
  roomMessagesKey,
  type DisplayMessage,
} from "@/features/chat/components/message-state";
import type {
  ChannelView,
  ChatMessage,
  RoomMessagesPage,
} from "@/features/chat/types";
import type { RealtimeEvent } from "@/lib/realtime/types";
import type { RealtimeLifecycleEvent } from "@/lib/realtime/ably-browser";

const realtime = vi.hoisted(() => ({
  state: "disabled",
  event: vi.fn<(event: RealtimeEvent) => void>() as (
    event: RealtimeEvent,
  ) => void,
  lifecycle: vi.fn<(event: RealtimeLifecycleEvent) => void>() as (
    event: RealtimeLifecycleEvent,
  ) => void,
}));
vi.mock("@/features/chat/actions", () => ({ sendMessage: vi.fn() }));
vi.mock("@/components/realtime-provider", () => ({
  useRealtimeConnectionState: () => realtime.state,
  useRealtimeChannel: (_channel: string, callback: typeof realtime.event) => {
    realtime.event = callback;
  },
  useRealtimeLifecycle: (callback: typeof realtime.lifecycle) => {
    realtime.lifecycle = callback;
  },
}));

function message(seq: number, extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `message-${seq}`,
    seq,
    authorId: "other",
    authorName: "이서연",
    kind: "text",
    body: `${seq}번째`,
    createdAt: "2026-10-08T00:00:00Z",
    clientId: null,
    ...extra,
  };
}
function view(id = "room-a"): ChannelView {
  return {
    room: {
      id,
      name: "일반",
      topic: null,
      archived: false,
      adminOnly: false,
      lastSeq: 1,
    },
    space: { id: "space-a", name: "디자인팀" },
    user: { id: "me", name: "박지훈" },
    members: [],
    messages: [message(1)],
    canWrite: true,
    now: "2026-10-08T01:00:00Z",
    firstUnreadSeq: null,
    lastReadSeq: null,
  };
}
function page(seqs: number[], extra: Partial<RoomMessagesPage> = {}) {
  return {
    messages: seqs.map((seq) => message(seq)),
    hasMore: false,
    lastSeq: Math.max(1, ...seqs),
    lastReadSeq: null,
    firstUnreadSeq: null,
    ...extra,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function Harness({ data }: { data: ChannelView }) {
  const state = useChannelMessages(data);
  return (
    <>
      <output aria-label="목록">
        {state.messages.map((message) => message.id).join(",")}
      </output>
      <output aria-label="보정">{String(state.reconnecting)}</output>
      <output aria-label="재시작">{JSON.stringify(state.historyReset)}</output>
      <output aria-label="알림">
        {state.liveMessages.map((message) => message.id).join(",")}
      </output>
    </>
  );
}
function setup(initial = view()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const ui = (data: ChannelView) => (
    <QueryClientProvider client={client}>
      <Harness data={data} />
    </QueryClientProvider>
  );
  const result = render(ui(initial));
  return {
    ...result,
    client,
    update: (data: ChannelView) => result.rerender(ui(data)),
  };
}
beforeEach(() => {
  realtime.state = "disabled";
});
afterEach(() => vi.unstubAllGlobals());

describe("channel reconnect integration", () => {
  it("fills the server-to-first-attach window, including an already connected reused channel", async () => {
    realtime.state = "connected";
    const fetcher = vi.fn(async () => Response.json(page([2])));
    vi.stubGlobal("fetch", fetcher);
    setup();
    await waitFor(() =>
      expect(screen.getByLabelText("목록")).toHaveTextContent(
        "message-1,message-2",
      ),
    );
    expect(fetcher).toHaveBeenCalledWith(
      "/api/rooms/room-a/messages?after=1",
      expect.anything(),
    );
    expect(screen.getByLabelText("알림")).toBeEmptyDOMElement();
  });
  it("fetches after first attachment and after continuity loss, not a resumed attachment", async () => {
    const fetcher = vi.fn(async () => Response.json(page([])));
    vi.stubGlobal("fetch", fetcher);
    setup();
    act(() =>
      realtime.lifecycle({
        type: "channel",
        channel: "room:room-a",
        state: "attached",
        resumed: true,
      }),
    );
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await act(async () => {});
    act(() =>
      realtime.lifecycle({
        type: "channel",
        channel: "room:room-a",
        state: "attached",
        resumed: true,
      }),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    act(() =>
      realtime.lifecycle({
        type: "channel",
        channel: "room:room-a",
        state: "attached",
        resumed: false,
      }),
    );
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  });
  it("handles disconnected → connecting → connected and hides feedback only after filling", async () => {
    const pending = deferred<Response>();
    const fetcher = vi.fn(() => pending.promise);
    vi.stubGlobal("fetch", fetcher);
    setup();
    act(() => {
      realtime.lifecycle({
        type: "connection",
        previous: "connected",
        current: "disconnected",
      });
      realtime.lifecycle({
        type: "connection",
        previous: "disconnected",
        current: "connecting",
      });
      realtime.lifecycle({
        type: "connection",
        previous: "connecting",
        current: "connected",
      });
    });
    expect(screen.getByLabelText("보정")).toHaveTextContent("true");
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(Response.json(page([2]))));
    await waitFor(() =>
      expect(screen.getByLabelText("목록")).toHaveTextContent("message-2"),
    );
    expect(screen.getByLabelText("보정")).toHaveTextContent("false");
  });
  it("fills missing sequence numbers without a route refresh and announces only direct new events", async () => {
    const fetcher = vi.fn(async () => Response.json(page([2, 3, 4])));
    vi.stubGlobal("fetch", fetcher);
    setup();
    await act(async () => {
      realtime.event({
        type: "message.created",
        roomId: "room-a",
        ...message(3),
      });
      realtime.event({
        type: "message.created",
        roomId: "room-a",
        ...message(4),
      });
      realtime.event({
        type: "message.created",
        roomId: "room-a",
        ...message(4),
      });
    });
    await waitFor(() =>
      expect(screen.getByLabelText("목록")).toHaveTextContent(
        "message-1,message-2,message-3,message-4",
      ),
    );
    expect(fetcher).toHaveBeenCalledWith(
      "/api/rooms/room-a/messages?after=1",
      expect.anything(),
    );
    expect(screen.getByLabelText("알림")).toHaveTextContent(
      "message-3,message-4",
    );
    expect(screen.getByLabelText("알림")).not.toHaveTextContent("message-2");
  });
  it("does not announce my own confirmations or another room's messages", async () => {
    setup();
    await act(async () => {
      realtime.event({
        type: "message.created",
        roomId: "other-room",
        ...message(2),
      });
      realtime.event({
        type: "message.created",
        roomId: "room-a",
        ...message(2, { authorId: "me" }),
      });
    });
    expect(screen.getByLabelText("알림")).toBeEmptyDOMElement();
  });
  it("keeps unsent drafts when resetting the confirmed window", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(page([2], { hasMore: true, lastSeq: 301 })),
      )
      .mockResolvedValueOnce(
        Response.json(
          page([300, 301], { firstUnreadSeq: 200, lastReadSeq: 199 }),
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    const result = setup();
    const pending: DisplayMessage = {
      ...message(0, {
        id: "pending",
        clientId: "client-pending",
        authorId: "me",
      }),
      delivery: "pending",
    };
    act(() => {
      result.client.setQueryData(roomMessagesKey("room-a"), [
        message(1),
        pending,
      ]);
    });
    await act(async () =>
      realtime.lifecycle({
        type: "channel",
        channel: "room:room-a",
        state: "attached",
        resumed: false,
      }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("목록")).toHaveTextContent(
        "message-300,message-301,pending",
      ),
    );
    expect(screen.getByLabelText("목록")).not.toHaveTextContent("message-1,");
    expect(screen.getByLabelText("재시작")).toHaveTextContent(
      '"firstUnreadSeq":200',
    );
    expect(
      result.client
        .getQueryData<DisplayMessage[]>(roomMessagesKey("room-a"))
        ?.at(-1),
    ).toEqual(pending);
  });
  it("aborts requests and ignores late data when the selected room changes", async () => {
    const pending = deferred<Response>();
    const fetcher = vi.fn<typeof fetch>(() => pending.promise);
    vi.stubGlobal("fetch", fetcher);
    const result = setup();
    act(() =>
      realtime.lifecycle({
        type: "channel",
        channel: "room:room-a",
        state: "attached",
        resumed: true,
      }),
    );
    result.update(view("room-b"));
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    await act(async () => pending.resolve(Response.json(page([2]))));
    expect(
      result.client.getQueryData<DisplayMessage[]>(roomMessagesKey("room-b")),
    ).toEqual([message(1)]);
    expect(screen.getByLabelText("목록")).not.toHaveTextContent("message-2");
  });
});
