"use client";

import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useState,
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

const RealtimeContext = createContext<BrowserRealtime | null>(null);
const subscribeDisabled = () => () => {};
const disabledSnapshot = (): RealtimeConnectionState => "disabled";
const initialSnapshot = (): RealtimeConnectionState => "initialized";

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
