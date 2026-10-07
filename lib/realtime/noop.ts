import type {
  RealtimePublisher,
  RealtimeSubscriber,
} from "@/lib/realtime/types";

export const noopRealtime: RealtimePublisher & RealtimeSubscriber = {
  async publish() {},
  subscribe() {
    return () => {};
  },
};
