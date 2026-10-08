"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

const minute = 60_000;

function createDisplayClock() {
  let snapshot: string | null = null;
  let latestServerTime = -Infinity;
  let anchorTime: number | null = null;
  let anchorClientTime: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let active = false;
  const listeners = new Set<() => void>();

  function projectedTime() {
    if (anchorTime === null || anchorClientTime === null) return null;
    return Math.max(
      snapshot === null ? anchorTime : Date.parse(snapshot),
      anchorTime + Math.max(0, Date.now() - anchorClientTime),
    );
  }

  function publish(value: number) {
    const next = new Date(value).toISOString();
    if (snapshot === next) return;
    snapshot = next;
    for (const listener of listeners) listener();
  }

  function clearTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function schedule(value: number) {
    clearTimer();
    if (!active || document.visibilityState === "hidden") return;
    timer = setTimeout(tick, minute - (value % minute));
  }

  function tick() {
    const current = projectedTime();
    if (current === null) return;
    publish(current);
    schedule(current);
  }

  function synchronize(now: string) {
    const serverTime = Date.parse(now);
    if (!Number.isFinite(serverTime) || serverTime <= latestServerTime) return;
    // 보존된 화면이나 늦은 응답이 새 시각을 덮거나 진행한 시계를 되돌리지 않는다.
    latestServerTime = serverTime;
    anchorTime = Math.max(serverTime, projectedTime() ?? serverTime);
    anchorClientTime = Date.now();
    publish(anchorTime);
    schedule(anchorTime);
  }

  function resume() {
    if (document.visibilityState === "hidden") clearTimer();
    else tick();
  }

  return {
    synchronize,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start() {
      active = true;
      // Activity 복귀에는 원래 anchor를 유지해 숨겨졌던 동안의 경과도 반영한다.
      tick();
      document.addEventListener("visibilitychange", resume);
      window.addEventListener("pageshow", resume);
      return () => {
        active = false;
        clearTimer();
        document.removeEventListener("visibilitychange", resume);
        window.removeEventListener("pageshow", resume);
      };
    },
  };
}

const serverSnapshot = () => null;
const BranchDisplayClockContext = createContext<{
  branchId: string;
  clock: ReturnType<typeof createDisplayClock>;
} | null>(null);

export function BranchDisplayClockProvider({
  branchId,
  children,
}: {
  branchId: string;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({ branchId, clock: createDisplayClock() }),
    [branchId],
  );
  useEffect(() => value.clock.start(), [value]);
  return (
    <BranchDisplayClockContext.Provider value={value}>
      {children}
    </BranchDisplayClockContext.Provider>
  );
}

export function useBranchDisplayNow({
  branchId,
  now,
}: {
  branchId: string;
  now: string;
}): string {
  const context = useContext(BranchDisplayClockContext);
  const localClock = useMemo(
    () => ({ branchId, clock: createDisplayClock() }),
    [branchId],
  );
  const shared = context?.branchId === branchId;
  const clock = shared ? context.clock : localClock.clock;
  useEffect(() => clock.synchronize(now), [clock, now]);
  useEffect(() => {
    if (!shared) return clock.start();
  }, [clock, shared]);
  const snapshot = useSyncExternalStore(
    clock.subscribe,
    clock.getSnapshot,
    serverSnapshot,
  );
  // SSR와 첫 hydration은 해당 조회가 내려준 시각 그대로다.
  return snapshot ?? now;
}
