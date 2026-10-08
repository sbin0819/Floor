"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useState,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  createAblyBrowserRealtime,
  type BrowserRealtime,
  type RealtimeConnectionState,
  type RealtimeLifecycleEvent,
} from "@/lib/realtime/ably-browser";
import { userChannel } from "@/lib/realtime/channels";
import type { RealtimeEvent } from "@/lib/realtime/types";
import type { PresenceMember } from "@/lib/realtime/ably-browser-client";
import type {
  PresenceData,
  PresenceObserver,
} from "@/lib/realtime/ably-presence";
import { emptyScopeSnapshot } from "@/lib/realtime/ably-space-presence";
import {
  aggregatePresence,
  type StatusPresence,
} from "@/features/people/status";

const RealtimeContext = createContext<BrowserRealtime | null>(null);
const subscribeDisabled = () => () => {};
const disabledSnapshot = (): RealtimeConnectionState => "disabled";
const initialSnapshot = (): RealtimeConnectionState => "initialized";
const emptyScope = () => emptyScopeSnapshot;

export function RealtimeProvider({
  children,
  createRealtime = createAblyBrowserRealtime,
}: {
  children: ReactNode;
  createRealtime?: () => BrowserRealtime;
}) {
  const [realtime] = useState(createRealtime);
  useEffect(() => () => realtime.close(), [realtime]);
  return <RealtimeContext value={realtime}>{children}</RealtimeContext>;
}

// 세션만 기다리는 작은 조각이 연결을 켜므로 고정된 앱의 틀은 먼저 그려진다.
export function RealtimeSession({ userId }: { userId: string | null }) {
  const realtime = useContext(RealtimeContext);
  useEffect(() => {
    if (!realtime || !userId) return;
    const unsubscribe = realtime.subscribe(userChannel(userId), () => {});
    realtime.start();
    return () => {
      unsubscribe();
      realtime.close();
    };
  }, [realtime, userId]);
  return null;
}

export function useRealtimeChannel(
  channel: string | null,
  onEvent: (event: RealtimeEvent) => void,
) {
  const realtime = useContext(RealtimeContext);
  const handleEvent = useEffectEvent(onEvent);
  useEffect(() => {
    if (!realtime || !channel) return;
    return realtime.subscribe(channel, (event) => handleEvent(event));
  }, [channel, realtime]);
}

export function useRealtimeConnectionState(): RealtimeConnectionState {
  const realtime = useContext(RealtimeContext);
  return useSyncExternalStore(
    realtime?.subscribeState ?? subscribeDisabled,
    realtime?.getSnapshot ?? disabledSnapshot,
    realtime ? initialSnapshot : disabledSnapshot,
  );
}

export function useRealtimeLifecycle(
  onEvent: (event: RealtimeLifecycleEvent) => void,
) {
  const realtime = useContext(RealtimeContext);
  const handleEvent = useEffectEvent(onEvent);
  useEffect(
    () => realtime?.subscribeLifecycle((event) => handleEvent(event)),
    [realtime],
  );
}

export function useRealtimePresence(
  channel: string | null,
  onMembers: (members: readonly PresenceMember[]) => void,
) {
  const realtime = useContext(RealtimeContext);
  const observer = useRef<PresenceObserver | null>(null);
  const receive = useEffectEvent(onMembers);
  useEffect(() => {
    if (!realtime || !channel) return;
    const current = realtime.observePresence(channel, (members) =>
      receive(members),
    );
    observer.current = current;
    return () => {
      observer.current = null;
      current.close();
    };
  }, [channel, realtime]);
  return useCallback(
    (data: PresenceData) => observer.current?.update(data),
    [],
  );
}

export function useRealtimeScope() {
  const realtime = useContext(RealtimeContext);
  return useSyncExternalStore(
    realtime?.subscribeScope ?? subscribeDisabled,
    realtime?.getScopeSnapshot ?? emptyScope,
    emptyScope,
  );
}

export function usePresenceStatus(userId: string, sharesSpace: boolean) {
  return usePresenceStatuses([{ userId, sharesSpace }])[userId] ?? "unknown";
}

export function usePresenceStatuses(
  people: readonly { userId: string; sharesSpace: boolean }[],
) {
  const scope = useRealtimeScope();
  const connection = useRealtimeConnectionState();
  const spaces = Object.values(scope.spaces);
  const ready =
    connection === "connected" &&
    scope.channels !== null &&
    spaces.length > 0 &&
    spaces.every((space) => space.synced);
  return Object.fromEntries(
    people.map(({ userId, sharesSpace }) => [
      userId,
      ready
        ? aggregatePresence(
            spaces.flatMap(({ members }) =>
              members
                .filter((member) => member.clientId === userId)
                .map((member) => member.data),
            ),
            sharesSpace,
            // bool sharesSpace만으로는 100개 밖에서만 공유하는지 확인할 수 없다.
            scope.channels!.filter((channel) => channel.startsWith("space:"))
              .length < 100,
          )
        : ("unknown" as const),
    ]),
  );
}

export function useStatusPresencePublisher() {
  const realtime = useContext(RealtimeContext);
  return useCallback(
    (value: StatusPresence) => realtime?.setStatusPresence?.(value),
    [realtime],
  );
}

export function useRealtimeReauthorize() {
  const realtime = useContext(RealtimeContext);
  return useCallback(() => realtime?.reauthorize?.(), [realtime]);
}

export function useRealtimeSpaces(onEvent: (event: RealtimeEvent) => void) {
  const realtime = useContext(RealtimeContext);
  const receive = useEffectEvent(onEvent);
  useEffect(
    () => realtime?.subscribeSpaces?.((event) => receive(event)),
    [realtime],
  );
}
