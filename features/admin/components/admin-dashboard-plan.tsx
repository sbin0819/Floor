"use client";

import { useMemo } from "react";
import { PlanCanvas } from "@/features/floor-plan/components/plan-canvas";
import type { PlanShapeState } from "@/lib/floor-plan/render/types";
import type { AdminDashboardData } from "../dashboard-types";

const noSelection = () => {};

export function AdminDashboardPlan({
  plan,
  spaces,
}: {
  plan: NonNullable<AdminDashboardData["plan"]>;
  spaces: AdminDashboardData["spaces"];
}) {
  const states = useMemo(() => {
    const result = new Map<string, PlanShapeState>(
      plan.document.spaces.map(({ spaceId }) => [
        spaceId.toLowerCase(),
        { kind: "neutral", name: "", utilization: null },
      ]),
    );
    for (const space of spaces)
      result.set(space.id.toLowerCase(), {
        kind: "neutral",
        name: space.name,
        utilization: space.utilization,
      });
    return result;
  }, [plan.document, spaces]);
  return (
    <PlanCanvas
      mode="utilization"
      document={plan.document}
      states={states}
      onSelect={noSelection}
    />
  );
}
