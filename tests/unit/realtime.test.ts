import { describe, expect, it, vi } from "vitest";

import {
  floorChannel,
  roomChannel,
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
      kind: "system",
      body: "예약이 변경되었어요.",
      createdAt: "2026-10-07T00:00:00Z",
    },
  ])("preserves the payload of $type", async (event) => {
    const bus = createMemoryRealtime();
    const listener = vi.fn();
    bus.subscribe(userChannel("a"), listener);
    await bus.publish(userChannel("a"), event);
    expect(listener).toHaveBeenCalledExactlyOnceWith(event);
  });
});

describe("noop realtime", () => {
  it("accepts publish and returns a harmless unsubscribe without notifications", async () => {
    const listener = vi.fn();
    const unsubscribe = noopRealtime.subscribe(floorChannel("a"), listener);
    await expect(
      noopRealtime.publish(floorChannel("a"), booking),
    ).resolves.toBeUndefined();
    expect(listener).not.toHaveBeenCalled();
    expect(() => {
      unsubscribe();
      unsubscribe();
    }).not.toThrow();
  });
});
