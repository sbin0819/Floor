import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAblyBrowserRealtime,
  type BrowserRealtime,
} from "@/lib/realtime/ably-browser";
import { createFakeAblyBrowser, fakeTokenRequest } from "./ably-test-client";
import type { PresenceMember } from "@/lib/realtime/ably-browser-client";

const connections: BrowserRealtime[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  connections.splice(0).forEach((realtime) => realtime.close());
  vi.useRealTimers();
});
const token = (names: string[]) => ({
  ...fakeTokenRequest,
  capability: JSON.stringify(
    Object.fromEntries(
      names.map((name) => [
        name,
        name.startsWith("user:") ? ["subscribe"] : ["subscribe", "presence"],
      ]),
    ),
  ),
});
function setup(names = ["user:user-a", "space:a", "space:b", "room:one"]) {
  const fake = createFakeAblyBrowser();
  const requestToken = vi.fn(async () => token(names));
  const realtime = createAblyBrowserRealtime({
    loadClient: fake.loadClient,
    requestToken,
  });
  connections.push(realtime);
  realtime.subscribe("user:user-a", vi.fn());
  realtime.subscribe("room:one", vi.fn());
  return { ...fake, requestToken, realtime };
}

describe("authorized space presence on the existing browser connection", () => {
  it("subscribes to every authorized space and separates status from typing", async () => {
    const { realtime, client, channels } = setup();
    realtime.setStatusPresence?.({ status: "dnd", auto: false });
    const room = realtime.observePresence("room:one", vi.fn());
    room.update({ typing: true, name: "내 이름" });
    const event = vi.fn();
    realtime.subscribeSpaces?.(event);
    realtime.start();
    await vi.runAllTimersAsync();
    expect([...channels.keys()].sort()).toEqual([
      "room:one",
      "space:a",
      "space:b",
      "user:user-a",
    ]);
    for (const name of ["space:a", "space:b"]) {
      expect(
        client.channel(name).presence.enter,
      ).toHaveBeenCalledExactlyOnceWith({ status: "dnd", auto: false });
      expect(realtime.getScopeSnapshot?.().spaces[name]?.synced).toBe(true);
    }
    expect(
      client.channel("room:one").presence.enter,
    ).toHaveBeenCalledExactlyOnceWith({ typing: true, name: "내 이름" });
    client.channel("space:b").emit({ type: "friend.changed" });
    expect(event).toHaveBeenCalledExactlyOnceWith({ type: "friend.changed" });
    room.close();
  });
  it("reauthorizes even for unchanged room input and removes denied bindings and presence", async () => {
    const { realtime, client, requestToken } = setup();
    realtime.setStatusPresence?.({ status: "online", auto: false });
    realtime.start();
    await vi.runAllTimersAsync();
    requestToken.mockResolvedValue(
      token(["user:user-a", "space:b", "space:c"]),
    );
    realtime.reauthorize?.();
    await vi.runAllTimersAsync();
    expect(requestToken).toHaveBeenCalledTimes(2);
    expect(client.channel("space:a").detach).toHaveBeenCalledOnce();
    expect(client.channel("space:a").presence.leave).toHaveBeenCalledOnce();
    expect(client.channel("room:one").detach).toHaveBeenCalledOnce();
    expect(
      client.channel("space:c").presence.enter,
    ).toHaveBeenCalledExactlyOnceWith({ status: "online", auto: false });
    expect(realtime.getScopeSnapshot?.().channels).toEqual([
      "space:b",
      "space:c",
      "user:user-a",
    ]);
  });
  it("keeps incomplete and failed synchronization distinct from an empty online set", async () => {
    const { realtime, client } = setup();
    let resolve!: (members: PresenceMember[]) => void;
    client.channel("space:b").presence.get.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    realtime.start();
    await vi.runAllTimersAsync();
    expect(realtime.getScopeSnapshot?.().spaces["space:a"]?.synced).toBe(true);
    expect(realtime.getScopeSnapshot?.().spaces["space:b"]?.synced).toBe(false);
    resolve([]);
    await vi.runAllTimersAsync();
    expect(realtime.getScopeSnapshot?.().spaces["space:b"]?.synced).toBe(true);
    client
      .channel("space:b")
      .presence.get.mockRejectedValue(new Error("not logged"));
    client.channel("space:b").attached(false);
    await vi.runAllTimersAsync();
    expect(realtime.getScopeSnapshot?.().spaces["space:b"]?.synced).toBe(false);
  });
  it("coalesces per-channel status values and sends at most twenty channels a second", async () => {
    const names = Array.from({ length: 25 }, (_, i) => `space:${i}`);
    const { realtime, client } = setup(["user:user-a", ...names]);
    realtime.start();
    await vi.runAllTimersAsync();
    realtime.setStatusPresence?.({ status: "online", auto: false });
    realtime.setStatusPresence?.({ status: "dnd", auto: false });
    await vi.advanceTimersByTimeAsync(0);
    const entered = () =>
      names.filter(
        (name) => client.channel(name).presence.enter.mock.calls.length,
      ).length;
    expect(entered()).toBe(1);
    await vi.advanceTimersByTimeAsync(949);
    expect(entered()).toBe(19);
    await vi.runAllTimersAsync();
    expect(entered()).toBe(25);
    for (const name of names)
      expect(
        client.channel(name).presence.enter,
      ).toHaveBeenCalledExactlyOnceWith({ status: "dnd", auto: false });
  });
  it("does not leak status across close and a fresh account connection", async () => {
    const { realtime } = setup();
    realtime.setStatusPresence?.({ status: "dnd", auto: false });
    realtime.start();
    await vi.runAllTimersAsync();
    realtime.close();
    expect(realtime.getScopeSnapshot?.()).toEqual({
      channels: null,
      requestedRooms: [],
      spaces: {},
      status: null,
    });
    realtime.start();
    await vi.runAllTimersAsync();
    expect(realtime.getScopeSnapshot?.().status).toBeNull();
  });
});
