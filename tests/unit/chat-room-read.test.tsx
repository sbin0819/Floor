import { act, render, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Activity, type ReactNode } from "react";
import {
  useRoomRead,
  type MarkRoomRead,
} from "@/features/chat/components/use-room-read";
import { CHAT_NAV_KEY } from "@/features/chat/nav-state";

vi.mock("@/features/chat/actions", () => ({ markRoomRead: vi.fn() }));

function setup(
  initial: {
    visibleSeq: number | null;
    knownReadSeq: number | null;
    blocked: boolean;
    roomId: string;
  },
  mark = vi.fn<MarkRoomRead>(async ({ seq }) => ({
    ok: true,
    data: { lastReadSeq: seq },
  })),
) {
  const client = new QueryClient();
  client.setQueryData(CHAT_NAV_KEY, {
    spaces: [
      {
        id: "space",
        name: "팀",
        initial: "팀",
        kind: "team",
        unread: true,
        muted: false,
        unreadMentions: 0,
        channels: [
          {
            id: "room",
            name: "일반",
            unread: true,
            muted: false,
            unreadMentions: 0,
          },
        ],
      },
    ],
    directMessages: [],
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const result = renderHook((props) => useRoomRead({ ...props, mark }), {
    initialProps: initial,
    wrapper,
  });
  return { ...result, mark, client };
}
const initial = {
  roomId: "room",
  visibleSeq: 5,
  knownReadSeq: 1,
  blocked: false,
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("room read cursor", () => {
  it("preserves an acknowledged cursor across Activity hiding and restoration", async () => {
    const client = new QueryClient();
    const mark = vi.fn<MarkRoomRead>(async ({ seq }) => ({
      ok: true,
      data: { lastReadSeq: seq },
    }));
    function Reader() {
      useRoomRead({ ...initial, mark });
      return null;
    }
    const tree = (hidden: boolean) => (
      <QueryClientProvider client={client}>
        <Activity mode={hidden ? "hidden" : "visible"}>
          <Reader />
        </Activity>
      </QueryClientProvider>
    );
    const result = render(tree(false));
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(mark).toHaveBeenCalledOnce();
    result.rerender(tree(true));
    result.rerender(tree(false));
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(mark).toHaveBeenCalledOnce();
  });
  it("debounces the highest visible sequence and clears nav optimistically without duplicates", async () => {
    const result = setup(initial);
    await act(() => vi.advanceTimersByTimeAsync(500));
    result.rerender({ ...initial, visibleSeq: 8 });
    await act(() => vi.advanceTimersByTimeAsync(999));
    expect(result.mark).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(result.mark).toHaveBeenCalledExactlyOnceWith({
      roomId: "room",
      seq: 8,
    });
    expect(result.client.getQueryData(CHAT_NAV_KEY)).toMatchObject({
      spaces: [{ unread: false, channels: [{ unread: false }] }],
      directMessages: [],
    });
    result.rerender({ ...initial, visibleSeq: 6 });
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(result.mark).toHaveBeenCalledOnce();
  });
  it("does not submit a known server or just-sent cursor, or a message outside the viewport", async () => {
    const result = setup({ ...initial, knownReadSeq: 5 });
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(result.mark).not.toHaveBeenCalled();
    result.rerender({ ...initial, visibleSeq: null, knownReadSeq: 0 });
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(result.mark).not.toHaveBeenCalled();
  });
  it("waits while sends or an offline queue are pending", async () => {
    const result = setup({ ...initial, blocked: true });
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(result.mark).not.toHaveBeenCalled();
    result.rerender(initial);
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(result.mark).toHaveBeenCalledExactlyOnceWith({
      roomId: "room",
      seq: 5,
    });
  });
  it("does not mark a hidden tab and starts a new debounce on visibility", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const result = setup(initial);
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(result.mark).not.toHaveBeenCalled();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(result.mark).toHaveBeenCalledOnce();
  });
  it("cancels a pending mark on unmount and does not loop after failure", async () => {
    const mark = vi
      .fn<MarkRoomRead>()
      .mockResolvedValue({ ok: false, code: "INTERNAL" });
    const result = setup(initial, mark);
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(mark).toHaveBeenCalledOnce();
    result.rerender({ ...initial, visibleSeq: 9 });
    result.unmount();
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(mark).toHaveBeenCalledOnce();
  });
  it("serializes a later cursor behind the inflight mark", async () => {
    let finish!: (value: Awaited<ReturnType<MarkRoomRead>>) => void;
    const mark = vi
      .fn<MarkRoomRead>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockImplementation(async ({ seq }) => ({
        ok: true,
        data: { lastReadSeq: seq },
      }));
    const result = setup(initial, mark);
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    result.rerender({ ...initial, visibleSeq: 7 });
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(mark).toHaveBeenCalledOnce();
    await act(async () => finish({ ok: true, data: { lastReadSeq: 5 } }));
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(mark).toHaveBeenLastCalledWith({ roomId: "room", seq: 7 });
  });
  it("retries a failed cursor only after leaving and returning to the viewport or visible tab", async () => {
    const mark = vi
      .fn<MarkRoomRead>()
      .mockResolvedValueOnce({ ok: false, code: "INTERNAL" })
      .mockResolvedValueOnce({ ok: false, code: "INTERNAL" })
      .mockResolvedValue({ ok: true, data: { lastReadSeq: 5 } });
    const result = setup(initial, mark);
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(mark).toHaveBeenCalledOnce();
    result.rerender({ ...initial, visibleSeq: null });
    result.rerender(initial);
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(mark).toHaveBeenCalledTimes(2);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(mark).toHaveBeenCalledTimes(2);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(mark).toHaveBeenCalledTimes(3);
    result.rerender({ ...initial, visibleSeq: null });
    result.rerender(initial);
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(mark).toHaveBeenCalledTimes(3);
  });
});
