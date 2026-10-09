"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useWideScreen } from "@/features/bookings/components/use-wide-screen";
import type { PlanShapeState } from "@/lib/floor-plan/render/types";
import { floorPlanQueryOptions } from "../client";
import { PlanCanvas } from "./plan-canvas";

type MiniPlanProps = { planId: string; spaceId: string; seatId?: string };
export function HomeMiniPlan(props: MiniPlanProps) {
  return useWideScreen(undefined, false) ? <MiniPlan {...props} /> : null;
}

function MiniPlan({ planId, spaceId, seatId }: MiniPlanProps) {
  const { data, isError } = useQuery(floorPlanQueryOptions(planId));
  const document = useMemo(
    () =>
      data
        ? {
            ...data,
            fixtures: data.fixtures.map((fixture) => ({
              ...fixture,
              label: undefined,
            })),
          }
        : null,
    [data],
  );
  if (isError || !data || !document) return null;
  const states = new Map<string, PlanShapeState>(
    [...data.spaces, ...data.seats].map((shape) => [
      shape.spaceId.toLowerCase(),
      {
        kind:
          shape.spaceId.toLowerCase() === spaceId.toLowerCase() ||
          shape.spaceId.toLowerCase() === seatId?.toLowerCase()
            ? "mine"
            : "neutral",
        name: "",
      },
    ]),
  );
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none w-[240px] shrink-0"
      data-home-mini-plan
    >
      <PlanCanvas
        document={document}
        states={states}
        interactive={false}
        className="h-40 w-full"
        onSelect={() => {}}
      />
    </div>
  );
}
