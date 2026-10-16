import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAblyBrowserRealtime,
  type BrowserRealtime,
} from "@/lib/realtime/ably-browser";
import { ApiError } from "@/lib/http/errors";
import type { BrowserAuthCallback } from "@/lib/realtime/ably-browser-client";
import type { RealtimeEvent } from "@/lib/realtime/types";

import {
  createFakeAblyBrowser,
  fakeTokenFor,
  fakeTokenRequest,
} from "./ably-test-client";

const event: RealtimeEvent = {
  authorAvatar: { color: "blue" as const, photoUrl: null },
  attachments: [],
  type: "message.created",
  roomId: "a",
  id: "message-a",
  seq: 1,
  authorId: "user-a",
  authorName: "김서연",
  clientId: "client-a",
  kind: "text",
  systemData: null,
  body: "안녕하세요",
  createdAt: "2026-10-08T00:00:00Z",
  replyTo: null,
  mentions: [],
  mentionsEveryone: false,
  editedAt: null,
  deletedAt: null,
  reactions: [],
};
const cleanup: BrowserRealtime[] = [];

function setup() {
  const fake = createFakeAblyBrowser();
  const requestToken = vi.fn(
    async (input: Parameters<typeof fakeTokenFor>[0]) => fakeTokenFor(input),
  );
  const realtime = createAblyBrowserRealtime({
    loadClient: fake.loadClient,
    requestToken,
  });
  cleanup.push(realtime);
  return { ...fake, requestToken, realtime };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const realtime of cleanup.splice(0)) realtime.close();
  vi.useRealTimers();
});

describe("Ably browser connection ownership", () => {
  it.each(
    (["preflight", "renewal"] as const).flatMap((phase) =>
      (["scope", "rights", "restart"] as const).flatMap((change) =>
        [401, 503].map((status) => ({ phase, change, status })),
      ),
    ),
  )(
    "ignores late $status from obsolete $phase after $change even if abort is ignored",
    async ({ phase, change, status }) => {
      const { realtime, requestToken, client } = setup();
      const pending = Promise.withResolvers<typeof fakeTokenRequest>();
      const stop = realtime.subscribe("room:a", vi.fn());
      if (phase === "renewal") {
        realtime.start();
        await vi.runAllTimersAsync();
      }
      requestToken.mockReturnValueOnce(pending.promise);
      if (phase === "preflight") realtime.start();
      else realtime.reauthorize?.();
      await vi.advanceTimersByTimeAsync(25);
      if (change === "scope") {
        stop();
        realtime.subscribe("room:b", vi.fn());
      } else if (change === "rights") {
        realtime.reauthorize?.();
      } else {
        realtime.close();
        realtime.start();
      }
      pending.reject(new ApiError("http", { status }));
      await vi.runAllTimersAsync();
      expect(realtime.getSnapshot()).toBe("connected");
      expect(requestToken).toHaveBeenCalledTimes(phase === "preflight" ? 2 : 3);
      expect(
        client.channel(change === "scope" ? "room:b" : "room:a").subscribe,
      ).toHaveBeenCalled();
      expect(client.close).toHaveBeenCalledTimes(
        change === "restart" && phase === "renewal" ? 1 : 0,
      );
    },
  );
  it("aborts an obsolete preflight and starts only the latest scope without disabling auth", async () => {
    const fake = createFakeAblyBrowser();
    const signals: AbortSignal[] = [];
    const requestToken = vi.fn(
      async (
        input: Parameters<typeof fakeTokenFor>[0],
        signal?: AbortSignal,
      ) => {
        signals.push(signal!);
        if (signals.length === 1)
          return await new Promise<typeof fakeTokenRequest>(
            (_resolve, reject) => {
              signal!.addEventListener(
                "abort",
                () => reject(new DOMException("Cancelled", "AbortError")),
                { once: true },
              );
            },
          );
        return fakeTokenFor(input);
      },
    );
    const realtime = createAblyBrowserRealtime({
      loadClient: fake.loadClient,
      requestToken,
    });
    cleanup.push(realtime);
    const stop = realtime.subscribe("room:a", vi.fn());
    realtime.start();
    await vi.advanceTimersByTimeAsync(25);
    stop();
    realtime.subscribe("room:b", vi.fn());
    expect(signals[0]!.aborted).toBe(true);
    await vi.runAllTimersAsync();
    expect(requestToken).toHaveBeenCalledTimes(2);
    expect(fake.client.channel("room:a").subscribe).not.toHaveBeenCalled();
    expect(fake.client.channel("room:b").subscribe).toHaveBeenCalledTimes(1);
    expect(realtime.getSnapshot()).toBe("connected");
  });

  it("cancels a pending renewal on close and calls the SDK callback once", async () => {
    const fake = createFakeAblyBrowser();
    let auth: BrowserAuthCallback | undefined;
    let pendingSignal: AbortSignal | undefined;
    const requestToken = vi.fn<
      (
        input: Parameters<typeof fakeTokenFor>[0],
        signal?: AbortSignal,
      ) => Promise<typeof fakeTokenRequest>
    >(async (input) => fakeTokenFor(input));
    const realtime = createAblyBrowserRealtime({
      loadClient: async (callback) => {
        auth = callback;
        return fake.loadClient(callback);
      },
      requestToken,
    });
    cleanup.push(realtime);
    realtime.subscribe("room:a", vi.fn());
    realtime.start();
    await vi.runAllTimersAsync();
    requestToken.mockImplementationOnce(
      (_input, signal) =>
        new Promise((_resolve, reject) => {
          pendingSignal = signal;
          signal!.addEventListener(
            "abort",
            () => reject(new DOMException("Cancelled", "AbortError")),
            { once: true },
          );
        }),
    );
    const callback = vi.fn();
    auth!(callback);
    expect(pendingSignal?.aborted).toBe(false);
    realtime.close();
    expect(pendingSignal?.aborted).toBe(true);
    await vi.runAllTimersAsync();
    expect(callback).toHaveBeenCalledExactlyOnceWith(
      "실시간 연결이 종료되었어요.",
      null,
    );
    expect(realtime.getSnapshot()).toBe("closed");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retries a cancelled renewal with current rights instead of failing the SDK callback", async () => {
    const { realtime, requestToken, client } = setup();
    realtime.subscribe("room:a", vi.fn());
    realtime.start();
    await vi.runAllTimersAsync();
    let signal: AbortSignal | undefined;
    const pending = vi.fn(
      (
        _input: Parameters<typeof fakeTokenFor>[0],
        requestSignal?: AbortSignal,
      ) =>
        new Promise<typeof fakeTokenRequest>((_resolve, reject) => {
          signal = requestSignal;
          signal!.addEventListener(
            "abort",
            () => reject(new DOMException("Cancelled", "AbortError")),
            { once: true },
          );
        }),
    );
    requestToken.mockImplementationOnce(pending);
    realtime.reauthorize?.();
    await vi.advanceTimersByTimeAsync(25);
    realtime.reauthorize?.();
    expect(signal?.aborted).toBe(true);
    await vi.runAllTimersAsync();
    expect(realtime.getSnapshot()).toBe("connected");
    expect(client.close).not.toHaveBeenCalled();
    expect(requestToken).toHaveBeenCalledTimes(3);
  });
  it("subscribes only to granted floor channels, reuses the grant during navigation, and detaches a revoked floor", async () => {
    const { realtime, requestToken, client } = setup();
    requestToken.mockResolvedValue({
      ...fakeTokenRequest,
      capability: JSON.stringify({
        "user:user-a": ["subscribe"],
        "floor:a": ["subscribe"],
        "floor:b": ["subscribe"],
      }),
    });
    const first = vi.fn();
    const stop = realtime.subscribe("floor:a", first);
    realtime.subscribe("floor:denied", vi.fn());
    const presence = realtime.observePresence("floor:a", vi.fn());
    presence.update({ typing: true });
    realtime.start();
    await vi.runAllTimersAsync();
    expect(requestToken).toHaveBeenCalledExactlyOnceWith(
      { rooms: [], spaces: [] },
      expect.any(AbortSignal),
    );
    expect(client.channel("floor:a").subscribe).toHaveBeenCalledTimes(1);
    expect(client.channel("floor:denied").subscribe).not.toHaveBeenCalled();
    expect(client.channel("floor:a").presence.enter).not.toHaveBeenCalled();
    client
      .channel("floor:a")
      .emit({ type: "booking.changed", spaceId: "space-a" });
    expect(first).toHaveBeenCalledExactlyOnceWith({
      type: "booking.changed",
      spaceId: "space-a",
    });
    stop();
    presence.close();
    realtime.subscribe("floor:b", vi.fn());
    await vi.runAllTimersAsync();
    expect(requestToken).toHaveBeenCalledTimes(1);
    expect(client.channel("floor:a").detach).toHaveBeenCalledTimes(1);
    expect(client.channel("floor:b").subscribe).toHaveBeenCalledTimes(1);
    requestToken.mockResolvedValue(fakeTokenFor({ rooms: [] }));
    realtime.reauthorize?.();
    await vi.runAllTimersAsync();
    expect(client.channel("floor:b").detach).toHaveBeenCalledTimes(1);
    expect(realtime.getScopeSnapshot?.().channels).not.toContain("floor:b");
  });
  it("discards a preflight token invalidated by reauthorization with unchanged room input", async () => {
    const { realtime, requestToken, client } = setup();
    const pending = Promise.withResolvers<typeof fakeTokenRequest>();
    requestToken
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(fakeTokenFor({ rooms: [] }));
    realtime.subscribe("user:user-a", vi.fn());
    realtime.subscribe("room:revoked", vi.fn());
    realtime.start();
    await vi.advanceTimersByTimeAsync(25);
    realtime.reauthorize?.();
    pending.resolve(fakeTokenFor({ rooms: ["revoked"] }));
    await vi.runAllTimersAsync();
    expect(requestToken).toHaveBeenCalledTimes(2);
    expect(requestToken.mock.calls.map(([input]) => input.rooms)).toEqual([
      ["revoked"],
      ["revoked"],
    ]);
    expect(client.channel("room:revoked").subscribe).not.toHaveBeenCalled();
    expect(realtime.getScopeSnapshot?.().channels).toEqual(["user:user-a"]);
  });
  it("does not overwrite a second reauthorization with an older pending renewal response", async () => {
    const { realtime, requestToken, client } = setup();
    realtime.subscribe("user:user-a", vi.fn());
    realtime.subscribe("room:revoked", vi.fn());
    realtime.start();
    await vi.runAllTimersAsync();
    const pending = Promise.withResolvers<typeof fakeTokenRequest>();
    requestToken
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(fakeTokenFor({ rooms: [] }));
    realtime.reauthorize?.();
    await vi.advanceTimersByTimeAsync(25);
    realtime.reauthorize?.();
    pending.resolve(fakeTokenFor({ rooms: ["revoked"] }));
    await vi.runAllTimersAsync();
    expect(requestToken).toHaveBeenCalledTimes(3);
    expect(client.channel("room:revoked").subscribe).toHaveBeenCalledTimes(1);
    expect(client.channel("room:revoked").detach).toHaveBeenCalledTimes(1);
    expect(realtime.getScopeSnapshot?.().channels).toEqual(["user:user-a"]);
  });
  it("authorizes presence without a message consumer and leaves before detach even when leave rejects", async () => {
    const { realtime, requestToken, client, calls } = setup();
    const presence = client.channel("room:a").presence;
    presence.leave.mockImplementation(async () => {
      calls.push("leave:room:a");
      throw new Error("private details");
    });
    const observer = realtime.observePresence("room:a", vi.fn());
    observer.update({ typing: true, name: "김서연" });
    realtime.start();
    await vi.runAllTimersAsync();
    expect(requestToken).toHaveBeenCalledExactlyOnceWith(
      { rooms: ["a"], spaces: [] },
      expect.any(AbortSignal),
    );
    expect(presence.enter).toHaveBeenCalledExactlyOnceWith({
      typing: true,
      name: "김서연",
    });
    observer.close();
    await vi.runAllTimersAsync();
    expect(calls.indexOf("leave:room:a")).toBeLessThan(
      calls.indexOf("detach:room:a"),
    );
    const next = realtime.observePresence("room:b", vi.fn());
    next.update({ typing: true });
    await vi.runAllTimersAsync();
    expect(
      client.channel("room:b").presence.enter,
    ).toHaveBeenCalledExactlyOnceWith({ typing: true });
  });
  it("never enters presence when the returned token grants only subscribe", async () => {
    const { realtime, requestToken, client } = setup();
    requestToken.mockResolvedValue({
      ...fakeTokenRequest,
      capability: JSON.stringify({ "room:a": ["subscribe"] }),
    });
    const observer = realtime.observePresence("room:a", vi.fn());
    observer.update({ typing: true });
    realtime.start();
    await vi.runAllTimersAsync();
    expect(client.channel("room:a").subscribe).toHaveBeenCalledTimes(1);
    expect(client.channel("room:a").presence.enter).not.toHaveBeenCalled();
    expect(client.channel("room:a").presence.subscribe).not.toHaveBeenCalled();
  });
  it("releases the last presence observer without detaching a remaining message subscriber", async () => {
    const { realtime, client } = setup();
    realtime.subscribe("room:a", vi.fn());
    const observer = realtime.observePresence("room:a", vi.fn());
    observer.update({ typing: true });
    realtime.start();
    await vi.runAllTimersAsync();
    observer.close();
    await vi.runAllTimersAsync();
    const channel = client.channel("room:a");
    expect(channel.presence.leave).toHaveBeenCalledTimes(1);
    expect(channel.presence.unsubscribe).toHaveBeenCalledTimes(1);
    expect(channel.detach).not.toHaveBeenCalled();
  });
  it("does not reuse a preflight token when the room changes before the SDK starts authentication", async () => {
    const { realtime, client, loadClient, requestToken, emitConnection } =
      setup();
    const originalLoad = loadClient.getMockImplementation()!;
    const authorized: string[] = [];
    let finishLoad: (() => void) | undefined;
    loadClient.mockImplementation(async (callback: BrowserAuthCallback) => {
      const sdk = await originalLoad((reply) =>
        callback((error, token) => {
          if (token) authorized.push(token.capability);
          reply(error, token);
        }),
      );
      await new Promise<void>((resolve) => {
        finishLoad = resolve;
      });
      return sdk;
    });
    // 실제 SDK도 connect 뒤의 작업을 다음 틱에 시작하므로 authorize가 먼저 올 수 있다.
    client.connect.mockImplementation(() => {
      setTimeout(
        () => emitConnection({ previous: "connecting", current: "connected" }),
        0,
      );
    });
    realtime.subscribe("user:user-a", vi.fn());
    realtime.start();
    await vi.advanceTimersByTimeAsync(25);
    realtime.subscribe("room:late", vi.fn());
    finishLoad?.();
    await vi.runAllTimersAsync();
    expect(requestToken.mock.calls.map(([input]) => input)).toEqual([
      { rooms: [], spaces: [] },
      { rooms: ["late"], spaces: [] },
    ]);
    expect(authorized).toEqual([fakeTokenFor({ rooms: ["late"] }).capability]);
    expect(client.channel("room:late").subscribe).toHaveBeenCalledTimes(1);
  });

  it("subscribes only to exact granted channels and does not repeatedly request denied rooms", async () => {
    const { realtime, client, requestToken } = setup();
    requestToken.mockResolvedValue({
      ...fakeTokenRequest,
      capability: JSON.stringify({
        "user:user-a": ["subscribe"],
        "room:a": ["presence"],
        "room:*": ["subscribe"],
      }),
    });
    realtime.subscribe("user:user-a", vi.fn());
    realtime.subscribe("room:a", vi.fn());
    realtime.subscribe("room:b", vi.fn());
    realtime.start();
    await vi.runAllTimersAsync();
    expect(client.channel("user:user-a").subscribe).toHaveBeenCalledTimes(1);
    expect(client.channel("room:a").subscribe).not.toHaveBeenCalled();
    expect(client.channel("room:b").subscribe).not.toHaveBeenCalled();
    expect(requestToken).toHaveBeenCalledTimes(1);
  });

  it("recreates the SDK when a failed channel rejects detach and continues to the next room", async () => {
    const { realtime, client, loadClient, requestToken } = setup();
    const stop = realtime.subscribe("room:a", vi.fn());
    realtime.start();
    await vi.runAllTimersAsync();
    client
      .channel("room:a")
      .detach.mockRejectedValue(new Error("failed channel"));
    stop();
    const receive = vi.fn();
    realtime.subscribe("room:b", receive);
    await vi.runAllTimersAsync();
    expect(client.close).toHaveBeenCalledTimes(1);
    expect(loadClient).toHaveBeenCalledTimes(2);
    expect(client.channel("room:a").detach).toHaveBeenCalledTimes(1);
    expect(client.channel("room:b").subscribe).toHaveBeenCalledTimes(1);
    expect(requestToken).toHaveBeenLastCalledWith(
      { rooms: ["b"], spaces: [] },
      expect.any(AbortSignal),
    );
    client.channel("room:b").emit({ ...event, roomId: "b" });
    expect(receive).toHaveBeenCalledExactlyOnceWith({ ...event, roomId: "b" });
  });

  it("retries a rejected subscription with a fresh connection without retaining its old listener", async () => {
    const { realtime, client, loadClient } = setup();
    client
      .channel("room:a")
      .subscribe.mockRejectedValueOnce(new Error("failed channel"));
    const receive = vi.fn();
    realtime.subscribe("room:a", receive);
    realtime.start();
    await vi.runAllTimersAsync();
    expect(client.close).toHaveBeenCalledTimes(1);
    expect(loadClient).toHaveBeenCalledTimes(2);
    expect(client.channel("room:a").subscribe).toHaveBeenCalledTimes(2);
    client.channel("room:a").emit(event);
    expect(receive).toHaveBeenCalledExactlyOnceWith(event);
  });

  it("bounds permanent subscription failures and still releases that room on navigation", async () => {
    const { realtime, client, loadClient } = setup();
    const bad = client.channel("room:a");
    bad.subscribe.mockRejectedValue(new Error("failed channel"));
    bad.detach.mockRejectedValue(new Error("already failed"));
    const stop = realtime.subscribe("room:a", vi.fn());
    realtime.start();
    await vi.runAllTimersAsync();
    expect(loadClient).toHaveBeenCalledTimes(2);
    expect(bad.subscribe).toHaveBeenCalledTimes(2);
    expect(realtime.getSnapshot()).toBe("disconnected");
    stop();
    realtime.subscribe("room:b", vi.fn());
    await vi.runAllTimersAsync();
    expect(loadClient).toHaveBeenCalledTimes(3);
    expect(bad.detach).toHaveBeenCalledTimes(1);
    expect(client.channel("room:b").subscribe).toHaveBeenCalledTimes(1);
  });

  it("switches the single selected space by detaching before reauthorization", async () => {
    const { realtime, client, requestToken, calls } = setup();
    const stopSpace = realtime.subscribe("space:a", vi.fn());
    const stopRoom = realtime.subscribe("room:one", vi.fn());
    realtime.start();
    await vi.runAllTimersAsync();
    expect(requestToken).toHaveBeenLastCalledWith(
      {
        rooms: ["one"],
        spaces: ["a"],
      },
      expect.any(AbortSignal),
    );
    calls.length = 0;
    stopSpace();
    stopRoom();
    const onEvent = vi.fn();
    realtime.subscribe("space:b", onEvent);
    realtime.subscribe("room:two", vi.fn());
    await vi.runAllTimersAsync();
    expect(requestToken).toHaveBeenLastCalledWith(
      {
        rooms: ["two"],
        spaces: ["b"],
      },
      expect.any(AbortSignal),
    );
    expect(calls.indexOf("detach:space:a")).toBeLessThan(
      calls.indexOf("authorize"),
    );
    expect(calls.indexOf("detach:room:one")).toBeLessThan(
      calls.indexOf("authorize"),
    );
    client.channel("space:b").emit({
      type: "room.activity",
      bookingId: null,
      roomKind: "text",
      preview: null,
      spaceId: "b",
      roomId: "two",
      seq: 1,
      authorId: "other",
    });
    expect(onEvent).toHaveBeenCalledExactlyOnceWith({
      type: "room.activity",
      bookingId: null,
      roomKind: "text",
      preview: null,
      spaceId: "b",
      roomId: "two",
      seq: 1,
      authorId: "other",
    });
    expect(client.channel("space:a").detach).toHaveBeenCalledTimes(1);
  });
  it("does no work before activation and starts just one connection", async () => {
    const { realtime, requestToken, loadClient, client } = setup();
    realtime.subscribe("room:a", vi.fn());
    await vi.runAllTimersAsync();
    expect(requestToken).not.toHaveBeenCalled();
    realtime.start();
    realtime.start();
    await vi.runAllTimersAsync();
    expect(loadClient).toHaveBeenCalledTimes(1);
    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(requestToken).toHaveBeenCalledExactlyOnceWith(
      {
        rooms: ["a"],
        spaces: [],
      },
      expect.any(AbortSignal),
    );
    expect(realtime.getSnapshot()).toBe("connected");
  });

  it("shares one subscription and fans out events until the last subscriber leaves", async () => {
    const { realtime, client, requestToken } = setup();
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = realtime.subscribe("room:a", first);
    const stopSecond = realtime.subscribe("room:a", second);
    realtime.start();
    await vi.runAllTimersAsync();
    const channel = client.channel("room:a");
    expect(channel.subscribe).toHaveBeenCalledTimes(1);
    channel.emit(event);
    expect(first).toHaveBeenCalledExactlyOnceWith(event);
    expect(second).toHaveBeenCalledExactlyOnceWith(event);
    stopFirst();
    stopFirst();
    await vi.runAllTimersAsync();
    expect(channel.detach).not.toHaveBeenCalled();
    expect(requestToken).toHaveBeenCalledTimes(1);
    stopSecond();
    await vi.runAllTimersAsync();
    expect(channel.detach).toHaveBeenCalledTimes(1);
    expect(requestToken).toHaveBeenLastCalledWith(
      { rooms: [], spaces: [] },
      expect.any(AbortSignal),
    );
    channel.emit(event);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("detaches removed rooms before authorizing one debounced set of new rooms", async () => {
    const { realtime, client, requestToken, calls } = setup();
    const stop = realtime.subscribe("room:a", vi.fn());
    realtime.start();
    await vi.runAllTimersAsync();
    calls.length = 0;
    stop();
    realtime.subscribe("room:c", vi.fn());
    realtime.subscribe("room:b", vi.fn());
    realtime.subscribe("room:b", vi.fn());
    realtime.subscribe("user:user-a", vi.fn());
    await vi.runAllTimersAsync();
    expect(calls.indexOf("detach:room:a")).toBeLessThan(
      calls.indexOf("authorize"),
    );
    expect(calls.indexOf("authorize")).toBeLessThan(
      calls.indexOf("subscribe:room:b"),
    );
    expect(client.authorize).toHaveBeenCalledTimes(1);
    expect(requestToken).toHaveBeenLastCalledWith(
      {
        rooms: ["b", "c"],
        spaces: [],
      },
      expect.any(AbortSignal),
    );
    expect(client.channel("room:b").subscribe).toHaveBeenCalledTimes(1);
  });

  it.each([401, 503])(
    "quietly disables %s before loading or connecting the SDK",
    async (status) => {
      const { realtime, requestToken, loadClient } = setup();
      requestToken.mockRejectedValue(new ApiError("http", { status }));
      realtime.start();
      await vi.runAllTimersAsync();
      expect(realtime.getSnapshot()).toBe("disabled");
      expect(loadClient).not.toHaveBeenCalled();
      realtime.subscribe("room:a", vi.fn());
      await vi.runAllTimersAsync();
      expect(requestToken).toHaveBeenCalledTimes(1);
    },
  );

  it.each([401, 503])(
    "closes an existing connection when renewal returns %s",
    async (status) => {
      const { realtime, requestToken, client } = setup();
      realtime.start();
      await vi.runAllTimersAsync();
      requestToken.mockRejectedValue(new ApiError("http", { status }));
      realtime.subscribe("room:a", vi.fn());
      await vi.runAllTimersAsync();
      expect(client.close).toHaveBeenCalledTimes(1);
      expect(realtime.getSnapshot()).toBe("disabled");
    },
  );

  it("lets the SDK retry transient token failures instead of treating them as disabled", async () => {
    const { realtime, requestToken, client } = setup();
    requestToken.mockRejectedValueOnce(new ApiError("http", { status: 500 }));
    realtime.start();
    await vi.runAllTimersAsync();
    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(client.close).not.toHaveBeenCalled();
    expect(realtime.getSnapshot()).toBe("connected");
    expect(requestToken.mock.calls.length).toBeGreaterThan(1);
  });

  it("exports reconnect and attach continuity signals without errors or tokens", async () => {
    const { realtime, emitConnection, client } = setup();
    const lifecycle = vi.fn();
    const state = vi.fn();
    const stopLifecycle = realtime.subscribeLifecycle(lifecycle);
    const stopState = realtime.subscribeState(state);
    realtime.subscribe("room:a", vi.fn());
    realtime.start();
    await vi.runAllTimersAsync();
    emitConnection({ previous: "connected", current: "suspended" });
    expect(realtime.getSnapshot()).toBe("suspended");
    emitConnection({ previous: "suspended", current: "connected" });
    client.channel("room:a").attached(false);
    expect(lifecycle).toHaveBeenCalledWith({
      type: "connection",
      previous: "suspended",
      current: "connected",
    });
    expect(lifecycle).toHaveBeenLastCalledWith({
      type: "channel",
      channel: "room:a",
      state: "attached",
      resumed: false,
    });
    const count = state.mock.calls.length;
    stopState();
    stopLifecycle();
    lifecycle.mockClear();
    emitConnection({ previous: "connected", current: "disconnected" });
    expect(lifecycle).not.toHaveBeenCalled();
    expect(state).toHaveBeenCalledTimes(count);
  });

  it("does not construct a late SDK after the owner has closed", async () => {
    const { realtime, requestToken, loadClient } = setup();
    let finish: ((token: typeof fakeTokenRequest) => void) | undefined;
    requestToken.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    realtime.start();
    await vi.advanceTimersByTimeAsync(25);
    realtime.close();
    finish?.(fakeTokenRequest);
    await vi.runAllTimersAsync();
    expect(loadClient).not.toHaveBeenCalled();
  });

  it("restarts safely after strict-effect cleanup without duplicate subscriptions", async () => {
    const { realtime, client, loadClient } = setup();
    const stop = realtime.subscribe("room:a", vi.fn());
    realtime.start();
    stop();
    realtime.close();
    realtime.subscribe("room:a", vi.fn());
    realtime.start();
    await vi.runAllTimersAsync();
    expect(loadClient).toHaveBeenCalledTimes(1);
    expect(client.channel("room:a").subscribe).toHaveBeenCalledTimes(1);
  });

  it("does not attach a stale intermediate room while A → B → C authorization is pending", async () => {
    const { realtime, client, requestToken, calls } = setup();
    const stopA = realtime.subscribe("room:a", vi.fn());
    realtime.start();
    await vi.runAllTimersAsync();
    let finishB: ((token: typeof fakeTokenRequest) => void) | undefined;
    requestToken.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishB = resolve;
        }),
    );
    stopA();
    const stopB = realtime.subscribe("room:b", vi.fn());
    await vi.advanceTimersByTimeAsync(25);
    expect(requestToken).toHaveBeenLastCalledWith(
      { rooms: ["b"], spaces: [] },
      expect.any(AbortSignal),
    );
    stopB();
    realtime.subscribe("room:c", vi.fn());
    finishB?.(fakeTokenFor({ rooms: ["b"], spaces: [] }));
    await vi.runAllTimersAsync();
    expect(calls).not.toContain("subscribe:room:b");
    expect(client.channel("room:c").subscribe).toHaveBeenCalledTimes(1);
    expect(requestToken.mock.calls.map(([input]) => input)).toEqual([
      { rooms: ["a"], spaces: [] },
      { rooms: ["b"], spaces: [] },
      { rooms: ["c"], spaces: [] },
    ]);
    expect(calls.indexOf("detach:room:a")).toBeLessThan(
      calls.indexOf("authorize"),
    );
  });

  it("closes a late SDK creation without connecting it", async () => {
    const { realtime, client, loadClient } = setup();
    let finish: ((value: typeof client) => void) | undefined;
    loadClient.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    realtime.start();
    await vi.advanceTimersByTimeAsync(25);
    realtime.close();
    finish?.(client);
    await vi.runAllTimersAsync();
    expect(client.connect).not.toHaveBeenCalled();
    expect(client.close).toHaveBeenCalledTimes(1);
  });
});
