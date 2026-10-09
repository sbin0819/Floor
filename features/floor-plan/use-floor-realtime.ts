"use client";

import {
  startTransition,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  useRealtimeChannel,
  useRealtimeLifecycle,
} from "@/components/realtime-provider";
import { useFloorSelection } from "@/features/bookings/components/branch-workspace";
import { floorHref } from "@/features/bookings/format";
import { carryFloorQuery } from "@/features/bookings/people-filter";
import type { FloorDayData } from "@/features/bookings/types";
import { floorChannel } from "@/lib/realtime/channels";
import { floorPlanQueryOptions } from "./client";

const emptyIds: readonly string[] = [];
type Publication = {
  version: number;
  spaceId: string | null;
  selectionRevision: number;
};

export function useFloorRealtime(data: FloorDayData) {
  const selection = useFloorSelection();
  const client = useQueryClient();
  const router = useRouter();
  const scope = `${data.branch.id}:${data.floor.id}:${data.date}`;
  const active = Boolean(
    selection?.routeActive &&
    selection.branchId === data.branch.id &&
    selection.location.floorId === data.floor.id &&
    (!selection.location.date || selection.location.date === data.date),
  );
  const liveScope = useRef<object | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const queue = useRef({ pending: false, spaces: new Set<string>() });
  const refresh = useRef<{
    previous: FloorDayData;
    spaces: Set<string>;
  } | null>(null);
  const publication = useRef<Publication | null>(null);
  const attached = useRef(false);
  const attachedScope = useRef<string | null>(null);
  const flushLatest = useRef<() => void>(() => {});
  const selectionRevision = useRef(0);
  const [flash, setFlash] = useState<{
    scope: string;
    ids: readonly string[];
  } | null>(null);
  const isCurrent = () =>
    Boolean(active && liveScope.current && selection?.isCurrentRoute());

  useEffect(() => {
    selectionRevision.current += 1;
  }, [scope, selection?.location.spaceId]);
  useEffect(() => {
    if (attachedScope.current !== scope) {
      attached.current = false;
      attachedScope.current = scope;
    }
    liveScope.current = active ? {} : null;
    return () => {
      liveScope.current = null;
      clearTimeout(timer.current);
      clearTimeout(flashTimer.current);
      timer.current = undefined;
      flashTimer.current = undefined;
      queue.current = { pending: false, spaces: new Set() };
      refresh.current = null;
      publication.current = null;
      setFlash(null);
    };
  }, [scope, active]);

  const flush = useEffectEvent(() => {
    timer.current = undefined;
    if (!isCurrent() || !queue.current.pending) return;
    // 서버 이동 중 refresh로 그 이동을 가로채지 않고 완료 뒤 한 번 합친다.
    if (selection?.navigationPending) return;
    refresh.current = {
      previous: refresh.current?.previous ?? data,
      spaces: new Set([
        ...(refresh.current?.spaces ?? []),
        ...queue.current.spaces,
      ]),
    };
    queue.current = { pending: false, spaces: new Set() };
    startTransition(() => router.refresh());
  });
  useEffect(() => {
    flushLatest.current = () => flush();
  });
  const schedule = () => {
    if (!isCurrent() || timer.current !== undefined || !queue.current.pending)
      return;
    timer.current = setTimeout(() => flushLatest.current(), 300);
  };
  const resumeSchedule = useEffectEvent(schedule);
  useEffect(() => {
    if (!selection?.navigationPending) resumeSchedule();
  }, [selection?.navigationPending]);

  useRealtimeChannel(active ? floorChannel(data.floor.id) : null, (event) => {
    if (!isCurrent()) return;
    if (
      event.type === "booking.changed" ||
      event.type === "space.status_changed"
    ) {
      queue.current.spaces.add(event.spaceId.toLowerCase());
    } else if (event.type === "plan.published") {
      if (
        event.floorId.toLowerCase() !== data.floor.id.toLowerCase() ||
        !Number.isSafeInteger(event.version) ||
        event.version < 1 ||
        event.version <= (data.floor.plan?.version ?? 0) ||
        event.version <= (publication.current?.version ?? 0)
      )
        return;
      publication.current = {
        version: event.version,
        spaceId: selection?.location.spaceId ?? null,
        selectionRevision: selectionRevision.current,
      };
    } else return;
    queue.current.pending = true;
    schedule();
  });
  useRealtimeLifecycle((event) => {
    if (
      !isCurrent() ||
      event.type !== "channel" ||
      event.channel !== floorChannel(data.floor.id)
    )
      return;
    const reconnect = attached.current;
    attached.current = true;
    if (!reconnect || event.resumed) return;
    queue.current.pending = true;
    schedule();
  });

  const revealChanges = useEffectEvent(() => {
    const waiting = refresh.current;
    if (!isCurrent() || !waiting || waiting.previous === data) return;
    refresh.current = null;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const ids = data.spaces
      .filter((space) => waiting.spaces.has(space.id.toLowerCase()))
      .map((space) => space.id);
    if (!ids.length) return;
    const current = liveScope.current;
    clearTimeout(flashTimer.current);
    startTransition(() => setFlash({ scope, ids }));
    flashTimer.current = setTimeout(() => {
      if (liveScope.current === current) setFlash(null);
    }, 200);
  });
  useEffect(() => revealChanges(), [data, scope]);

  const checkPublication = useEffectEvent(async (cancelled: () => boolean) => {
    const pending = publication.current;
    const plan = data.floor.plan;
    if (
      !isCurrent() ||
      !pending ||
      !plan ||
      plan.version < pending.version ||
      selection?.navigationPending
    )
      return;
    if (
      !pending.spaceId ||
      pending.selectionRevision !== selectionRevision.current
    ) {
      publication.current = null;
      return;
    }
    const current = liveScope.current;
    try {
      const document = await client.fetchQuery(floorPlanQueryOptions(plan.id));
      if (
        cancelled() ||
        current !== liveScope.current ||
        publication.current !== pending ||
        !isCurrent()
      )
        return;
      publication.current = null;
      // 이전 문서의 응답으로 나중에 고른 공간이나 입력을 지우지 않는다.
      if (
        pending.selectionRevision !== selectionRevision.current ||
        selection?.location.spaceId !== pending.spaceId ||
        document.spaces.some(
          (space) =>
            space.spaceId.toLowerCase() === pending.spaceId!.toLowerCase(),
        )
      )
        return;
      selection.change(
        { ...selection.location, spaceId: null, detail: false },
        carryFloorQuery(
          floorHref(data.branch.id, data.floor.id, data.date),
          selection.search,
        ),
        { replace: true },
      );
      selection.restoreSpaceTrigger();
    } catch {
      // 평면도 조회 실패는 기존 선택과 예약 초안을 유지한다.
    }
  });
  useEffect(() => {
    let cancelled = false;
    void checkPublication(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [data, active, selection?.location.spaceId, selection?.navigationPending]);
  return {
    flashSpaceIds: active && flash?.scope === scope ? flash.ids : emptyIds,
  };
}
