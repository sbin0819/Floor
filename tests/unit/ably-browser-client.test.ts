import type { ClientOptions } from "ably";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchRealtimeToken,
  loadAblyBrowserClient,
  RealtimeTokenError,
} from "@/lib/realtime/ably-browser-client";

import { fakeTokenRequest } from "./ably-test-client";

const sdk = vi.hoisted(() => ({
  construct: vi.fn(),
  connect: vi.fn(),
  close: vi.fn(),
  authorize: vi.fn(async () => ({})),
  on: vi.fn(),
  off: vi.fn(),
  get: vi.fn(),
  subscribe: vi
    .fn<(listener: (message: { data?: unknown }) => void) => Promise<null>>()
    .mockResolvedValue(null),
  unsubscribe: vi.fn(),
  detach: vi.fn(async () => {}),
  onChannel: vi.fn(),
  offChannel: vi.fn(),
}));

vi.mock("ably", () => ({
  Realtime: class {
    constructor(options: ClientOptions) {
      sdk.construct(options);
    }
    connect = sdk.connect;
    close = sdk.close;
    auth = { authorize: sdk.authorize };
    connection = { on: sdk.on, off: sdk.off };
    channels = { get: sdk.get };
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  sdk.get.mockReturnValue({
    subscribe: sdk.subscribe,
    unsubscribe: sdk.unsubscribe,
    detach: sdk.detach,
    on: sdk.onChannel,
    off: sdk.offChannel,
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("Ably HTTP token request", () => {
  it("posts only requested channels with same-origin credentials and no caching", async () => {
    const fetcher = vi.fn(async () => Response.json(fakeTokenRequest));
    vi.stubGlobal("fetch", fetcher);
    await expect(fetchRealtimeToken({ rooms: ["a"] })).resolves.toEqual(
      fakeTokenRequest,
    );
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/realtime/token", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: '{"rooms":["a"]}',
    });
  });
  it.each([401, 429, 500, 503])(
    "preserves HTTP %s without exposing the response body",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("private diagnostic", { status })),
      );
      await expect(fetchRealtimeToken({ rooms: [] })).rejects.toEqual(
        new RealtimeTokenError(status),
      );
      await expect(fetchRealtimeToken({ rooms: [] })).rejects.not.toThrow(
        "private diagnostic",
      );
    },
  );
  it("rejects invalid token responses with a fixed error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ token: "not-a-token-request" })),
    );
    await expect(fetchRealtimeToken({ rooms: [] })).rejects.toEqual(
      new RealtimeTokenError(502),
    );
  });
});

describe("Ably SDK bridge", () => {
  it("constructs a disconnected client and delegates auth through the callback", async () => {
    const auth = vi.fn((callback) => callback(null, fakeTokenRequest));
    const client = await loadAblyBrowserClient(auth);
    const options = sdk.construct.mock.calls[0]?.[0] as ClientOptions;
    expect(options.autoConnect).toBe(false);
    expect(options.logLevel).toBe(0);
    expect(options.key).toBeUndefined();
    expect(sdk.connect).not.toHaveBeenCalled();
    const callback = vi.fn();
    options.authCallback?.({}, callback);
    expect(callback).toHaveBeenCalledExactlyOnceWith(null, fakeTokenRequest);
    client.connect();
    await client.authorize();
    client.close();
    expect(sdk.connect).toHaveBeenCalledTimes(1);
    expect(sdk.authorize).toHaveBeenCalledTimes(1);
    expect(sdk.close).toHaveBeenCalledTimes(1);
  });
  it("strips SDK error diagnostics from connection lifecycle events", async () => {
    const client = await loadAblyBrowserClient(vi.fn());
    const listener = vi.fn();
    const unsubscribe = client.onConnection(listener);
    const callback = sdk.on.mock.calls[0]?.[0];
    callback({
      previous: "connected",
      current: "disconnected",
      reason: { message: "private diagnostic" },
    });
    expect(listener).toHaveBeenCalledExactlyOnceWith({
      previous: "connected",
      current: "disconnected",
    });
    unsubscribe();
    expect(sdk.off).toHaveBeenCalledExactlyOnceWith(callback);
  });
  it("validates event payloads and forwards no unknown sensitive properties", async () => {
    const client = await loadAblyBrowserClient(vi.fn());
    const channel = client.channel("room:a");
    const listener = vi.fn();
    await channel.subscribe(listener);
    const callback = sdk.subscribe.mock.calls[0]?.[0];
    callback?.({
      data: {
        type: "booking.changed",
        spaceId: "a",
        email: "private@example.invalid",
      },
    });
    expect(listener).toHaveBeenCalledExactlyOnceWith({
      type: "booking.changed",
      spaceId: "a",
    });
    callback?.({ data: { type: "message.created", seq: "invalid" } });
    callback?.({});
    expect(listener).toHaveBeenCalledTimes(1);
    channel.unsubscribe(listener);
    await channel.detach();
    expect(sdk.unsubscribe).toHaveBeenCalledExactlyOnceWith(callback);
    expect(sdk.detach).toHaveBeenCalledTimes(1);
  });
  it("accepts minimal space activity and strips message content", async () => {
    const client = await loadAblyBrowserClient(vi.fn());
    const channel = client.channel("space:a");
    const listener = vi.fn();
    await channel.subscribe(listener);
    sdk.subscribe.mock.calls[0]?.[0]({
      data: {
        type: "room.activity",
        spaceId: "a",
        roomId: "b",
        seq: 3,
        authorId: "other",
        body: "private body",
        email: "private@example.test",
      },
    });
    expect(listener).toHaveBeenCalledExactlyOnceWith({
      type: "room.activity",
      spaceId: "a",
      roomId: "b",
      seq: 3,
      authorId: "other",
    });
  });
  it("observes attached and attached-update continuity flags and unsubscribes", async () => {
    const client = await loadAblyBrowserClient(vi.fn());
    const channel = client.channel("room:a");
    const listener = vi.fn();
    const stop = channel.onAttached(listener);
    const callback = sdk.onChannel.mock.calls[0]?.[0];
    callback({ current: "attaching", resumed: false });
    callback({ current: "attached", resumed: true });
    callback({ current: "attached", resumed: false });
    expect(listener.mock.calls).toEqual([[true], [false]]);
    stop();
    expect(sdk.offChannel).toHaveBeenCalledExactlyOnceWith(callback);
  });
});
