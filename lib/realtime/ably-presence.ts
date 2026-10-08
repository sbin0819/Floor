import type { BrowserPresence, PresenceMember } from "./ably-browser-client";

export type PresenceData = Record<string, unknown>;
export type PresenceObserver = {
  update(data: PresenceData): void;
  close(): void;
};

type Watcher = {
  notify: (members: readonly PresenceMember[]) => void;
  data?: PresenceData;
  order: number;
};
type Binding = {
  presence: BrowserPresence;
  active: boolean;
  ready: boolean;
  entered: boolean;
  sent?: PresenceData;
  refresh: number;
  onChange: () => void;
  operation?: Promise<void>;
};
type Entry = { watchers: Set<Watcher>; binding?: Binding };

// room의 typing과 space의 status는 소비자가 각각 검증한다. 둘을 합쳐 발행하지 않는다.
export function createPresenceRegistry() {
  const entries = new Map<string, Entry>();
  let order = 0;

  const notify = (entry: Entry, members: readonly PresenceMember[]) => {
    for (const watcher of entry.watchers) watcher.notify(members);
  };
  const desired = (entry: Entry) =>
    [...entry.watchers]
      .filter((watcher) => watcher.data)
      .sort((a, b) => b.order - a.order)[0]?.data;

  function flush(entry: Entry, binding: Binding) {
    if (!binding.active || !binding.ready || binding.operation) return;
    let failed = false;
    const run = async () => {
      while (binding.active) {
        const data = desired(entry);
        if (data === binding.sent) return;
        try {
          if (!data) {
            if (binding.entered) await binding.presence.leave();
            binding.entered = false;
          } else if (binding.entered) {
            await binding.presence.update(data);
          } else {
            // 결과가 불명확한 enter 실패도 나갈 때 정리하도록 먼저 표시한다.
            binding.entered = true;
            await binding.presence.enter(data);
          }
          binding.sent = data;
        } catch {
          failed = true;
          return;
        }
      }
    };
    binding.operation = run().finally(() => {
      binding.operation = undefined;
      if (!failed && desired(entry) !== binding.sent) flush(entry, binding);
    });
  }

  function resetBinding(entry: Entry) {
    const binding = entry.binding;
    if (!binding) return;
    binding.active = false;
    binding.presence.unsubscribe(binding.onChange);
    entry.binding = undefined;
    notify(entry, []);
    return binding;
  }

  return {
    hasObservers: (channel: string) =>
      (entries.get(channel)?.watchers.size ?? 0) > 0,
    observe(channel: string, notify: Watcher["notify"]): PresenceObserver {
      const entry = entries.get(channel) ?? { watchers: new Set<Watcher>() };
      entries.set(channel, entry);
      const watcher: Watcher = { notify, order: 0 };
      entry.watchers.add(watcher);
      let closed = false;
      entry.binding?.onChange();
      return {
        update(data) {
          if (closed) return;
          watcher.data = data;
          watcher.order = ++order;
          if (entry.binding) flush(entry, entry.binding);
        },
        close() {
          if (closed) return;
          closed = true;
          entry.watchers.delete(watcher);
          if (entry.binding) flush(entry, entry.binding);
          else if (!entry.watchers.size) entries.delete(channel);
        },
      };
    },
    bind(channel: string, presence: BrowserPresence) {
      const entry = entries.get(channel);
      if (!entry || entry.binding) return;
      const binding: Binding = {
        presence,
        active: true,
        ready: false,
        entered: false,
        refresh: 0,
        onChange: () => {
          if (!binding.active) return;
          const version = ++binding.refresh;
          void presence
            .get()
            .then((members) => {
              if (binding.active && version === binding.refresh)
                notify(entry, members);
            })
            .catch(() => {});
        },
      };
      entry.binding = binding;
      void presence
        .subscribe(binding.onChange)
        .then(() => {
          if (!binding.active) return;
          binding.ready = true;
          binding.onChange();
          flush(entry, binding);
        })
        .catch(() => {});
    },
    async unbind(channel: string) {
      const entry = entries.get(channel);
      if (!entry) return;
      const binding = resetBinding(entry);
      if (binding) {
        await binding.operation;
        if (binding.entered) await binding.presence.leave().catch(() => {});
      }
      if (!entry.watchers.size && entries.get(channel) === entry)
        entries.delete(channel);
    },
    reset() {
      for (const [channel, entry] of entries) {
        resetBinding(entry);
        if (!entry.watchers.size) entries.delete(channel);
      }
    },
  };
}
