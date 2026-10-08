import {
  fetchRoomMessagesPage,
  type MessagePageQuery,
  type RoomMessagesPage,
} from "./client";
import type { ChatMessage } from "./types";

export type ChatHistoryReset = {
  version: number;
  lastReadSeq: number | null;
  firstUnreadSeq: number | null;
};
export type ChatCatchUpSnapshot = {
  reconnecting: boolean;
  historyReset: ChatHistoryReset | null;
};
export type LoadMessagePage = (
  roomId: string,
  query: MessagePageQuery,
  options?: { signal?: AbortSignal },
) => Promise<RoomMessagesPage>;

export function createRoomCatchUp({
  roomId,
  merge,
  replace,
  loadPage = fetchRoomMessagesPage,
}: {
  roomId: string;
  merge(messages: ChatMessage[]): void;
  replace(messages: ChatMessage[]): void;
  loadPage?: LoadMessagePage;
}) {
  const listeners = new Set<() => void>();
  const ahead = new Set<number>();
  let cursor: number | null = null;
  let target = 0;
  let active = false;
  let broken = false;
  let generation = 0;
  let forceAgain = false;
  let request: AbortController | null = null;
  let snapshot: ChatCatchUpSnapshot = {
    reconnecting: false,
    historyReset: null,
  };

  const update = (next: ChatCatchUpSnapshot) => {
    if (
      snapshot.reconnecting === next.reconnecting &&
      snapshot.historyReset === next.historyReset
    )
      return;
    snapshot = next;
    for (const notify of listeners) notify();
  };
  const observe = (seq: number) => {
    if (cursor === null || seq <= cursor) return;
    target = Math.max(target, seq);
    ahead.add(seq);
    while (ahead.delete(cursor + 1)) cursor += 1;
  };

  async function sync(force = true) {
    if (!active || cursor === null) return;
    if (request) {
      forceAgain ||= force;
      return;
    }
    const controller = new AbortController();
    request = controller;
    const version = generation;
    let stalled = false;
    try {
      do {
        forceAgain = false;
        const beforeCursor: number = cursor;
        const page = await loadPage(
          roomId,
          { after: cursor },
          { signal: controller.signal },
        );
        if (!active || version !== generation) return;
        if (page.hasMore) {
          const recent = await loadPage(
            roomId,
            { before: page.lastSeq + 1 },
            { signal: controller.signal },
          );
          if (!active || version !== generation) return;
          replace(recent.messages);
          cursor = Math.max(
            0,
            ...recent.messages.map((message) => message.seq),
          );
          target = Math.max(target, recent.lastSeq);
          ahead.clear();
          update({
            ...snapshot,
            historyReset: {
              version: (snapshot.historyReset?.version ?? 0) + 1,
              firstUnreadSeq: recent.firstUnreadSeq,
              lastReadSeq: recent.lastReadSeq,
            },
          });
        } else {
          merge(page.messages);
          for (const message of page.messages) observe(message.seq);
          target = Math.max(target, page.lastSeq);
        }
        // 아직 저장 전인 이벤트 등으로 서버가 두 번 제자리면 무한 재요청하지 않는다.
        if (cursor === beforeCursor && target > cursor) {
          if (stalled) throw new Error("메시지 연결을 확인하지 못했어요.");
          stalled = true;
        } else stalled = false;
      } while (
        active &&
        version === generation &&
        (target > cursor || forceAgain)
      );
      if (active && version === generation)
        update({ ...snapshot, reconnecting: broken });
    } catch {
      if (active && version === generation)
        update({ ...snapshot, reconnecting: true });
    } finally {
      if (request === controller) request = null;
    }
  }

  return {
    start(lastSeq: number) {
      active = true;
      if (cursor === null) cursor = lastSeq;
      target = Math.max(target, lastSeq);
    },
    stop() {
      active = false;
      generation += 1;
      request?.abort();
      request = null;
      forceAgain = false;
    },
    receive(seq: number) {
      observe(seq);
      if (cursor !== null && target > cursor) void sync(false);
    },
    disconnected() {
      broken = true;
      update({ ...snapshot, reconnecting: true });
    },
    connected() {
      broken = false;
      void sync();
    },
    sync,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
