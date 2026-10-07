"use client";

import type { ReactNode } from "react";
import { SpaceDetailLoading } from "./space-detail-loading";
import { useFloorSelection } from "./branch-workspace";
import { FloorViewsSkeleton } from "./floor-view-skeleton";

export function EmptySpaceSelection() {
  return (
    <section className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">
      <h2 className="font-medium">공간을 골라 주세요</h2>
      <p className="mt-2 text-sm">하루 일정과 예약 시간을 확인할 수 있어요</p>
    </section>
  );
}

export function FloorListRegion({ children }: { children: ReactNode }) {
  const pending = useFloorSelection()?.listPending ?? false;
  return (
    <div className="min-h-0">
      {pending && <FloorViewsSkeleton />}
      <div hidden={pending}>{children}</div>
    </div>
  );
}

export function FloorDetailRegion({ children }: { children: ReactNode }) {
  const navigation = useFloorSelection();
  const pending = navigation?.detailPending ?? false;
  const cleared = navigation?.detailCleared ?? false;
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {cleared ? (
        <EmptySpaceSelection />
      ) : pending ? (
        <SpaceDetailLoading />
      ) : null}
      <div hidden={pending || cleared} className="min-h-0 flex-1">
        {children}
      </div>
    </div>
  );
}
