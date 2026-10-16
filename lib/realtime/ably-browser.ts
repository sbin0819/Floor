import type { ConnectionState, TokenRequest } from "ably";
import { ApiError, isRequestCanceled } from "@/lib/http/errors";

import {
  fetchRealtimeToken,
  loadAblyBrowserClient,
  type AblyBrowserClient,
  type BrowserAuthCallback,
  type BrowserChannel,
  type RealtimeTokenInput,
  type PresenceMember,
} from "@/lib/realtime/ably-browser-client";
import { createPresenceRegistry, type PresenceObserver } from "./ably-presence";
import type { RealtimeEvent, RealtimeSubscriber } from "@/lib/realtime/types";
import type { StatusPresence } from "@/features/people/status";
import {
  createSpacePresence,
  type RealtimeScopeSnapshot,
} from "./ably-space-presence";

export type RealtimeConnectionState = ConnectionState | "disabled";
export type RealtimeLifecycleEvent =
  | { type: "connection"; previous: ConnectionState; current: ConnectionState }
  | { type: "channel"; channel: string; state: "attached"; resumed: boolean };

export interface BrowserRealtime extends RealtimeSubscriber {
  getScopeSnapshot?(): RealtimeScopeSnapshot;
  subscribeScope?(listener: () => void): () => void;
  setStatusPresence?(value: StatusPresence): void;
  subscribeSpaces?(listener: (event: RealtimeEvent) => void): () => void;
  reauthorize?(): void;
  observePresence(
    channel: string,
    onMembers: (members: readonly PresenceMember[]) => void,
  ): PresenceObserver;
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

function grantedChannels(token: TokenRequest) {
  const capability: unknown = JSON.parse(token.capability);
  if (
    !capability ||
    typeof capability !== "object" ||
    Array.isArray(capability)
  )
    throw new ApiError("invalid_response");
  const channels = new Set<string>();
  const presenceChannels = new Set<string>();
  for (const [name, operations] of Object.entries(capability)) {
    if (
      !Array.isArray(operations) ||
      !operations.every((operation) => typeof operation === "string")
    )
      throw new ApiError("invalid_response");
    if (!name.includes("*") && operations.includes("subscribe"))
      channels.add(name);
    if (!name.includes("*") && operations.includes("presence"))
      presenceChannels.add(name);
  }
  return { channels, presenceChannels };
}

export function createAblyBrowserRealtime({
  loadClient = loadAblyBrowserClient,
  requestToken = fetchRealtimeToken,
  debounceMs = 25,
}: {
  loadClient?: (callback: BrowserAuthCallback) => Promise<AblyBrowserClient>;
  requestToken?: (
    input: RealtimeTokenInput,
    signal?: AbortSignal,
  ) => Promise<TokenRequest>;
  debounceMs?: number;
} = {}): BrowserRealtime {
  const listeners = new Map<string, Set<(event: RealtimeEvent) => void>>();
  const bindings = new Map<string, Binding>();
  const presence = createPresenceRegistry();
  const spaces = createSpacePresence(presence);
  const spaceListeners = new Set<(event: RealtimeEvent) => void>();
  const stateListeners = new Set<() => void>();
  const lifecycleListeners = new Set<(event: RealtimeLifecycleEvent) => void>();
  let state: RealtimeConnectionState = "initialized";
  let client: AblyBrowserClient | undefined;
  let stopConnection: (() => void) | undefined;
  let active = false;
  let generation = 0;
  let authorizationRevision = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let dirty = false;
  let authorization:
    | { scope: string; channels: Set<string>; presenceChannels: Set<string> }
    | undefined;
  let failureScope: string | undefined;
  let recoveredFailure = false;
  const failedChannels = new Set<string>();
  const pendingAuthentications = new Set<object>();
  const tokenRequests = new Set<{
    controller: AbortController;
    scope: string;
    revision: number;
  }>();

  const setState = (next: RealtimeConnectionState) => {
    if (next === state) return;
    state = next;
    for (const notify of stateListeners) notify();
  };
  const emit = (event: RealtimeLifecycleEvent) => {
    for (const notify of lifecycleListeners) notify(event);
  };
  const channelIds = (prefix: string) =>
    [...listeners.keys()]
      .filter((channel) => channel.startsWith(prefix))
      .map((channel) => channel.slice(prefix.length))
      .sort();
  const currentChannels = (): RealtimeTokenInput => ({
    rooms: channelIds("room:"),
    spaces: channelIds("space:"),
  });

  async function requestScopedToken(
    input: RealtimeTokenInput,
    revision: number,
  ) {
    const request = {
      controller: new AbortController(),
      scope: JSON.stringify(input),
      revision,
    };
    tokenRequests.add(request);
    try {
      return await requestToken(input, request.controller.signal);
    } finally {
      tokenRequests.delete(request);
    }
  }

  function abortObsoleteTokens(all = false) {
    const scope = JSON.stringify(currentChannels());
    for (const request of tokenRequests) {
      if (
        all ||
        request.scope !== scope ||
        request.revision !== authorizationRevision
      )
        request.controller.abort();
    }
  }

  function resetClient() {
    generation += 1;
    abortObsoleteTokens(true);
    pendingAuthentications.clear();
    clearTimeout(timer);
    timer = undefined;
    stopConnection?.();
    stopConnection = undefined;
    spaces.reset();
    presence.reset();
    for (const binding of bindings.values()) {
      binding.channel.unsubscribe(binding.listener);
      binding.stopAttached();
    }
    bindings.clear();
    client?.close();
    client = undefined;
    authorization = undefined;
  }

  function close() {
    active = false;
    resetClient();
    spaces.reset(true);
    failureScope = undefined;
    failedChannels.clear();
    setState("closed");
  }

  function recoverClient() {
    resetClient();
    setState("connecting");
    schedule();
  }

  function stopForAuth(error: unknown) {
    if (
      error instanceof ApiError &&
      error.kind === "http" &&
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
    abortObsoleteTokens();
    if (!active || timer || running) return;
    timer = setTimeout(() => {
      timer = undefined;
      void reconcile();
    }, debounceMs);
  }

  async function initialize(version: number) {
    const firstInput = currentChannels();
    const firstRevision = authorizationRevision;
    let firstToken:
      { token: TokenRequest; scope: string; revision: number } | undefined;
    try {
      // 키가 없는 환경에서는 SDK를 불러오거나 Ably에 연결하지 않는다.
      firstToken = {
        token: await requestScopedToken(firstInput, firstRevision),
        scope: JSON.stringify(firstInput),
        revision: firstRevision,
      };
    } catch (error) {
      if (
        version !== generation ||
        !active ||
        firstRevision !== authorizationRevision ||
        JSON.stringify(firstInput) !== JSON.stringify(currentChannels()) ||
        isRequestCanceled(error) ||
        stopForAuth(error)
      )
        return;
    }
    if (version !== generation || !active) return;
    const nextClient = await loadClient((callback) => {
      const authentication = {};
      pendingAuthentications.add(authentication);
      let replied = false;
      const reply: typeof callback = (error, token) => {
        if (replied) return;
        replied = true;
        pendingAuthentications.delete(authentication);
        callback(error, token);
      };
      if (!active || version !== generation) {
        reply("실시간 연결이 종료되었어요.", null);
        return;
      }
      const provideToken = async () => {
        while (active && version === generation) {
          const input = currentChannels();
          const scope = JSON.stringify(input);
          const revision = authorizationRevision;
          const cached = firstToken;
          firstToken = undefined;
          // SDK 로딩·연결을 기다리는 동안 바뀐 선택에 이전 토큰을 넘기지 않는다.
          let token: TokenRequest;
          try {
            token =
              cached?.scope === scope && cached.revision === revision
                ? cached.token
                : await requestScopedToken(input, revision);
          } catch (error) {
            if (
              !active ||
              version !== generation ||
              JSON.stringify(currentChannels()) !== scope ||
              revision !== authorizationRevision
            )
              continue;
            if (!isRequestCanceled(error)) stopForAuth(error);
            reply("실시간 인증을 완료하지 못했어요.", null);
            return;
          }
          if (!active || version !== generation) break;
          if (
            JSON.stringify(currentChannels()) !== scope ||
            revision !== authorizationRevision
          )
            continue;
          authorization = { scope, ...grantedChannels(token) };
          spaces.authorize(
            authorization.channels,
            authorization.presenceChannels,
            input.rooms,
          );
          reply(null, token);
          schedule();
          return;
        }
        reply("실시간 연결이 종료되었어요.", null);
      };
      void provideToken().catch(() => {
        reply("실시간 인증을 완료하지 못했어요.", null);
      });
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
      if (change.current === "connected") {
        for (const name of bindings.keys()) presence.resync(name);
        schedule();
      }
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
      const desiredChannels = JSON.stringify(currentChannels());
      if (failureScope !== desiredChannels) {
        failureScope = desiredChannels;
        recoveredFailure = false;
        failedChannels.clear();
      }
      // 제거할 채널이 붙어 있는 채로 권한을 줄이지 않도록 먼저 뗀다.
      for (const [name, binding] of bindings) {
        if (
          (listeners.has(name) ||
            (name.startsWith("space:") &&
              (spaceListeners.size > 0 ||
                authorization?.presenceChannels.has(name)))) &&
          authorization?.channels.has(name)
        )
          continue;
        binding.channel.unsubscribe(binding.listener);
        binding.stopAttached();
        bindings.delete(name);
        try {
          await presence.unbind(name);
          await binding.channel.detach();
        } catch {
          // failed 채널은 detach도 실패한다. SDK 객체를 버려 다음 방을 막지 않게 한다.
          if (active && version === generation) recoverClient();
          return;
        }
      }
      if (!active || version !== generation) return;
      if (authorization?.scope !== desiredChannels) {
        // SDK의 최초 인증이 아직 진행 중이면 같은 범위의 토큰을 또 요청하지 않는다.
        if (pendingAuthentications.size) return;
        await client.authorize();
      }
      if (!active || version !== generation) return;
      if (
        JSON.stringify(currentChannels()) !== desiredChannels ||
        authorization?.scope !== desiredChannels
      ) {
        dirty = true;
        return;
      }
      const spaceChannels = [...authorization.channels].filter(
        (name) =>
          name.startsWith("space:") &&
          (spaceListeners.size > 0 ||
            authorization?.presenceChannels.has(name)),
      );
      for (const name of new Set([...listeners.keys(), ...spaceChannels])) {
        if (
          bindings.has(name) ||
          failedChannels.has(name) ||
          !authorization.channels.has(name)
        )
          continue;
        const channel = client.channel(name);
        const listener = (event: RealtimeEvent) => {
          for (const notify of [...(listeners.get(name) ?? [])]) notify(event);
          if (name.startsWith("space:"))
            for (const notify of spaceListeners) notify(event);
        };
        const stopAttached = channel.onAttached((resumed) => {
          presence.resync(name);
          emit({ type: "channel", channel: name, state: "attached", resumed });
        });
        const binding = { channel, listener, stopAttached };
        bindings.set(name, binding);
        void channel.subscribe(listener).catch(() => {
          if (
            !active ||
            version !== generation ||
            bindings.get(name) !== binding
          )
            return;
          channel.unsubscribe(listener);
          stopAttached();
          // 같은 권한으로 계속 실패할 때 무한 재연결하지 않는다.
          if (!recoveredFailure) {
            recoveredFailure = true;
            recoverClient();
          } else {
            failedChannels.add(name);
            setState("disconnected");
          }
        });
      }
      for (const [name, binding] of bindings) {
        if (
          authorization.presenceChannels.has(name) &&
          presence.hasObservers(name)
        )
          presence.bind(name, binding.channel.presence);
        else await presence.unbind(name);
      }
    } catch {
      if (active && version === generation) setState("disconnected");
    } finally {
      running = false;
      if (dirty && active) schedule();
    }
  }

  const subscribe: RealtimeSubscriber["subscribe"] = (channel, onEvent) => {
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
  };

  return {
    getScopeSnapshot: spaces.getSnapshot,
    subscribeScope: spaces.subscribe,
    setStatusPresence: spaces.setStatus,
    subscribeSpaces(listener) {
      spaceListeners.add(listener);
      schedule();
      return () => {
        spaceListeners.delete(listener);
        schedule();
      };
    },
    reauthorize() {
      authorizationRevision += 1;
      if (authorization) authorization = { ...authorization, scope: "" };
      schedule();
    },
    observePresence(channel, onMembers) {
      const stop = subscribe(channel, () => {});
      const observer = presence.observe(channel, onMembers);
      return {
        update: observer.update,
        close() {
          observer.close();
          stop();
          schedule();
        },
      };
    },
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
    subscribe,
  };
}
