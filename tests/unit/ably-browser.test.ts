import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAblyBrowserRealtime,
  type BrowserRealtime,
} from "@/lib/realtime/ably-browser";
import { RealtimeTokenError } from "@/lib/realtime/ably-browser-client";
import type { RealtimeEvent } from "@/lib/realtime/types";

import { createFakeAblyBrowser, fakeTokenRequest } from "./ably-test-client";

const event: RealtimeEvent = {
  type: "message.created",
  roomId: "a",
  id: "message-a",
  seq: 1,
  authorId: "user-a",
  authorName: "김서연",
  clientId: "client-a",
  kind: "text",
  body: "안녕하세요",
  createdAt: "2026-10-08T00:00:00Z",
};
const cleanup: BrowserRealtime[] = [];

function setup() {
  const fake = createFakeAblyBrowser();
  const requestToken = vi.fn(async () => fakeTokenRequest);
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
  it("switches the single selected space by detaching before reauthorization", async () => {
    const { realtime, client, requestToken, calls } = setup();
    const stopSpace = realtime.subscribe("space:a", vi.fn());
    const stopRoom = realtime.subscribe("room:one", vi.fn());
    realtime.start();
    await vi.runAllTimersAsync();
    expect(requestToken).toHaveBeenLastCalledWith({
      rooms: ["one"],
      spaces: ["a"],
    });
    calls.length = 0;
    stopSpace();
    stopRoom();
    const onEvent = vi.fn();
    realtime.subscribe("space:b", onEvent);
    realtime.subscribe("room:two", vi.fn());
    await vi.runAllTimersAsync();
    expect(requestToken).toHaveBeenLastCalledWith({
      rooms: ["two"],
      spaces: ["b"],
    });
    expect(calls.indexOf("detach:space:a")).toBeLessThan(
      calls.indexOf("authorize"),
    );
    expect(calls.indexOf("detach:room:one")).toBeLessThan(
      calls.indexOf("authorize"),
    );
    client
      .channel("space:b")
      .emit({
        type: "room.activity",
        spaceId: "b",
        roomId: "two",
        seq: 1,
        authorId: "other",
      });
    expect(onEvent).toHaveBeenCalledExactlyOnceWith({
      type: "room.activity",
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
    expect(requestToken).toHaveBeenCalledExactlyOnceWith({
      rooms: ["a"],
      spaces: [],
    });
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
    expect(requestToken).toHaveBeenLastCalledWith({ rooms: [], spaces: [] });
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
    expect(requestToken).toHaveBeenLastCalledWith({
      rooms: ["b", "c"],
      spaces: [],
    });
    expect(client.channel("room:b").subscribe).toHaveBeenCalledTimes(1);
  });

  it.each([401, 503])(
    "quietly disables %s before loading or connecting the SDK",
    async (status) => {
      const { realtime, requestToken, loadClient } = setup();
      requestToken.mockRejectedValue(new RealtimeTokenError(status));
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
      requestToken.mockRejectedValue(new RealtimeTokenError(status));
      realtime.subscribe("room:a", vi.fn());
      await vi.runAllTimersAsync();
      expect(client.close).toHaveBeenCalledTimes(1);
      expect(realtime.getSnapshot()).toBe("disabled");
    },
  );

  it("lets the SDK retry transient token failures instead of treating them as disabled", async () => {
    const { realtime, requestToken, client } = setup();
    requestToken.mockRejectedValueOnce(new RealtimeTokenError(500));
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
    expect(requestToken).toHaveBeenLastCalledWith({ rooms: ["b"], spaces: [] });
    stopB();
    realtime.subscribe("room:c", vi.fn());
    finishB?.(fakeTokenRequest);
    await vi.runAllTimersAsync();
    expect(calls).not.toContain("subscribe:room:b");
    expect(client.channel("room:c").subscribe).toHaveBeenCalledTimes(1);
    expect(requestToken.mock.calls).toEqual([
      [{ rooms: ["a"], spaces: [] }],
      [{ rooms: ["b"], spaces: [] }],
      [{ rooms: ["c"], spaces: [] }],
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
