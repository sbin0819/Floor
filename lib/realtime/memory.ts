import type {
  RealtimeEvent,
  RealtimePublisher,
  RealtimeSubscriber,
} from "@/lib/realtime/types";

export function createMemoryRealtime(): RealtimePublisher & RealtimeSubscriber {
  const channels = new Map<string, Set<(event: RealtimeEvent) => void>>();

  return {
    async publish(channel, event) {
      for (const notify of [...(channels.get(channel) ?? [])]) notify(event);
    },
    subscribe(channel, onEvent) {
      const listeners = channels.get(channel) ?? new Set();
      // 같은 콜백으로 여러 번 구독해도 각 해제 함수는 자기 구독만 제거한다.
      const notify = (event: RealtimeEvent) => onEvent(event);
      listeners.add(notify);
      channels.set(channel, listeners);

      return () => {
        listeners.delete(notify);
        if (listeners.size === 0 && channels.get(channel) === listeners) {
          channels.delete(channel);
        }
      };
    },
  };
}
