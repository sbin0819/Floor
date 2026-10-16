import type { QueryClient } from "@tanstack/react-query";
import {
  notifySessionExpired,
  sessionNoticeGeneration,
} from "@/lib/errors/session-expired";
import {
  fetchRoomMessagesPage,
  type MessagePageQuery,
  type RoomMessagesPage,
} from "./client";

type Waiter = {
  resolve(value: RoomMessagesPage): void;
  reject(error: unknown): void;
  cleanup(): void;
};
type Entry = {
  key: string;
  roomId: string;
  query: MessagePageQuery;
  background: boolean;
  waiters: Set<Waiter>;
  controller: AbortController;
  retryAt: number;
  attempts: number;
};
const queues = new WeakMap<
  QueryClient,
  ReturnType<typeof createMessageRequestQueue>
>();
const aborted = () => new DOMException("Aborted", "AbortError");

function retryDelay(error: unknown): number | null {
  if (
    typeof error !== "object" ||
    error === null ||
    !("status" in error) ||
    error.status !== 429
  )
    return null;
  const delay = "retryAfterMs" in error ? error.retryAfterMs : 1_000;
  return typeof delay === "number" && Number.isFinite(delay)
    ? Math.max(1_000, delay)
    : 1_000;
}

export function createMessageRequestQueue(
  load = fetchRoomMessagesPage,
  now = Date.now,
) {
  const entries = new Map<string, Entry>();
  const starts: number[] = [];
  let active: Entry | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastBackground = -Infinity;
  let cooldown = 0;
  const settle = (
    entry: Entry,
    value: RoomMessagesPage | undefined,
    error?: unknown,
  ) => {
    if (entries.get(entry.key) === entry) entries.delete(entry.key);
    for (const waiter of entry.waiters) {
      waiter.cleanup();
      if (value) waiter.resolve(value);
      else waiter.reject(error);
    }
    entry.waiters.clear();
  };
  function drain() {
    clearTimeout(timer);
    if (active) return;
    const instant = now();
    while (starts.length && starts[0]! <= instant - 60_000) starts.shift();
    const pending = [...entries.values()].filter(
      (entry) => entry.waiters.size > 0,
    );
    pending.sort((a, b) => Number(a.background) - Number(b.background));
    const readyAt = (entry: Entry) =>
      Math.max(
        cooldown,
        entry.retryAt,
        starts.length >= 50 ? starts[0]! + 60_000 : 0,
        entry.background ? lastBackground + 2_000 : 0,
      );
    const next = pending.find((entry) => readyAt(entry) <= instant);
    if (!next) {
      if (pending.length)
        timer = setTimeout(
          drain,
          Math.max(1, Math.min(...pending.map(readyAt)) - instant),
        );
      return;
    }
    active = next;
    starts.push(instant);
    if (next.background) lastBackground = instant;
    let onAbort = () => {};
    const cancellation = new Promise<never>((_, reject) => {
      onAbort = () => reject(aborted());
      next.controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    let request: Promise<RoomMessagesPage>;
    try {
      request = load(next.roomId, next.query, {
        signal: next.controller.signal,
        retry: false,
      });
    } catch (error) {
      request = Promise.reject(error);
    }
    void Promise.race([request, cancellation])
      .then(
        (page) => settle(next, page),
        (error) => {
          const delay = retryDelay(error);
          if (delay !== null) cooldown = Math.max(cooldown, now() + delay);
          if (delay !== null && next.attempts < 1 && next.waiters.size) {
            next.attempts++;
            next.retryAt = cooldown;
          } else settle(next, undefined, error);
        },
      )
      .finally(() => {
        next.controller.signal.removeEventListener("abort", onAbort);
        if (active === next) active = null;
        drain();
      });
  }
  return {
    request(
      roomId: string,
      query: MessagePageQuery,
      options: { signal?: AbortSignal; background?: boolean } = {},
    ) {
      if (options.signal?.aborted)
        return Promise.reject<RoomMessagesPage>(aborted());
      const key = `${roomId}:${"before" in query ? `before:${query.before}` : `after:${query.after}`}`;
      let entry = entries.get(key);
      if (!entry) {
        entry = {
          key,
          roomId,
          query,
          background: options.background ?? false,
          waiters: new Set(),
          controller: new AbortController(),
          retryAt: 0,
          attempts: 0,
        };
        entries.set(key, entry);
      } else if (!options.background) entry.background = false;
      const target = entry;
      const promise = new Promise<RoomMessagesPage>((resolve, reject) => {
        const onAbort = () => {
          target.waiters.delete(waiter);
          waiter.cleanup();
          reject(aborted());
          if (!target.waiters.size) {
            if (entries.get(key) === target) entries.delete(key);
            target.controller.abort();
          }
          drain();
        };
        const waiter: Waiter = {
          resolve,
          reject,
          cleanup: () => options.signal?.removeEventListener("abort", onAbort),
        };
        target.waiters.add(waiter);
        options.signal?.addEventListener("abort", onAbort, { once: true });
      });
      drain();
      return promise;
    },
  };
}

export function requestMessagePage(
  client: QueryClient,
  roomId: string,
  query: MessagePageQuery,
  options: { signal?: AbortSignal; background?: boolean } = {},
) {
  const generation = sessionNoticeGeneration(client);
  let queue = queues.get(client);
  if (!queue) {
    queue = createMessageRequestQueue();
    queues.set(client, queue);
  }
  return queue.request(roomId, query, options).catch((error: unknown) => {
    if (!options.signal?.aborted)
      notifySessionExpired(client, error, generation);
    throw error;
  });
}
