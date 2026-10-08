import type { StatusPresence } from "@/features/people/status";
import type { PresenceMember } from "./ably-browser-client";
import type { createPresenceRegistry, PresenceObserver } from "./ably-presence";

export type RealtimeScopeSnapshot = {
  channels: readonly string[] | null;
  requestedRooms: readonly string[];
  spaces: Readonly<
    Record<string, { members: readonly PresenceMember[]; synced: boolean }>
  >;
  status: StatusPresence | null;
};
export const emptyScopeSnapshot: RealtimeScopeSnapshot = {
  channels: null,
  requestedRooms: [],
  spaces: {},
  status: null,
};

// 기존 연결 인스턴스에만 속한다. 토큰의 승인 목록 밖 스페이스는 만들지 않는다.
export function createSpacePresence(
  registry: ReturnType<typeof createPresenceRegistry>,
) {
  let snapshot = emptyScopeSnapshot;
  const subscribers = new Set<() => void>();
  const observers = new Map<string, PresenceObserver>();
  const pending = new Map<string, StatusPresence>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const notify = () => {
    for (const listener of subscribers) listener();
  };
  const flush = () => {
    timer = undefined;
    const item = pending.entries().next().value;
    if (!item) return;
    const [name, value] = item;
    pending.delete(name);
    observers.get(name)?.update(value);
    if (pending.size) timer = setTimeout(flush, 50);
  };
  const enqueue = (name: string, value: StatusPresence) => {
    pending.set(name, value);
    if (!timer) timer = setTimeout(flush, 0);
  };
  function updateSpace(
    name: string,
    patch: Partial<RealtimeScopeSnapshot["spaces"][string]>,
  ) {
    if (!snapshot.spaces[name]) return;
    snapshot = {
      ...snapshot,
      spaces: {
        ...snapshot.spaces,
        [name]: { ...snapshot.spaces[name], ...patch },
      },
    };
    notify();
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    channels: () => observers.keys(),
    authorize(
      channels: ReadonlySet<string>,
      presenceChannels: ReadonlySet<string>,
      requestedRooms: readonly string[] = [],
    ) {
      const names = [...channels].filter(
        (name) => name.startsWith("space:") && presenceChannels.has(name),
      );
      const next = new Set(names);
      for (const [name, observer] of observers) {
        if (next.has(name)) continue;
        observer.close();
        observers.delete(name);
        pending.delete(name);
      }
      snapshot = {
        ...snapshot,
        channels: [...channels].sort(),
        requestedRooms,
        spaces: Object.fromEntries(
          names.map((name) => [
            name,
            snapshot.spaces[name] ?? { members: [], synced: false },
          ]),
        ),
      };
      for (const name of names) {
        if (observers.has(name)) continue;
        const observer = registry.observe(
          name,
          (members) => updateSpace(name, { members }),
          (synced) => updateSpace(name, { synced }),
        );
        observers.set(name, observer);
        if (snapshot.status) enqueue(name, snapshot.status);
      }
      notify();
    },
    setStatus(value: StatusPresence) {
      if (
        snapshot.status?.status === value.status &&
        snapshot.status.auto === value.auto
      )
        return;
      snapshot = { ...snapshot, status: value };
      for (const name of observers.keys()) enqueue(name, value);
      notify();
    },
    reset(clearStatus = false) {
      clearTimeout(timer);
      timer = undefined;
      pending.clear();
      for (const observer of observers.values()) observer.close();
      observers.clear();
      snapshot = {
        ...emptyScopeSnapshot,
        status: clearStatus ? null : snapshot.status,
      };
      notify();
    },
  };
}
