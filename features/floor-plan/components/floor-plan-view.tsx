"use client";

import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import type { FloorDayData } from "@/features/bookings/types";
import { floorHref } from "@/features/bookings/format";
import { carryFloorQuery } from "@/features/bookings/people-filter";
import { useFloorSelection } from "@/features/bookings/components/branch-workspace";
import { bookingDraftScope } from "@/features/bookings/booking-draft-store";
import {
  useBookingDeskSeats,
  useBookingDeskSelection,
} from "@/features/bookings/components/use-booking-draft";
import type { PlanShape } from "@/lib/floor-plan/render/types";
import { floorPlanQueryOptions } from "../client";
import { initialPlanTime, planTimeValueText } from "../time";
import { planStatesAt, planSummary, planTooltipText } from "../states";
import { PlanCanvas } from "./plan-canvas";
import { PlanTimeBar } from "./plan-time-bar";

export { fetchFloorPlan } from "../client";

export function FloorPlanView({
  data,
  planId,
  flashSpaceIds,
}: {
  data: FloorDayData;
  planId: string;
  flashSpaceIds?: readonly string[];
}) {
  const selection = useFloorSelection();
  const root = useRef<HTMLElement>(null);
  const [at, setAt] = useState(() => initialPlanTime(data));
  const [hover, setHover] = useState<PlanShape | null>(null);
  const query = useQuery(floorPlanQueryOptions(planId));
  const selectedSpaceId = selection?.location.spaceId ?? null;
  const scope = bookingDraftScope(
    data.branch.id,
    data.floor.id,
    data.date,
    selectedSpaceId,
  );
  const seatSelection = useBookingDeskSelection(selection?.draftStore, scope);
  const deskSeats = useBookingDeskSeats(selection?.draftStore, scope);
  const selectedSpace = data.spaces.find(
    (space) => space.id.toLowerCase() === selectedSpaceId?.toLowerCase(),
  );
  const activeDeskAreaId =
    selection?.location.detail &&
    selectedSpace?.kind === "accessible" &&
    !selectedSpace.bookable &&
    selectedSpace.deskCount > 0
      ? selectedSpace.id
      : null;
  const states = useMemo(() => {
    const values = new Map(planStatesAt(data, new Date(at ?? data.now)));
    if (
      activeDeskAreaId &&
      deskSeats &&
      deskSeats.part === seatSelection.deskPart
    ) {
      for (const seat of deskSeats.seats)
        values.set(seat.id.toLowerCase(), {
          kind:
            seat.state === "blocked" || seat.state === "unavailable"
              ? "maintenance"
              : seat.state,
          name: seat.name,
          label: {
            free: "비어 있음",
            booked: "예약됨",
            mine: "내 자리",
            blocked: "점검",
            unavailable: "예약할 수 없는 자리",
          }[seat.state],
          selectable:
            !deskSeats.disabled &&
            (seat.state === "free" || seat.state === "mine"),
          selected: seat.id === seatSelection.deskId,
        });
    }
    return values;
  }, [
    data,
    at,
    activeDeskAreaId,
    deskSeats,
    seatSelection.deskPart,
    seatSelection.deskId,
  ]);
  const hovered = hover?.spaceId && states.get(hover.spaceId.toLowerCase());
  const hoveredSpace = data.spaces.find(
    (space) => space.id.toLowerCase() === hover?.spaceId?.toLowerCase(),
  );
  const tooltip = hovered
    ? planTooltipText(
        hovered,
        hoveredSpace?.kind === "accessible" ? hoveredSpace.capacity : null,
      )
    : null;
  const choose = (shape: PlanShape) => {
    if (!selection?.isCurrentRoute() || !shape.spaceId) return;
    if (shape.kind === "seat") {
      const state = selection.draftStore.getState();
      const approved = state.scope === scope && state.deskSeats;
      const seat =
        approved &&
        approved.seats.find(
          (seat) => seat.id.toLowerCase() === shape.spaceId?.toLowerCase(),
        );
      if (
        !activeDeskAreaId ||
        !approved ||
        approved.disabled ||
        approved.part !== state.deskPart ||
        !seat ||
        (seat.state !== "free" && seat.state !== "mine")
      )
        return;
      state.changeDesk(scope, state.deskId === seat.id ? null : seat.id);
      return;
    }
    const space = data.spaces.find(
      (space) => space.id.toLowerCase() === shape.spaceId?.toLowerCase(),
    );
    if (!space || space.kind !== "accessible") return;
    const detail = !space.bookable && space.deskCount > 0;
    const trigger = root.current?.querySelector<HTMLElement>(
      `[data-plan-shape-id][data-space-id="${space.id}"]`,
    );
    if (trigger) selection.rememberSpaceTrigger(trigger, space.id);
    selection.change(
      { ...selection.location, spaceId: space.id, detail },
      carryFloorQuery(
        floorHref(
          data.branch.id,
          data.floor.id,
          data.date,
          space.id,
          undefined,
          detail,
        ),
        selection.search,
      ),
    );
  };
  return (
    <section
      ref={root}
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
          aria-busy="true"
          className="m-4 h-96 animate-pulse rounded-xl border border-border bg-muted motion-reduce:animate-none"
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
            activeDeskAreaId={activeDeskAreaId}
            selectedSeatId={seatSelection.deskId}
            flashSpaceIds={flashSpaceIds}
            onSelect={choose}
            onHover={setHover}
            timeLabel={
              at === null
                ? "쉬는 날"
                : `${planTimeValueText(at, data.branch.timezone)} 기준`
            }
            onClear={() => {
              if (!selection?.isCurrentRoute()) return;
              selection.change(
                { ...selection.location, spaceId: null, detail: false },
                carryFloorQuery(
                  floorHref(data.branch.id, data.floor.id, data.date),
                  selection.search,
                ),
                { replace: true },
              );
              selection.restoreSpaceTrigger();
            }}
          />
          {tooltip && (
            <div
              role="tooltip"
              className="pointer-events-none absolute top-3 left-3 max-w-72 rounded-lg bg-foreground px-3 py-2 text-xs text-background shadow-sm"
            >
              <p className="font-semibold">{tooltip.title}</p>
              <p>{tooltip.description}</p>
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
