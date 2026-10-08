import type { QueryClient } from "@tanstack/react-query";
import type { RealtimeEvent } from "@/lib/realtime/types";
import { excerptOf } from "./message-text";
import { requestMessagePage } from "./message-requests";
import {
  mergeChatMessages,
  roomMessagesKey,
  type DisplayMessage,
} from "./components/message-state";

export function applyMessageEvent(
  rows: readonly DisplayMessage[],
  event: RealtimeEvent,
  names: ReadonlyMap<string, string>,
): DisplayMessage[] {
  if (event.type !== "message.updated" && event.type !== "message.deleted")
    return [...rows];
  const deleted = event.type === "message.deleted";
  const source = rows.find((row) => row.id === event.id);
  if (
    !deleted &&
    (source?.deletedAt || (source?.editedAt ?? "") > event.editedAt)
  )
    return [...rows];
  const mentionNames = new Map(names);
  if (!deleted)
    for (const mention of event.mentions)
      mentionNames.set(mention.userId, mention.name);
  return rows.map((row) => {
    if (row.id === event.id)
      return deleted
        ? {
            ...row,
            body: "",
            deletedAt: row.deletedAt ?? "1970-01-01T00:00:00.000Z",
            mentions: [],
            mentionsEveryone: false,
            reactions: [],
            reactionIntents: undefined,
          }
        : {
            ...row,
            body: event.body,
            mentions: event.mentions,
            mentionsEveryone: event.mentionsEveryone,
            editedAt: event.editedAt,
          };
    if (row.replyTo?.id === event.id)
      return {
        ...row,
        replyTo: {
          ...row.replyTo,
          deleted: deleted || row.replyTo.deleted,
          excerpt:
            deleted || row.replyTo.deleted
              ? "삭제된 메시지예요"
              : excerptOf(event.body, mentionNames),
        },
      };
    return row;
  });
}

const pageFor = (seq: number) => Math.floor((seq - 1) / 50);
const activeSyncs = new WeakMap<
  QueryClient,
  Map<string, Set<(seq: number) => void>>
>();
export function invalidateMessage(
  client: QueryClient,
  roomId: string,
  seq: number,
) {
  for (const changed of activeSyncs.get(client)?.get(roomId) ?? [])
    changed(seq);
}

export function createMessageSync(
  client: QueryClient,
  roomId: string,
  userId: string,
) {
  const revisions = new Map<number, number>();
  const pending = new Set<number>();
  const requests = new Map<number, AbortController>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active = false;
  let lifetime = 0;
  let visibleSeq: number | null = null;
  const rows = () =>
    client.getQueryData<DisplayMessage[]>(roomMessagesKey(roomId)) ?? [];
  async function refresh(page: number) {
    if (!active || requests.has(page)) return;
    const controller = new AbortController();
    requests.set(page, controller);
    const version = revisions.get(page) ?? 0;
    const life = lifetime;
    try {
      const result = await requestMessagePage(
        client,
        roomId,
        { before: (page + 1) * 50 + 1 },
        { signal: controller.signal, background: true },
      );
      if (!active || life !== lifetime) return;
      if ((revisions.get(page) ?? 0) !== version) {
        pending.add(page);
        return;
      }
      client.setQueryData<DisplayMessage[]>(
        roomMessagesKey(roomId),
        (current = []) => {
          const existing = new Set(
            current.filter((row) => !row.delivery).map((row) => row.id),
          );
          // 재검증은 이미 읽은 행만 갱신한다. 대기열·읽음 경계·스크롤 범위를 늘리지 않는다.
          return mergeChatMessages(
            current,
            result.messages.filter(
              (row) => existing.has(row.id) && pageFor(row.seq) === page,
            ),
            userId,
          );
        },
      );
    } catch {
      if (active && life === lifetime && !controller.signal.aborted)
        pending.add(page);
    } finally {
      if (requests.get(page) === controller) requests.delete(page);
      if (active && pending.size) schedule(2_000);
    }
  }
  function flush() {
    clearTimeout(timer);
    if (!active) return;
    const pages = [...pending];
    pending.clear();
    for (const page of pages) {
      if (requests.has(page)) pending.add(page);
      else void refresh(page);
    }
  }
  function schedule(delay = 250) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      flush();
    }, delay);
  }
  const changed = (seq: number, messageId?: string) => {
    if (!active || !Number.isSafeInteger(seq) || seq <= 0) return;
    const loaded = rows().filter((row) => !row.delivery && row.seq > 0);
    const sourceId = messageId ?? loaded.find((row) => row.seq === seq)?.id;
    const pages = new Set(
      loaded
        .filter(
          (row) =>
            pageFor(row.seq) === pageFor(seq) ||
            (sourceId !== undefined && row.replyTo?.id === sourceId),
        )
        .map((row) => pageFor(row.seq)),
    );
    for (const page of pages) {
      revisions.set(page, (revisions.get(page) ?? 0) + 1);
      pending.add(page);
    }
    if (pages.size) schedule();
  };
  return {
    start() {
      active = true;
      lifetime++;
      let rooms = activeSyncs.get(client);
      if (!rooms) {
        rooms = new Map();
        activeSyncs.set(client, rooms);
      }
      let listeners = rooms.get(roomId);
      if (!listeners) {
        listeners = new Set();
        rooms.set(roomId, listeners);
      }
      listeners.add(changed);
    },
    stop() {
      activeSyncs.get(client)?.get(roomId)?.delete(changed);
      active = false;
      lifetime++;
      clearTimeout(timer);
      pending.clear();
      for (const request of requests.values()) request.abort();
      requests.clear();
    },
    visible(seq: number | null) {
      visibleSeq = seq;
    },
    changed,
    revalidate() {
      if (!active) return;
      const pages = [
        ...new Set(
          rows()
            .filter((row) => !row.delivery && row.seq > 0)
            .map((row) => pageFor(row.seq)),
        ),
      ];
      const latest = Math.max(-1, ...pages);
      const visible = visibleSeq === null ? latest : pageFor(visibleSeq);
      pages.sort(
        (a, b) =>
          (a === visible ? -2 : a === latest ? -1 : -a / 1e9) -
          (b === visible ? -2 : b === latest ? -1 : -b / 1e9),
      );
      pending.clear();
      for (const page of pages) {
        revisions.set(page, (revisions.get(page) ?? 0) + 1);
        pending.add(page);
      }
      flush();
    },
  };
}
