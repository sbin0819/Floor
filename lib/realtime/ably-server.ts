import type { Rest } from "ably";

import type { RealtimeEvent, RealtimePublisher } from "@/lib/realtime/types";

export interface AblyRestPublisherClient {
  channels: {
    get(channel: string): {
      publish(name: string, event: RealtimeEvent): Promise<unknown>;
    };
  };
}

export function createAblyPublisher(
  client: AblyRestPublisherClient,
): RealtimePublisher {
  return {
    async publish(channel, event) {
      await client.channels.get(channel).publish(event.type, event);
    },
  };
}

export async function createAblyRestClient(key: string): Promise<Rest> {
  const { Rest } = await import("ably");
  return new Rest({ key, logLevel: 0 });
}
