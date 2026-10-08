import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatReadError, fetchRoomMessagesPage } from "@/features/chat/client";

const empty = {
  messages: [],
  hasMore: false,
  lastSeq: 0,
  lastReadSeq: null,
  firstUnreadSeq: null,
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("chat page client", () => {
  it("uses the no-store same-origin GET with the requested cursor and abort signal", async () => {
    const fetcher = vi.fn(async () => Response.json(empty));
    vi.stubGlobal("fetch", fetcher);
    const signal = new AbortController().signal;
    await expect(
      fetchRoomMessagesPage("room-a", { before: 51 }, { signal }),
    ).resolves.toEqual(empty);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      "/api/rooms/room-a/messages?before=51",
      { credentials: "same-origin", cache: "no-store", signal },
    );
  });
  it("waits for Retry-After and retries a 429 once", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 429, headers: { "Retry-After": "2" } }),
      )
      .mockResolvedValueOnce(Response.json(empty));
    vi.stubGlobal("fetch", fetcher);
    const request = fetchRoomMessagesPage("room", { after: 5 });
    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(request).resolves.toEqual(empty);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("does not repeatedly retry a second 429", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(
      async () =>
        new Response(null, { status: 429, headers: { "Retry-After": "1" } }),
    );
    vi.stubGlobal("fetch", fetcher);
    const rejected = expect(
      fetchRoomMessagesPage("room", { after: 5 }),
    ).rejects.toEqual(new ChatReadError(429));
    await vi.advanceTimersByTimeAsync(1_000);
    await rejected;
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("cancels waiting retries when the screen leaves", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(
      async () =>
        new Response(null, { status: 429, headers: { "Retry-After": "3" } }),
    );
    vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController();
    const rejected = expect(
      fetchRoomMessagesPage(
        "room",
        { after: 5 },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await rejected;
    await vi.runAllTimersAsync();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([401, 404, 500])(
    "returns a fixed error for %s without response diagnostics",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("private diagnostics", { status })),
      );
      await expect(fetchRoomMessagesPage("room", { after: 0 })).rejects.toEqual(
        new ChatReadError(status),
      );
    },
  );
  it("rejects malformed responses and strips unrecognized fields", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ ...empty, email: "private@example.test" }),
      )
      .mockResolvedValueOnce(Response.json({ messages: "incorrect" }));
    vi.stubGlobal("fetch", fetcher);
    await expect(fetchRoomMessagesPage("room", { after: 0 })).resolves.toEqual(
      empty,
    );
    await expect(fetchRoomMessagesPage("room", { after: 0 })).rejects.toEqual(
      new ChatReadError(502),
    );
  });
});
