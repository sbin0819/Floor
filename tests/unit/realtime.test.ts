import { describe, expect, it, vi } from "vitest";

import {
  floorChannel,
  roomChannel,
  spaceChannel,
  userChannel,
} from "@/lib/realtime/channels";
import { createMemoryRealtime } from "@/lib/realtime/memory";
import { noopRealtime } from "@/lib/realtime/noop";
import type { RealtimeEvent } from "@/lib/realtime/types";

const booking: RealtimeEvent = { type: "booking.changed", spaceId: "space-a" };

describe("realtime channel helpers", () => {
  it("keeps floor, room, and user channels separate for the same id", () => {
    expect(floorChannel("a")).toBe("floor:a");
    expect(roomChannel("a")).toBe("room:a");
    expect(userChannel("a")).toBe("user:a");
    expect(spaceChannel("a")).toBe("space:a");
  });
});

describe("memory realtime", () => {
  it("delivers to every listener in the requested channel only", async () => {
    const bus = createMemoryRealtime();
    const first = vi.fn();
    const second = vi.fn();
    const other = vi.fn();
    bus.subscribe(floorChannel("a"), first);
    bus.subscribe(floorChannel("a"), second);
    bus.subscribe(roomChannel("a"), other);
    await bus.publish(floorChannel("a"), booking);
    expect(first).toHaveBeenCalledExactlyOnceWith(booking);
    expect(second).toHaveBeenCalledExactlyOnceWith(booking);
    expect(other).not.toHaveBeenCalled();
  });

  it("can unsubscribe independently and repeatedly, then subscribe again", async () => {
    const bus = createMemoryRealtime();
    const listener = vi.fn();
    const stopFirst = bus.subscribe(floorChannel("a"), listener);
    const stopSecond = bus.subscribe(floorChannel("a"), listener);
    stopFirst();
    stopFirst();
    await bus.publish(floorChannel("a"), booking);
    expect(listener).toHaveBeenCalledTimes(1);
    stopSecond();
    bus.subscribe(floorChannel("a"), listener);
    stopSecond();
    await bus.publish(floorChannel("a"), booking);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("does not replay old events or share subscriptions across instances", async () => {
    const first = createMemoryRealtime();
    const second = createMemoryRealtime();
    const listener = vi.fn();
    await first.publish(floorChannel("a"), booking);
    first.subscribe(floorChannel("a"), listener);
    expect(listener).not.toHaveBeenCalled();
    await second.publish(floorChannel("a"), booking);
    expect(listener).not.toHaveBeenCalled();
  });

  it.each<RealtimeEvent>([
    booking,
    { type: "space.status_changed", spaceId: "space-a" },
    { type: "plan.published", floorId: "floor-a", version: 2 },
    {
      type: "message.created",
      roomId: "room-a",
      id: "message-a",
      seq: 3,
      authorId: null,
      authorName: null,
      clientId: null,
      kind: "system",
      body: "김서연 님이 그룹을 만들었어요",
      systemData: { type: "group_created", actorName: "김서연" },
      createdAt: "2026-10-07T00:00:00Z",
      replyTo: null,
      mentions: [],
      mentionsEveryone: false,
      editedAt: null,
      deletedAt: null,
      reactions: [],
    },
  ])("preserves the payload of $type", async (event) => {
    const bus = createMemoryRealtime();
    const listener = vi.fn();
    bus.subscribe(userChannel("a"), listener);
    await bus.publish(userChannel("a"), event);
    expect(listener).toHaveBeenCalledExactlyOnceWith(event);
  });

  it("publishes many in input order only to their intended subscribers", async () => {
    const bus = createMemoryRealtime();
    const delivered: string[] = [];
    bus.subscribe("room:a", (event) => delivered.push(`a:${event.type}`));
    bus.subscribe("user:b", (event) => delivered.push(`b:${event.type}`));
    await bus.publishMany([
      { channel: "room:a", event: booking },
      {
        channel: "user:b",
        event: { type: "message.deleted", roomId: "a", id: "m", seq: 1 },
      },
      { channel: "missing", event: booking },
      {
        channel: "room:a",
        event: { type: "space.status_changed", spaceId: "a" },
      },
    ]);
    await bus.publishMany([]);
    expect(delivered).toEqual([
      "a:booking.changed",
      "b:message.deleted",
      "a:space.status_changed",
    ]);
  });
});

describe("noop realtime", () => {
  it("accepts publish and returns a harmless unsubscribe without notifications", async () => {
    const listener = vi.fn();
    const unsubscribe = noopRealtime.subscribe(floorChannel("a"), listener);
    await expect(
      noopRealtime.publish(floorChannel("a"), booking),
    ).resolves.toBeUndefined();
    await expect(
      noopRealtime.publishMany([
        { channel: floorChannel("a"), event: booking },
      ]),
    ).resolves.toBeUndefined();
    await expect(noopRealtime.publishMany([])).resolves.toBeUndefined();
    expect(listener).not.toHaveBeenCalled();
    expect(() => {
      unsubscribe();
      unsubscribe();
    }).not.toThrow();
  });
});
