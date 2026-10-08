import type { ActionResult } from "@/lib/actions/result";
import type { ChatMessage } from "./types";

export type SendChatMessage = (input: {
  roomId: string;
  clientId: string;
  body: string;
  replyToId?: string;
}) => Promise<ActionResult<ChatMessage>>;
export type QueuedMessage = {
  roomId: string;
  message: ChatMessage & { clientId: string };
  send: SendChatMessage;
  navigationRevision?: number;
};
type RoomQueue = {
  entries: QueuedMessage[];
  running: boolean;
  blocked: boolean;
  timer?: ReturnType<typeof setTimeout>;
};

export function createChatSendQueue({
  online,
  confirmed,
  failed,
}: {
  online: () => boolean;
  confirmed: (entry: QueuedMessage, message: ChatMessage) => void;
  failed: (
    entry: QueuedMessage,
    result: Extract<ActionResult<ChatMessage>, { ok: false }>,
  ) => void;
}) {
  const rooms = new Map<string, RoomQueue>();
  const listeners = new Set<() => void>();
  let disposed = false;
  let resumeVersion = 0;
  const notify = () => {
    for (const listener of listeners) listener();
  };
  async function drain(room: RoomQueue) {
    if (disposed || room.running || room.blocked || room.timer || !online())
      return;
    room.running = true;
    try {
      while (room.entries.length && online() && !disposed) {
        const entry = room.entries[0]!;
        const attemptVersion = resumeVersion;
        let result: ActionResult<ChatMessage>;
        try {
          result = await entry.send({
            roomId: entry.roomId,
            clientId: entry.message.clientId,
            body: entry.message.body,
            ...(entry.message.replyTo
              ? { replyToId: entry.message.replyTo.id }
              : {}),
          });
        } catch {
          // 결과를 받지 못했으므로 같은 ID로만 재전송한다. 뒤의 메시지가 앞서지 않는다.
          if (resumeVersion !== attemptVersion && online() && !disposed)
            continue;
          room.blocked = true;
          return;
        }
        if (disposed) return;
        if (
          !result.ok &&
          result.code === "LIMIT_EXCEEDED" &&
          result.message === "send_rate"
        ) {
          room.timer = setTimeout(() => {
            room.timer = undefined;
            void drain(room);
          }, 10_000);
          return;
        }
        room.entries.shift();
        if (result.ok) confirmed(entry, result.data);
        else failed(entry, result);
        notify();
      }
    } finally {
      room.running = false;
    }
  }
  return {
    enqueue(entry: QueuedMessage) {
      if (disposed) return;
      let room = rooms.get(entry.roomId);
      if (!room) {
        room = { entries: [], running: false, blocked: false };
        rooms.set(entry.roomId, room);
      }
      if (
        room.entries.some(
          (pending) => pending.message.clientId === entry.message.clientId,
        )
      )
        return;
      room.entries.push(entry);
      notify();
      void drain(room);
    },
    resume() {
      resumeVersion += 1;
      for (const room of rooms.values()) {
        room.blocked = false;
        void drain(room);
      }
    },
    pending(roomId?: string) {
      return roomId === undefined
        ? [...rooms.values()].reduce(
            (count, room) => count + room.entries.length,
            0,
          )
        : (rooms.get(roomId)?.entries.length ?? 0);
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      disposed = true;
      for (const room of rooms.values()) clearTimeout(room.timer);
      rooms.clear();
      listeners.clear();
    },
  };
}
