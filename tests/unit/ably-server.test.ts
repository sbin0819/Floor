import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseEnv } from "@/lib/env";
import {
  createAblyPublisher,
  type AblyRestPublisherClient,
} from "@/lib/realtime/ably-server";
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

function fakeRestClient() {
  const publish = vi.fn(async () => {});
  const get = vi.fn(() => ({ publish }));
  const batchPublish = vi.fn<AblyRestPublisherClient["batchPublish"]>(
    async (specs) => specs.map(() => ({ failureCount: 0 })),
  );
  return { channels: { get }, publish, batchPublish };
}

beforeEach(() => {
  environment.key = undefined;
});

describe("Ably server publishing", () => {
  it("forwards the exact channel, event name and payload", async () => {
    const publish = vi.fn(async () => {});
    const get = vi.fn(() => ({ publish }));
    await createAblyPublisher({
      ...fakeRestClient(),
      channels: { get },
    }).publish("room:a", event);
    expect(get).toHaveBeenCalledExactlyOnceWith("room:a");
    expect(publish).toHaveBeenCalledExactlyOnceWith(event.type, event);
  });
  it("propagates failures to the post-commit caller", async () => {
    const failure = new Error("test failure");
    const publish = vi.fn().mockRejectedValue(failure);
    await expect(
      createAblyPublisher({
        ...fakeRestClient(),
        channels: { get: () => ({ publish }) },
      }).publish("room:a", event),
    ).rejects.toBe(failure);
  });
  it("returns noop without a key and never constructs a client", async () => {
    const createClient = vi.fn();
    const publisher = createServerRealtimePublisher({ createClient });
    expect(publisher).toBe(noopRealtime);
    await publisher.publish("room:a", event);
    await publisher.publishMany([{ channel: "room:a", event }]);
    expect(createClient).not.toHaveBeenCalled();
    expect(getRealtimePublisher()).toBe(noopRealtime);
  });
  it("lazily constructs one client shared by simultaneous publishes", async () => {
    const publish = vi.fn(async () => {});
    const createClient = vi.fn(async () => ({
      ...fakeRestClient(),
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
  it("shares the lazy client between single and batch calls and skips empty batches", async () => {
    const client = fakeRestClient();
    const createClient = vi.fn(async () => client);
    const publisher = createServerRealtimePublisher({
      key: "fake:test",
      createClient,
    });
    await publisher.publishMany([]);
    expect(createClient).not.toHaveBeenCalled();
    await Promise.all([
      publisher.publish("room:a", event),
      publisher.publishMany([{ channel: "user:b", event }]),
    ]);
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(client.publish).toHaveBeenCalledExactlyOnceWith(event.type, event);
    expect(client.batchPublish).toHaveBeenCalledExactlyOnceWith([
      { channels: ["user:b"], messages: [{ name: event.type, data: event }] },
    ]);
  });
  it("splits an unbounded recipient list into sequential requests of at most 100 channels", async () => {
    const client = fakeRestClient();
    const items = Array.from({ length: 305 }, (_, index) => ({
      channel: `user:${index}`,
      event,
    }));
    let active = 0;
    let maximumActive = 0;
    client.batchPublish.mockImplementation(async (specs) => {
      maximumActive = Math.max(maximumActive, ++active);
      await Promise.resolve();
      active--;
      return specs.map(() => ({ failureCount: 0 }));
    });
    await createAblyPublisher(client).publishMany(items);
    expect(
      client.batchPublish.mock.calls.map(([specs]) => specs.length),
    ).toEqual([100, 100, 100, 5]);
    expect(client.batchPublish.mock.calls.flatMap(([specs]) => specs)).toEqual(
      items.map(({ channel, event }) => ({
        channels: [channel],
        messages: [{ name: event.type, data: event }],
      })),
    );
    expect(client.publish).not.toHaveBeenCalled();
    expect(maximumActive).toBe(1);
  });
  it("splits oversized UTF-8 batch bodies before the 100-channel limit", async () => {
    const client = fakeRestClient();
    const large: RealtimeEvent = {
      type: "message.updated",
      roomId: "a",
      id: "m",
      seq: 1,
      body: "\u0000".repeat(4_000),
      mentions: [],
      mentionsEveryone: false,
      editedAt: "2026-10-08T00:00:00Z",
    };
    const items = Array.from({ length: 100 }, (_, index) => ({
      channel: `room:${index}`,
      event: large,
    }));
    await createAblyPublisher(client).publishMany(items);
    expect(client.batchPublish).toHaveBeenCalledTimes(2);
    for (const [specs] of client.batchPublish.mock.calls) {
      expect(
        new TextEncoder().encode(JSON.stringify(specs)).byteLength,
      ).toBeLessThan(2 * 1024 * 1024);
    }
    expect(
      client.batchPublish.mock.calls.flatMap(([specs]) => specs),
    ).toHaveLength(100);
  });
  it("preserves multiple events for the same channel and validates all items before publishing", async () => {
    const client = fakeRestClient();
    const publisher = createAblyPublisher(client);
    const deleted: RealtimeEvent = {
      type: "message.deleted",
      roomId: "a",
      id: "m",
      seq: 1,
    };
    await publisher.publishMany([
      { channel: "room:a", event },
      { channel: "room:a", event: deleted },
    ]);
    expect(client.batchPublish).toHaveBeenCalledExactlyOnceWith([
      { channels: ["room:a"], messages: [{ name: event.type, data: event }] },
      {
        channels: ["room:a"],
        messages: [{ name: deleted.type, data: deleted }],
      },
    ]);
    client.batchPublish.mockClear();
    await expect(
      publisher.publishMany([
        { channel: "room:a", event },
        {
          channel: "room:b",
          event: {
            type: "mention.created",
            bookingId: null,
            roomKind: "text",
            spaceId: "a",
            roomId: "b",
            roomName: "일반",
            messageId: "m",
            seq: 1,
            authorName: "김서연",
            excerpt: "private".repeat(10_000),
          },
        },
      ]),
    ).rejects.toThrow("Realtime batch publication failed.");
    expect(client.batchPublish).not.toHaveBeenCalled();
  });
  it.each(["rejected", "partial"])(
    "attempts later batches after a %s failure and exposes only a fixed error",
    async (kind) => {
      const client = fakeRestClient();
      if (kind === "rejected")
        client.batchPublish.mockRejectedValueOnce(
          new Error("private key and message"),
        );
      else client.batchPublish.mockResolvedValueOnce([{ failureCount: 1 }]);
      await expect(
        createAblyPublisher(client).publishMany(
          Array.from({ length: 201 }, (_, index) => ({
            channel: `user:${index}`,
            event,
          })),
        ),
      ).rejects.toThrow(/^Realtime batch publication failed\.$/);
      expect(client.batchPublish).toHaveBeenCalledTimes(3);
    },
  );
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
