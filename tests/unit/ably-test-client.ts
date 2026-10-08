import type { TokenRequest } from "ably";
import { vi } from "vitest";

import type {
  AblyBrowserClient,
  BrowserAuthCallback,
  BrowserChannel,
  BrowserConnectionChange,
  RealtimeTokenInput,
  PresenceMember,
  BrowserPresence,
} from "@/lib/realtime/ably-browser-client";
import type { RealtimeEvent } from "@/lib/realtime/types";

export const fakeTokenRequest: TokenRequest = {
  keyName: "fake.key",
  clientId: "user-a",
  capability: '{"user:user-a":["subscribe"]}',
  mac: "test-only-signature",
  nonce: "test-only-nonce-value",
  timestamp: 1,
  ttl: 600_000,
};

export function fakeTokenFor(input: RealtimeTokenInput): TokenRequest {
  return {
    ...fakeTokenRequest,
    capability: JSON.stringify({
      "user:user-a": ["subscribe"],
      ...Object.fromEntries(
        input.rooms.map((id) => [`room:${id}`, ["subscribe", "presence"]]),
      ),
      ...Object.fromEntries(
        (input.spaces ?? []).map((id) => [`space:${id}`, ["subscribe"]]),
      ),
    }),
  };
}

export function createFakeAblyBrowser() {
  const calls: string[] = [];
  const connectionListeners = new Set<
    (event: BrowserConnectionChange) => void
  >();
  let authCallback: BrowserAuthCallback | undefined;
  const channels = new Map<string, ReturnType<typeof makeChannel>>();
  function makeChannel(name: string) {
    const listeners = new Set<(event: RealtimeEvent) => void>();
    const attachedListeners = new Set<(resumed: boolean) => void>();
    const channel = {
      presence: {
        get: vi.fn(async (): Promise<PresenceMember[]> => []),
        subscribe: vi.fn<BrowserPresence["subscribe"]>(async () => {}),
        unsubscribe: vi.fn<BrowserPresence["unsubscribe"]>(() => {}),
        enter: vi.fn<BrowserPresence["enter"]>(async () => {
          calls.push(`enter:${name}`);
        }),
        update: vi.fn<BrowserPresence["update"]>(async () => {
          calls.push(`update:${name}`);
        }),
        leave: vi.fn(async () => {
          calls.push(`leave:${name}`);
        }),
      },
      subscribe: vi.fn(async (listener: (event: RealtimeEvent) => void) => {
        calls.push(`subscribe:${name}`);
        listeners.add(listener);
      }),
      unsubscribe: vi.fn((listener: (event: RealtimeEvent) => void) => {
        listeners.delete(listener);
      }),
      onAttached(listener: (resumed: boolean) => void) {
        attachedListeners.add(listener);
        return () => attachedListeners.delete(listener);
      },
      detach: vi.fn(async () => {
        calls.push(`detach:${name}`);
      }),
      emit(event: RealtimeEvent) {
        for (const listener of listeners) listener(event);
      },
      attached(resumed: boolean) {
        for (const listener of attachedListeners) listener(resumed);
      },
    } satisfies BrowserChannel & {
      emit(event: RealtimeEvent): void;
      attached(resumed: boolean): void;
    };
    return channel;
  }
  const emitConnection = (event: BrowserConnectionChange) => {
    for (const listener of connectionListeners) listener(event);
  };
  const authorize = vi.fn(
    () =>
      new Promise<void>((resolve, reject) => {
        calls.push("authorize");
        authCallback?.((error) => {
          if (error) reject(new Error(error));
          else resolve();
        });
      }),
  );
  const client = {
    connect: vi.fn(() => {
      calls.push("connect");
      authCallback?.((error) => {
        if (!error)
          emitConnection({ previous: "connecting", current: "connected" });
      });
    }),
    close: vi.fn(() => calls.push("close")),
    authorize,
    onConnection(listener: (event: BrowserConnectionChange) => void) {
      connectionListeners.add(listener);
      return () => connectionListeners.delete(listener);
    },
    channel(name: string) {
      let channel = channels.get(name);
      if (!channel) {
        channel = makeChannel(name);
        channels.set(name, channel);
      }
      return channel;
    },
  } satisfies AblyBrowserClient;
  return {
    client,
    channels,
    calls,
    emitConnection,
    loadClient: vi.fn(async (callback: BrowserAuthCallback) => {
      authCallback = callback;
      return client;
    }),
  };
}
