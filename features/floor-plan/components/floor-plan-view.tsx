"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import type { FloorDayData } from "@/features/bookings/types";
import { floorHref } from "@/features/bookings/format";
import { carryFloorQuery } from "@/features/bookings/people-filter";
import { useFloorSelection } from "@/features/bookings/components/branch-workspace";
import { floorPlanSchema } from "@/lib/floor-plan/schema";
import type { PlanShape } from "@/lib/floor-plan/render/types";
import { initialPlanTime } from "../time";
import { planStatesAt, planSummary } from "../states";
import { PlanCanvas } from "./plan-canvas";
import { PlanTimeBar } from "./plan-time-bar";

export async function fetchFloorPlan(planId: string, signal?: AbortSignal) {
  const response = await fetch(
    `/api/floor-plans/${encodeURIComponent(planId)}`,
    { signal },
  );
  if (!response.ok) throw new Error("평면도를 불러오지 못했어요");
  return floorPlanSchema.parse(await response.json());
}

export function FloorPlanView({
  data,
  planId,
}: {
  data: FloorDayData;
  planId: string;
}) {
  const selection = useFloorSelection();
  const [at, setAt] = useState(() => initialPlanTime(data));
  const [hover, setHover] = useState<PlanShape | null>(null);
  const query = useQuery({
    queryKey: ["floor-plan", planId],
    queryFn: ({ signal }) => fetchFloorPlan(planId, signal),
    staleTime: Infinity,
  });
  const states = useMemo(
    () => planStatesAt(data, new Date(at ?? data.now)),
    [data, at],
  );
  const hovered = hover?.spaceId && states.get(hover.spaceId.toLowerCase());
  const choose = (shape: PlanShape) => {
    if (!selection?.isCurrentRoute() || !shape.spaceId) return;
    const space = data.spaces.find(
      (space) => space.id.toLowerCase() === shape.spaceId?.toLowerCase(),
    );
    if (!space || space.kind !== "accessible") return;
    selection.change(
      { ...selection.location, spaceId: space.id, detail: false },
      carryFloorQuery(
        floorHref(data.branch.id, data.floor.id, data.date, space.id),
        selection.search,
      ),
    );
  };
  return (
    <section
      aria-label="층 평면도"
      className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"
    >
      {at !== null ? (
        <PlanTimeBar
          data={data}
          at={at}
          onChange={setAt}
          summary={planSummary(data, states)}
        />
      ) : (
        <p className="p-4">쉬는 날이에요</p>
      )}
      {query.isPending ? (
        <div
          role="status"
          className="m-4 h-96 animate-pulse rounded-xl border border-border bg-muted"
        >
          <span className="sr-only">평면도를 불러오고 있어요</span>
        </div>
      ) : query.isError ? (
        <div role="alert" className="space-y-3 p-6">
          <p>평면도를 불러오지 못했어요</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            다시 시도
          </Button>
        </div>
      ) : (
        <div className="relative">
          <PlanCanvas
            document={query.data}
            states={states}
            selectedSpaceId={selection?.location.spaceId}
            onSelect={choose}
            onHover={setHover}
          />
          {hovered && (
            <div
              role="tooltip"
              className="pointer-events-none absolute top-3 left-3 max-w-72 rounded-lg bg-foreground px-3 py-2 text-xs text-background shadow-sm"
            >
              <p className="font-semibold">{hovered.name}</p>
              <p>
                {hovered.kind === "restricted"
                  ? "다른 팀 전용이에요"
                  : hovered.label}
              </p>
            </div>
          )}
        </div>
      )}
      <ul
        aria-label="평면도 범례"
        className="flex flex-wrap gap-4 border-t border-border p-4 text-xs"
      >
        {[
          ["비어 있음", "bg-status-free border-status-free-border"],
          ["예약됨", "bg-booked"],
          ["내 예약", "bg-status-mine-strong"],
          ["점검", "bg-status-maintenance-hatch"],
          ["전용 공간", "bg-status-restricted"],
        ].map(([label, className]) => (
          <li key={label} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={`size-3.5 rounded border border-border ${className}`}
            />
            {label}
          </li>
        ))}
      </ul>
    </section>
  );
}
