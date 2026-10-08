import type { ConnectionState, TokenRequest } from "ably";

import {
  fetchRealtimeToken,
  loadAblyBrowserClient,
  RealtimeTokenError,
  type AblyBrowserClient,
  type BrowserAuthCallback,
  type BrowserChannel,
  type RealtimeTokenInput,
} from "@/lib/realtime/ably-browser-client";
import type { RealtimeEvent, RealtimeSubscriber } from "@/lib/realtime/types";

export type RealtimeConnectionState = ConnectionState | "disabled";
export type RealtimeLifecycleEvent =
  | { type: "connection"; previous: ConnectionState; current: ConnectionState }
  | { type: "channel"; channel: string; state: "attached"; resumed: boolean };

export interface BrowserRealtime extends RealtimeSubscriber {
  start(): void;
  close(): void;
  getSnapshot(): RealtimeConnectionState;
  subscribeState(listener: () => void): () => void;
  subscribeLifecycle(
    listener: (event: RealtimeLifecycleEvent) => void,
  ): () => void;
}

type Binding = {
  channel: BrowserChannel;
  listener: (event: RealtimeEvent) => void;
  stopAttached: () => void;
};

export function createAblyBrowserRealtime({
  loadClient = loadAblyBrowserClient,
  requestToken = fetchRealtimeToken,
  debounceMs = 25,
}: {
  loadClient?: (callback: BrowserAuthCallback) => Promise<AblyBrowserClient>;
  requestToken?: (input: RealtimeTokenInput) => Promise<TokenRequest>;
  debounceMs?: number;
} = {}): BrowserRealtime {
  const listeners = new Map<string, Set<(event: RealtimeEvent) => void>>();
  const bindings = new Map<string, Binding>();
  const stateListeners = new Set<() => void>();
  const lifecycleListeners = new Set<(event: RealtimeLifecycleEvent) => void>();
  let state: RealtimeConnectionState = "initialized";
  let client: AblyBrowserClient | undefined;
  let stopConnection: (() => void) | undefined;
  let active = false;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let dirty = false;
  let tokenRooms: string[] = [];
  let authorizedRooms: string | undefined;

  const setState = (next: RealtimeConnectionState) => {
    if (next === state) return;
    state = next;
    for (const notify of stateListeners) notify();
  };
  const emit = (event: RealtimeLifecycleEvent) => {
    for (const notify of lifecycleListeners) notify(event);
  };
  const currentRooms = () =>
    [...listeners.keys()]
      .filter((channel) => channel.startsWith("room:"))
      .map((channel) => channel.slice(5))
      .sort();

  function close() {
    active = false;
    generation += 1;
    clearTimeout(timer);
    timer = undefined;
    stopConnection?.();
    stopConnection = undefined;
    for (const binding of bindings.values()) {
      binding.channel.unsubscribe(binding.listener);
      binding.stopAttached();
    }
    bindings.clear();
    client?.close();
    client = undefined;
    authorizedRooms = undefined;
    setState("closed");
  }

  function stopForAuth(error: unknown) {
    if (
      error instanceof RealtimeTokenError &&
      (error.status === 401 || error.status === 503)
    ) {
      close();
      setState("disabled");
      return true;
    }
    return false;
  }

  function schedule() {
    dirty = true;
    if (!active || timer || running) return;
    timer = setTimeout(() => {
      timer = undefined;
      void reconcile();
    }, debounceMs);
  }

  async function initialize(version: number) {
    let firstToken: TokenRequest | undefined;
    tokenRooms = currentRooms();
    try {
      // 키가 없는 환경에서는 SDK를 불러오거나 Ably에 연결하지 않는다.
      firstToken = await requestToken({ rooms: tokenRooms });
      authorizedRooms = JSON.stringify(tokenRooms);
    } catch (error) {
      if (version !== generation || !active || stopForAuth(error)) return;
    }
    if (version !== generation || !active) return;
    const nextClient = await loadClient((callback) => {
      if (!active || version !== generation) {
        callback("실시간 연결이 종료되었어요.", null);
        return;
      }
      if (firstToken) {
        const token = firstToken;
        firstToken = undefined;
        callback(null, token);
        return;
      }
      void requestToken({ rooms: tokenRooms }).then(
        (token) => {
          if (active && version === generation) callback(null, token);
          else callback("실시간 연결이 종료되었어요.", null);
        },
        (error: unknown) => {
          if (version === generation) stopForAuth(error);
          callback("실시간 인증을 완료하지 못했어요.", null);
        },
      );
    });
    if (version !== generation || !active) {
      nextClient.close();
      return;
    }
    client = nextClient;
    stopConnection = client.onConnection((change) => {
      setState(change.current);
      emit({
        type: "connection",
        previous: change.previous,
        current: change.current,
      });
      if (change.current === "connected") schedule();
    });
    client.connect();
  }

  async function reconcile() {
    if (!active || running) return;
    const version = generation;
    running = true;
    dirty = false;
    try {
      if (!client) await initialize(version);
      if (!client || !active || version !== generation) return;
      // 제거할 채널이 붙어 있는 채로 권한을 줄이지 않도록 먼저 뗀다.
      for (const [name, binding] of bindings) {
        if (listeners.has(name)) continue;
        binding.channel.unsubscribe(binding.listener);
        binding.stopAttached();
        await binding.channel.detach();
        bindings.delete(name);
      }
      if (!active || version !== generation) return;
      tokenRooms = currentRooms();
      const desiredRooms = JSON.stringify(tokenRooms);
      if (authorizedRooms !== desiredRooms) {
        await client.authorize();
        authorizedRooms = desiredRooms;
      }
      if (!active || version !== generation) return;
      if (JSON.stringify(currentRooms()) !== desiredRooms) {
        dirty = true;
        return;
      }
      for (const name of listeners.keys()) {
        if (bindings.has(name)) continue;
        const channel = client.channel(name);
        const listener = (event: RealtimeEvent) => {
          for (const notify of [...(listeners.get(name) ?? [])]) notify(event);
        };
        const stopAttached = channel.onAttached((resumed) => {
          emit({ type: "channel", channel: name, state: "attached", resumed });
        });
        bindings.set(name, { channel, listener, stopAttached });
        // 연결 재시도는 SDK가 맡고, 구독 해제는 연결 완료를 기다리지 않는다.
        void channel.subscribe(listener).catch(() => {});
      }
    } catch {
      if (active && version === generation) setState("disconnected");
    } finally {
      running = false;
      if (dirty && active) schedule();
    }
  }

  return {
    start() {
      if (active) return;
      active = true;
      setState("connecting");
      schedule();
    },
    close,
    getSnapshot: () => state,
    subscribeState(listener) {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    subscribeLifecycle(listener) {
      lifecycleListeners.add(listener);
      return () => lifecycleListeners.delete(listener);
    },
    subscribe(channel, onEvent) {
      const subscribers = listeners.get(channel) ?? new Set();
      const listener = (event: RealtimeEvent) => onEvent(event);
      subscribers.add(listener);
      listeners.set(channel, subscribers);
      schedule();
      return () => {
        subscribers.delete(listener);
        if (!subscribers.size && listeners.get(channel) === subscribers) {
          listeners.delete(channel);
          schedule();
        }
      };
    },
  };
}
