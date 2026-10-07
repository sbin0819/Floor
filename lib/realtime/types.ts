export type RealtimeEvent =
  | { type: "booking.changed"; spaceId: string }
  | { type: "space.status_changed"; spaceId: string }
  | { type: "plan.published"; floorId: string; version: number }
  | {
      type: "message.created";
      roomId: string;
      id: string;
      seq: number;
      authorId: string | null;
      kind: "text" | "system";
      body: string;
      createdAt: string;
    };

export interface RealtimePublisher {
  publish(channel: string, event: RealtimeEvent): Promise<void>;
}

export interface RealtimeSubscriber {
  subscribe(
    channel: string,
    onEvent: (event: RealtimeEvent) => void,
  ): () => void;
}
