import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMessageRequestQueue,
  requestMessagePage,
} from "@/features/chat/message-requests";
import {
  ChatReadError,
  type RoomMessagesPage,
  type fetchRoomMessagesPage,
} from "@/features/chat/client";

const page: RoomMessagesPage = {
  messages: [],
  hasMore: false,
  lastSeq: 1,
  lastReadSeq: null,
  firstUnreadSeq: null,
};
function deferred() {
  let resolve!: (value: RoomMessagesPage) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<RoomMessagesPage>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const flush = () => vi.advanceTimersByTimeAsync(0);
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("shared message request queue", () => {
  it("runs one request at a time and merges identical room/cursor requests", async () => {
    const pending = deferred();
    const load = vi
      .fn<typeof fetchRoomMessagesPage>()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(page);
    const queue = createMessageRequestQueue(load);
    const first = queue.request("room", { before: 51 });
    const duplicate = queue.request("room", { before: 51 });
    const second = queue.request("room", { after: 51 });
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith(
      "room",
      { before: 51 },
      { signal: expect.any(AbortSignal), retry: false },
    );
    pending.resolve(page);
    await expect(first).resolves.toBe(page);
    await expect(duplicate).resolves.toBe(page);
    await expect(second).resolves.toBe(page);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("shares queue lifetime per QueryClient while keeping other clients independent", async () => {
    const pending = deferred();
    const fetcher = vi
      .fn()
      .mockImplementationOnce(async () => Response.json(await pending.promise))
      .mockResolvedValue(Response.json(page));
    vi.stubGlobal("fetch", fetcher);
    const client = new QueryClient();
    const other = new QueryClient();
    const first = requestMessagePage(client, "room", { before: 51 });
    const same = requestMessagePage(client, "room", { before: 51 });
    const another = requestMessagePage(other, "room", { before: 51 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    pending.resolve(page);
    await expect(Promise.all([first, same, another])).resolves.toEqual([
      page,
      page,
      page,
    ]);
  });

  it("cancels one waiter without cancelling another reader of the same request", async () => {
    const pending = deferred();
    const load = vi
      .fn<typeof fetchRoomMessagesPage>()
      .mockReturnValue(pending.promise);
    const queue = createMessageRequestQueue(load);
    const firstSignal = new AbortController();
    const secondSignal = new AbortController();
    const first = queue.request(
      "room",
      { before: 51 },
      { signal: firstSignal.signal },
    );
    const cancelled = expect(first).rejects.toMatchObject({
      name: "AbortError",
    });
    const second = queue.request(
      "room",
      { before: 51 },
      { signal: secondSignal.signal },
    );
    firstSignal.abort();
    await cancelled;
    expect(load.mock.calls[0]?.[2]?.signal?.aborted).toBe(false);
    pending.resolve(page);
    await expect(second).resolves.toBe(page);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("starts the next request after the last waiter aborts even if the loader ignores abort", async () => {
    const never = deferred();
    const load = vi
      .fn<typeof fetchRoomMessagesPage>()
      .mockReturnValueOnce(never.promise)
      .mockResolvedValue(page);
    const queue = createMessageRequestQueue(load);
    const controller = new AbortController();
    const first = queue.request(
      "room",
      { before: 51 },
      { signal: controller.signal },
    );
    const cancelled = expect(first).rejects.toMatchObject({
      name: "AbortError",
    });
    const next = queue.request("room", { before: 101 });
    controller.abort();
    await cancelled;
    await expect(next).resolves.toBe(page);
    expect(load.mock.calls[0]?.[2]?.signal?.aborted).toBe(true);
    expect(load).toHaveBeenCalledTimes(2);
    never.resolve({ ...page, lastSeq: 900 });
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not let an aborted request consume a replacement with the same key", async () => {
    const stale = deferred();
    const fresh = deferred();
    const load = vi
      .fn<typeof fetchRoomMessagesPage>()
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(fresh.promise);
    const queue = createMessageRequestQueue(load);
    const controller = new AbortController();
    const old = queue.request(
      "room",
      { after: 0 },
      { signal: controller.signal },
    );
    const cancelled = expect(old).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    const latest = queue.request("room", { after: 0 });
    await cancelled;
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    stale.resolve({ ...page, lastSeq: 2 });
    fresh.resolve({ ...page, lastSeq: 3 });
    await expect(latest).resolves.toEqual({ ...page, lastSeq: 3 });
  });

  it("removes cancelled queued entries and rejects already aborted callers without a request", async () => {
    const pending = deferred();
    const load = vi
      .fn<typeof fetchRoomMessagesPage>()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(page);
    const queue = createMessageRequestQueue(load);
    const controller = new AbortController();
    const first = queue.request("room", { after: 0 });
    const queued = queue.request(
      "room",
      { after: 1 },
      { signal: controller.signal },
    );
    const cancelled = expect(queued).rejects.toMatchObject({
      name: "AbortError",
    });
    controller.abort();
    await cancelled;
    await expect(
      queue.request("room", { after: 2 }, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    pending.resolve(page);
    await first;
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("limits actual HTTP attempts to fifty in a rolling minute", async () => {
    const load = vi.fn<typeof fetchRoomMessagesPage>().mockResolvedValue(page);
    const queue = createMessageRequestQueue(load);
    const results = Array.from({ length: 51 }, (_, after) =>
      queue.request("room", { after }),
    );
    await flush();
    expect(load).toHaveBeenCalledTimes(50);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(load).toHaveBeenCalledTimes(50);
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all(results);
    expect(load).toHaveBeenCalledTimes(51);
  });

  it("spaces background starts two seconds apart and prioritizes user requests without interrupting active work", async () => {
    const pending = deferred();
    const load = vi
      .fn<typeof fetchRoomMessagesPage>()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(page);
    const queue = createMessageRequestQueue(load);
    const first = queue.request("room", { before: 51 }, { background: true });
    const background = queue.request(
      "room",
      { before: 101 },
      { background: true },
    );
    const user = queue.request("room", { before: 151 });
    expect(load).toHaveBeenCalledTimes(1);
    pending.resolve(page);
    await first;
    await user;
    expect(load.mock.calls.map(([, query]) => query)).toEqual([
      { before: 51 },
      { before: 151 },
    ]);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await background;
    expect(load.mock.calls[2]?.[1]).toEqual({ before: 101 });
  });

  it("promotes a shared pending background page when a user explicitly requests it", async () => {
    const pending = deferred();
    const load = vi
      .fn<typeof fetchRoomMessagesPage>()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(page);
    const queue = createMessageRequestQueue(load);
    const first = queue.request("room", { before: 51 }, { background: true });
    const oldBackground = queue.request(
      "room",
      { before: 101 },
      { background: true },
    );
    const promotedBackground = queue.request(
      "room",
      { before: 151 },
      { background: true },
    );
    const foreground = queue.request("room", { before: 151 });
    pending.resolve(page);
    await Promise.all([first, promotedBackground, foreground]);
    expect(load.mock.calls.map(([, query]) => query)).toEqual([
      { before: 51 },
      { before: 151 },
    ]);
    await vi.advanceTimersByTimeAsync(2_000);
    await oldBackground;
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("routes a 429 retry through the same global cooldown and user-priority queue", async () => {
    const load = vi
      .fn<typeof fetchRoomMessagesPage>()
      .mockRejectedValueOnce(new ChatReadError(429, 3_000))
      .mockResolvedValue(page);
    const queue = createMessageRequestQueue(load);
    const background = queue.request(
      "room",
      { before: 51 },
      { background: true },
    );
    const foreground = queue.request("room", { after: 1 });
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all([background, foreground]);
    expect(load.mock.calls.map(([, query]) => query)).toEqual([
      { before: 51 },
      { after: 1 },
      { before: 51 },
    ]);
    expect(
      load.mock.calls.every(([, , options]) => options?.retry === false),
    ).toBe(true);
  });

  it("respects a second 429 cooldown for other entries even when the failing entry exhausts its retry", async () => {
    const error = new ChatReadError(429, 4_000);
    const load = vi
      .fn<typeof fetchRoomMessagesPage>()
      .mockRejectedValueOnce(new ChatReadError(429, 1_000))
      .mockRejectedValueOnce(error)
      .mockResolvedValue(page);
    const queue = createMessageRequestQueue(load);
    const first = queue.request("room", { after: 0 });
    const rejected = expect(first).rejects.toBe(error);
    const second = queue.request("room", { after: 1 });
    await flush();
    await vi.advanceTimersByTimeAsync(1_000);
    await rejected;
    expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3_999);
    expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await expect(second).resolves.toBe(page);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("counts a retry towards the fifty-attempt budget instead of bypassing the scheduler", async () => {
    const load = vi.fn<typeof fetchRoomMessagesPage>().mockResolvedValue(page);
    const queue = createMessageRequestQueue(load);
    await Promise.all(
      Array.from({ length: 49 }, (_, after) =>
        queue.request("room", { after }),
      ),
    );
    load.mockRejectedValueOnce(new ChatReadError(429, 1_000));
    const last = queue.request("room", { after: 49 });
    await flush();
    expect(load).toHaveBeenCalledTimes(50);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(load).toHaveBeenCalledTimes(50);
    await vi.advanceTimersByTimeAsync(1);
    await expect(last).resolves.toBe(page);
    expect(load).toHaveBeenCalledTimes(51);
  });

  it("preserves ordinary errors and continues after a synchronous loader failure", async () => {
    const error = new Error("ordinary read failure");
    const load = vi
      .fn<typeof fetchRoomMessagesPage>()
      .mockImplementationOnce(() => {
        throw error;
      })
      .mockResolvedValue(page);
    const queue = createMessageRequestQueue(load);
    const first = queue.request("room", { after: 0 });
    const rejected = expect(first).rejects.toBe(error);
    const second = queue.request("room", { after: 1 });
    await rejected;
    await expect(second).resolves.toBe(page);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
