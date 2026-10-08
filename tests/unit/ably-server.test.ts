import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseEnv } from "@/lib/env";
import { createAblyPublisher } from "@/lib/realtime/ably-server";
import { noopRealtime } from "@/lib/realtime/noop";
import {
  createServerRealtimePublisher,
  getRealtimePublisher,
} from "@/lib/realtime/server";
import type { RealtimeEvent } from "@/lib/realtime/types";

const environment = vi.hoisted(() => ({
  key: undefined as string | undefined,
}));
vi.mock("@/lib/env", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/env")>();
  return {
    ...original,
    getEnv: () => original.parseEnv({ ABLY_API_KEY: environment.key }),
  };
});

const event: RealtimeEvent = { type: "booking.changed", spaceId: "space-a" };

beforeEach(() => {
  environment.key = undefined;
});

describe("Ably server publishing", () => {
  it("forwards the exact channel, event name and payload", async () => {
    const publish = vi.fn(async () => {});
    const get = vi.fn(() => ({ publish }));
    await createAblyPublisher({ channels: { get } }).publish("room:a", event);
    expect(get).toHaveBeenCalledExactlyOnceWith("room:a");
    expect(publish).toHaveBeenCalledExactlyOnceWith(event.type, event);
  });
  it("propagates failures to the post-commit caller", async () => {
    const failure = new Error("test failure");
    const publish = vi.fn().mockRejectedValue(failure);
    await expect(
      createAblyPublisher({ channels: { get: () => ({ publish }) } }).publish(
        "room:a",
        event,
      ),
    ).rejects.toBe(failure);
  });
  it("returns noop without a key and never constructs a client", async () => {
    const createClient = vi.fn();
    const publisher = createServerRealtimePublisher({ createClient });
    expect(publisher).toBe(noopRealtime);
    await publisher.publish("room:a", event);
    expect(createClient).not.toHaveBeenCalled();
    expect(getRealtimePublisher()).toBe(noopRealtime);
  });
  it("lazily constructs one client shared by simultaneous publishes", async () => {
    const publish = vi.fn(async () => {});
    const createClient = vi.fn(async () => ({
      channels: { get: () => ({ publish }) },
    }));
    const publisher = createServerRealtimePublisher({
      key: "fake.key:test-only",
      createClient,
    });
    expect(createClient).not.toHaveBeenCalled();
    await Promise.all([
      publisher.publish("room:a", event),
      publisher.publish("room:b", event),
    ]);
    expect(createClient).toHaveBeenCalledExactlyOnceWith("fake.key:test-only");
    expect(publish).toHaveBeenCalledTimes(2);
  });
  it("reuses the configured publisher without initiating REST requests", () => {
    environment.key = "fake.key:test-only";
    expect(getRealtimePublisher()).not.toBe(noopRealtime);
    expect(getRealtimePublisher()).toBe(getRealtimePublisher());
    environment.key = undefined;
    expect(getRealtimePublisher()).toBe(noopRealtime);
  });
  it("parses the optional server key without requiring it for builds", () => {
    expect(parseEnv({}).ABLY_API_KEY).toBeUndefined();
    expect(parseEnv({ ABLY_API_KEY: "" }).ABLY_API_KEY).toBeUndefined();
    expect(parseEnv({ ABLY_API_KEY: "fake.key:test-only" }).ABLY_API_KEY).toBe(
      "fake.key:test-only",
    );
  });
});
