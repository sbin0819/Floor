import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  skipToken,
  useQuery,
} from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChatQueueConnection,
  useChatSendQueue,
} from "@/features/chat/components/use-chat-send-queue";
import type { RealtimeLifecycleEvent } from "@/lib/realtime/ably-browser";
import {
  roomMessagesKey,
  type DisplayMessage,
} from "@/features/chat/components/message-state";
import type { SendChatMessage } from "@/features/chat/send-queue";
import type { ChannelView } from "@/features/chat/types";
import { emptyMessageDetails } from "@/features/chat/types";

const mocks = vi.hoisted(() => ({
  connection: "disabled",
  lifecycle: (_event: RealtimeLifecycleEvent) => {
    void _event;
  },
}));
vi.mock("@/components/realtime-provider", () => ({
  useRealtimeConnectionState: () => mocks.connection,
  useRealtimeLifecycle: (listener: typeof mocks.lifecycle) => {
    mocks.lifecycle = listener;
  },
}));
const data: ChannelView = {
  call: null,
  canCall: false,
  space: { id: "space", name: "디자인팀", muted: false },
  room: {
    kind: "text",
    id: "room",
    name: "일반",
    topic: null,
    archived: false,
    adminOnly: false,
    lastSeq: 0,
    muted: false,
    unreadMentions: 0,
  },
  user: {
    avatar: { color: "blue" as const, photoUrl: null },
    id: "me",
    name: "박지훈",
  },
  members: [],
  messages: [],
  canWrite: true,
  now: "2026-10-08T00:00:00Z",
  firstUnreadSeq: null,
  lastReadSeq: null,
};
function Screen({
  send,
  room = data,
}: {
  send: SendChatMessage;
  room?: ChannelView;
}) {
  const queue = useChatSendQueue(room, send);
  const { data: messages = [] } = useQuery<DisplayMessage[]>({
    queryKey: roomMessagesKey(room.room.id),
    queryFn: skipToken,
    initialData: [],
    enabled: false,
  });
  return (
    <>
      <button onClick={() => queue.submit("새 메시지")}>전송</button>
      <span>{queue.pending ? "전송 대기" : "전송 완료"}</span>
      {messages.map((message) => (
        <p key={message.id} data-delivery={message.delivery ?? "sent"}>
          {message.body}
        </p>
      ))}
    </>
  );
}
const online = (value: boolean) =>
  Object.defineProperty(navigator, "onLine", { configurable: true, value });
function createSend() {
  return vi.fn<SendChatMessage>().mockImplementation(async (input) => ({
    ok: true,
    data: {
      authorAvatar: { color: "blue" as const, photoUrl: null },
      ...emptyMessageDetails(),
      id: input.clientId,
      seq: 1,
      clientId: input.clientId,
      body: input.body,
      kind: "text",
      authorId: "me",
      authorName: "박지훈",
      createdAt: data.now,
    },
  }));
}
beforeEach(() => {
  online(false);
  mocks.connection = "disabled";
});
afterEach(() => {
  online(true);
  vi.restoreAllMocks();
});
describe("persistent send queue UI", () => {
  it("resumes from the app-wide connection and defers reads in other rooms while any queue is pending", async () => {
    const client = new QueryClient();
    const send = createSend();
    const other = { ...data, room: { ...data.room, id: "other" } };
    const node = (room: ChannelView) => (
      <QueryClientProvider client={client}>
        <ChatQueueConnection />
        <Screen send={send} room={room} />
      </QueryClientProvider>
    );
    const result = render(node(data));
    fireEvent.click(screen.getByText("전송"));
    expect(
      client.getQueryData<DisplayMessage[]>(roomMessagesKey(data.room.id))?.[0]
        ?.authorAvatar,
    ).toEqual(data.user.avatar);
    result.rerender(node(other));
    expect(screen.getByText("전송 대기")).toBeInTheDocument();
    expect(screen.queryByText("새 메시지")).not.toBeInTheDocument();
    act(() => {
      online(true);
      mocks.lifecycle({
        type: "connection",
        previous: "connecting",
        current: "connected",
      });
    });
    await waitFor(() =>
      expect(screen.getByText("전송 완료")).toBeInTheDocument(),
    );
    expect(send.mock.calls[0]![0].roomId).toBe("room");
    result.unmount();
    client.clear();
  });
  it("survives route unmount, warns on unload, drains while away, and restores confirmed messages", async () => {
    const client = new QueryClient();
    const send = createSend();
    const node = (show: boolean) => (
      <QueryClientProvider client={client}>
        {show ? <Screen send={send} /> : <p>다른 화면</p>}
      </QueryClientProvider>
    );
    const result = render(node(true));
    fireEvent.click(screen.getByRole("button", { name: "전송" }));
    expect(screen.getByText("전송 대기")).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
    result.rerender(node(false));
    const unload = new Event("beforeunload", { cancelable: true });
    const prevent = vi.spyOn(unload, "preventDefault");
    fireEvent(window, unload);
    expect(prevent).toHaveBeenCalledOnce();
    expect(unload.defaultPrevented).toBe(true);
    act(() => {
      online(true);
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(
        client.getQueryData<DisplayMessage[]>(roomMessagesKey("room"))![0]!
          .delivery,
      ).toBeUndefined(),
    );
    result.rerender(node(true));
    expect(screen.getByText("전송 완료")).toBeInTheDocument();
    expect(screen.getAllByText("새 메시지")).toHaveLength(1);
    const finished = new Event("beforeunload", { cancelable: true });
    fireEvent(window, finished);
    expect(finished.defaultPrevented).toBe(false);
    result.unmount();
    client.clear();
  });
  it("reconnecting drains the same client ID and never duplicates an early realtime acknowledgment", async () => {
    const client = new QueryClient();
    const send = createSend();
    const node = () => (
      <QueryClientProvider client={client}>
        <Screen send={send} />
      </QueryClientProvider>
    );
    const result = render(node());
    fireEvent.click(screen.getByText("전송"));
    const pending = client.getQueryData<DisplayMessage[]>(
      roomMessagesKey("room"),
    )![0]!;
    act(() =>
      client.setQueryData(roomMessagesKey("room"), [
        { ...pending, id: "already-saved", seq: 1, delivery: undefined },
      ]),
    );
    online(true);
    mocks.connection = "connected";
    result.rerender(node());
    await waitFor(() =>
      expect(screen.getByText("전송 완료")).toBeInTheDocument(),
    );
    expect(send).toHaveBeenCalledWith({
      roomId: "room",
      clientId: pending.clientId,
      body: pending.body,
    });
    expect(
      client.getQueryData<DisplayMessage[]>(roomMessagesKey("room")),
    ).toHaveLength(1);
    result.unmount();
    client.clear();
  });
});
