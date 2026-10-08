import { describe, expect, it, vi } from "vitest";
import { createPresenceRegistry } from "@/lib/realtime/ably-presence";
import type {
  BrowserPresence,
  PresenceMember,
} from "@/lib/realtime/ably-browser-client";

const member: PresenceMember = {
  clientId: "other",
  connectionId: "tab",
  timestamp: 1,
  data: { typing: true },
};
async function tick() {
  for (let index = 0; index < 12; index++) await Promise.resolve();
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup() {
  const presence = {
    get: vi.fn(async (): Promise<PresenceMember[]> => []),
    subscribe: vi.fn<BrowserPresence["subscribe"]>(async () => {}),
    unsubscribe: vi.fn<BrowserPresence["unsubscribe"]>(() => {}),
    enter: vi.fn<BrowserPresence["enter"]>(async () => {}),
    update: vi.fn<BrowserPresence["update"]>(async () => {}),
    leave: vi.fn(async () => {}),
  } satisfies BrowserPresence;
  return { presence, registry: createPresenceRegistry() };
}

describe("shared Ably presence lifecycle", () => {
  it("queues data until a granted binding arrives, then enters once and updates", async () => {
    const { registry, presence } = setup();
    const notify = vi.fn();
    const observer = registry.observe("room:a", notify);
    observer.update({ typing: true, name: "김서연" });
    expect(presence.enter).not.toHaveBeenCalled();
    registry.bind("room:a", presence);
    await tick();
    expect(presence.enter).toHaveBeenCalledExactlyOnceWith({
      typing: true,
      name: "김서연",
    });
    observer.update({ typing: false });
    await tick();
    expect(presence.update).toHaveBeenCalledExactlyOnceWith({ typing: false });
    observer.close();
    await registry.unbind("room:a");
    expect(presence.leave).toHaveBeenCalledTimes(1);
    expect(presence.unsubscribe).toHaveBeenCalledExactlyOnceWith(
      presence.subscribe.mock.calls[0]?.[0],
    );
  });
  it("uses the latest snapshot and ignores reversed get responses", async () => {
    const { registry, presence } = setup();
    const first = deferred<PresenceMember[]>();
    const second = deferred<PresenceMember[]>();
    presence.get
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const notify = vi.fn();
    registry.observe("room:a", notify);
    registry.bind("room:a", presence);
    await tick();
    presence.subscribe.mock.calls[0]?.[0]();
    second.resolve([member]);
    await tick();
    first.resolve([]);
    await tick();
    expect(notify).toHaveBeenCalledExactlyOnceWith([member]);
    registry.reset();
  });
  it("does not deliver a late snapshot after its observer closes", async () => {
    const { registry, presence } = setup();
    const pending = deferred<PresenceMember[]>();
    presence.get.mockReturnValue(pending.promise);
    const notify = vi.fn();
    const observer = registry.observe("room:a", notify);
    registry.bind("room:a", presence);
    await tick();
    observer.close();
    await registry.unbind("room:a");
    pending.resolve([member]);
    await tick();
    expect(notify).not.toHaveBeenCalled();
  });
  it("serializes enter and leave when navigation occurs during enter", async () => {
    const { registry, presence } = setup();
    const pending = deferred<void>();
    presence.enter.mockReturnValue(pending.promise);
    const observer = registry.observe("room:a", vi.fn());
    observer.update({ typing: true });
    registry.bind("room:a", presence);
    await tick();
    observer.close();
    const detached = registry.unbind("room:a");
    expect(presence.leave).not.toHaveBeenCalled();
    pending.resolve();
    await detached;
    expect(presence.leave).toHaveBeenCalledTimes(1);
  });
  it("keeps independent observers and restores the remaining owner's desired data", async () => {
    const { registry, presence } = setup();
    const first = registry.observe("room:a", vi.fn());
    const second = registry.observe("room:a", vi.fn());
    first.update({ typing: true, name: "first" });
    registry.bind("room:a", presence);
    await tick();
    second.update({ typing: false });
    await tick();
    second.close();
    second.close();
    await tick();
    expect(presence.update.mock.calls).toEqual([
      [{ typing: false }],
      [{ typing: true, name: "first" }],
    ]);
    expect(presence.leave).not.toHaveBeenCalled();
    first.close();
    await registry.unbind("room:a");
    expect(presence.leave).toHaveBeenCalledTimes(1);
  });
  it("cleans up even when leave rejects and permits a new binding", async () => {
    const { registry, presence } = setup();
    presence.leave.mockRejectedValue(new Error("private details"));
    const observer = registry.observe("room:a", vi.fn());
    observer.update({ typing: true });
    registry.bind("room:a", presence);
    await tick();
    await expect(registry.unbind("room:a")).resolves.toBeUndefined();
    const next = setup().presence;
    registry.bind("room:a", next);
    await tick();
    expect(next.enter).toHaveBeenCalledExactlyOnceWith({ typing: true });
    registry.reset();
  });
  it("reset makes old async operations inert and restores desired data on the new SDK", async () => {
    const { registry, presence } = setup();
    const pending = deferred<void>();
    presence.enter.mockReturnValue(pending.promise);
    const observer = registry.observe("room:a", vi.fn());
    observer.update({ typing: true });
    registry.bind("room:a", presence);
    await tick();
    registry.reset();
    const next = setup().presence;
    registry.bind("room:a", next);
    await tick();
    observer.update({ typing: false });
    await tick();
    pending.resolve();
    await tick();
    expect(presence.update).not.toHaveBeenCalled();
    expect(next.enter).toHaveBeenCalledExactlyOnceWith({ typing: true });
    expect(next.update).toHaveBeenCalledExactlyOnceWith({ typing: false });
    registry.reset();
  });
  it("does not retry rejected operations in an unbounded loop", async () => {
    const { registry, presence } = setup();
    presence.enter.mockRejectedValue(new Error("not attached"));
    const observer = registry.observe("room:a", vi.fn());
    observer.update({ typing: true });
    registry.bind("room:a", presence);
    await tick();
    expect(presence.enter).toHaveBeenCalledTimes(1);
    registry.reset();
  });
});
