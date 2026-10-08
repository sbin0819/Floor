import { getEnv } from "@/lib/env";
import {
  createAblyPublisher,
  createAblyRestClient,
  type AblyRestPublisherClient,
} from "@/lib/realtime/ably-server";
import { noopRealtime } from "@/lib/realtime/noop";
import type { RealtimePublisher } from "@/lib/realtime/types";

export function createServerRealtimePublisher({
  key,
  createClient = createAblyRestClient,
}: {
  key?: string;
  createClient?: (key: string) => Promise<AblyRestPublisherClient>;
}): RealtimePublisher {
  if (!key) return noopRealtime;
  let publisher: Promise<RealtimePublisher> | undefined;
  const load = () =>
    (publisher ??= createClient(key).then(createAblyPublisher));
  return {
    async publish(channel, event) {
      await (await load()).publish(channel, event);
    },
    async publishMany(items) {
      if (!items.length) return;
      await (await load()).publishMany(items);
    },
  };
}

let current:
  { key: string | undefined; publisher: RealtimePublisher } | undefined;

export function getRealtimePublisher(): RealtimePublisher {
  const { ABLY_API_KEY: key } = getEnv();
  if (!current || current.key !== key) {
    current = { key, publisher: createServerRealtimePublisher({ key }) };
  }
  return current.publisher;
}
