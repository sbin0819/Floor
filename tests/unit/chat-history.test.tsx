import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Activity, type ReactNode } from "react";
import { useMessageHistory } from "@/features/chat/components/use-message-history";
import { fetchRoomMessagesPage } from "@/features/chat/client";
import { roomMessagesKey } from "@/features/chat/components/message-state";
import type { ChatMessage, RoomMessagesPage } from "@/features/chat/types";
import { emptyMessageDetails } from "@/features/chat/types";

vi.mock("@/features/chat/client", () => ({ fetchRoomMessagesPage: vi.fn() }));
function message(seq: number): ChatMessage {
  return {
    ...emptyMessageDetails(),
    id: `m-${seq}`,
    seq,
    kind: "text",
    body: `메시지 ${seq}`,
    authorId: "other",
    authorName: "이서연",
    clientId: null,
    createdAt: "2026-10-08T03:00:00Z",
  };
}
function page(messages: ChatMessage[], hasMore = false): RoomMessagesPage {
  return {
    messages,
    hasMore,
    lastSeq: 101,
    peerReadSeq: null,
    firstUnreadSeq: 75,
    lastReadSeq: 74,
  };
}
function setup() {
  const client = new QueryClient();
  client.setQueryData(roomMessagesKey("room"), [message(101)]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return {
    client,
    ...renderHook(
      ({ room, oldest, version }) =>
        useMessageHistory(room, "me", oldest, version),
      { initialProps: { room: "room", oldest: 101, version: 0 }, wrapper },
    ),
  };
}
beforeEach(() => {
  vi.mocked(fetchRoomMessagesPage).mockReset();
});
describe("older message pages", () => {
  it("cancels hidden Activity reads and allows loading again when restored", async () => {
    vi.mocked(fetchRoomMessagesPage).mockReturnValue(new Promise(() => {}));
    const client = new QueryClient();
    function History() {
      const history = useMessageHistory("room", "me", 101, 0);
      return (
        <button
          disabled={history.loading}
          onClick={() => void history.loadOlder()}
        >
          이전 읽기
        </button>
      );
    }
    const tree = (hidden: boolean) => (
      <QueryClientProvider client={client}>
        <Activity mode={hidden ? "hidden" : "visible"}>
          <History />
        </Activity>
      </QueryClientProvider>
    );
    const result = render(tree(false));
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button")).toBeDisabled();
    const signal = vi.mocked(fetchRoomMessagesPage).mock.calls[0]![2]?.signal;
    result.rerender(tree(true));
    expect(signal?.aborted).toBe(true);
    result.rerender(tree(false));
    expect(screen.getByRole("button")).toBeEnabled();
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(fetchRoomMessagesPage).toHaveBeenCalledTimes(2));
  });
  it("limits automatic unread seeking even when a page would cross the cap", async () => {
    vi.mocked(fetchRoomMessagesPage).mockResolvedValue(
      page([message(97), message(98), message(99), message(100)]),
    );
    const result = setup();
    await act(() => result.result.current.loadOlder(3));
    expect(
      result.client
        .getQueryData<ChatMessage[]>(roomMessagesKey("room"))
        ?.map((row) => row.seq),
    ).toEqual([99, 100, 101]);
    expect(result.result.current.hasMore).toBe(true);
  });
  it("deduplicates and prepends one request at a time using the shared cache", async () => {
    let finish!: (value: RoomMessagesPage) => void;
    vi.mocked(fetchRoomMessagesPage).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const result = setup();
    act(() => {
      void result.result.current.loadOlder();
      void result.result.current.loadOlder();
    });
    expect(fetchRoomMessagesPage).toHaveBeenCalledOnce();
    expect(fetchRoomMessagesPage).toHaveBeenCalledWith(
      "room",
      { before: 101 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result.result.current.loading).toBe(true);
    await act(async () =>
      finish(page([message(99), message(100), message(101)])),
    );
    expect(
      result.client
        .getQueryData<ChatMessage[]>(roomMessagesKey("room"))
        ?.map((row) => row.seq),
    ).toEqual([99, 100, 101]);
    expect(result.result.current.hasMore).toBe(false);
  });
  it("ignores a late older-page response after a catch-up reset", async () => {
    let finish!: (value: RoomMessagesPage) => void;
    vi.mocked(fetchRoomMessagesPage).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const result = setup();
    act(() => {
      void result.result.current.loadOlder();
    });
    const signal = vi.mocked(fetchRoomMessagesPage).mock.calls[0]![2]?.signal;
    result.rerender({ room: "room", oldest: 101, version: 1 });
    expect(signal?.aborted).toBe(true);
    await act(async () => finish(page([message(100)])));
    expect(
      result.client
        .getQueryData<ChatMessage[]>(roomMessagesKey("room"))
        ?.map((row) => row.seq),
    ).toEqual([101]);
    expect(result.result.current.loading).toBe(false);
  });
  it("does not merge into another room or retry a failed request automatically", async () => {
    vi.mocked(fetchRoomMessagesPage).mockRejectedValue(new Error("network"));
    const result = setup();
    await act(() => result.result.current.loadOlder());
    expect(result.result.current.error).toBe(true);
    expect(fetchRoomMessagesPage).toHaveBeenCalledOnce();
    result.rerender({ room: "other", oldest: 1, version: 0 });
    expect(result.result.current.error).toBe(false);
    expect(result.result.current.hasMore).toBe(false);
    await act(() => result.result.current.loadOlder());
    expect(fetchRoomMessagesPage).toHaveBeenCalledOnce();
  });
});
