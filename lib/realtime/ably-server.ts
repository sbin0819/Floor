import type { BatchPublishSpec, Rest } from "ably";

import type {
  RealtimeEvent,
  RealtimeItem,
  RealtimePublisher,
} from "@/lib/realtime/types";

export interface AblyRestPublisherClient {
  channels: {
    get(channel: string): {
      publish(name: string, event: RealtimeEvent): Promise<unknown>;
    };
  };
  batchPublish(specs: BatchPublishSpec[]): Promise<{ failureCount: number }[]>;
}

// Ably는 한 요청에서 서로 다른 채널 100개, 본문 2MiB까지 허용한다.
// 항목 수도 100개로 제한해 채널·메시지 순서를 유지하고 인코딩 여유를 둔다.
const maxBatchItems = 100;
const maxBatchBytes = 2 * 1024 * 1024 - 1024;
const maxMessageBytes = 64 * 1024;
const encoder = new TextEncoder();
const publicationFailure = () =>
  new Error("Realtime batch publication failed.");

function batchSpecs(items: readonly RealtimeItem[]): BatchPublishSpec[][] {
  const batches: BatchPublishSpec[][] = [];
  let batch: BatchPublishSpec[] = [];
  let bytes = 2;
  for (const { channel, event } of items) {
    const message = { name: event.type, data: event };
    if (encoder.encode(JSON.stringify(message)).byteLength > maxMessageBytes) {
      throw publicationFailure();
    }
    const spec = { channels: [channel], messages: [message] };
    const size = encoder.encode(JSON.stringify(spec)).byteLength;
    if (size + 2 > maxBatchBytes) throw publicationFailure();
    if (batch.length === maxBatchItems || bytes + size + 1 > maxBatchBytes) {
      batches.push(batch);
      batch = [];
      bytes = 2;
    }
    batch.push(spec);
    bytes += size + 1;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

export function createAblyPublisher(
  client: AblyRestPublisherClient,
): RealtimePublisher {
  return {
    async publish(channel, event) {
      await client.channels.get(channel).publish(event.type, event);
    },
    async publishMany(items) {
      const batches = batchSpecs(items);
      let failed = false;
      for (const batch of batches) {
        try {
          const results = await client.batchPublish(batch);
          if (results.some((result) => result.failureCount > 0)) failed = true;
        } catch {
          // 한 묶음 실패 때문에 뒤에 있는 수신자의 발행까지 포기하지 않는다.
          failed = true;
        }
      }
      if (failed) throw publicationFailure();
    },
  };
}

export async function createAblyRestClient(key: string): Promise<Rest> {
  const { Rest } = await import("ably");
  return new Rest({ key, logLevel: 0 });
}
