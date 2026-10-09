import { queryOptions } from "@tanstack/react-query";
import { floorPlanSchema } from "@/lib/floor-plan/schema";

export async function fetchFloorPlan(planId: string, signal?: AbortSignal) {
  const response = await fetch(
    `/api/floor-plans/${encodeURIComponent(planId)}`,
    { signal },
  );
  if (!response.ok) throw new Error("평면도를 불러오지 못했어요");
  return floorPlanSchema.parse(await response.json());
}

export function floorPlanQueryOptions(planId: string) {
  return queryOptions({
    queryKey: ["floor-plan", planId] as const,
    queryFn: ({ signal }) => fetchFloorPlan(planId, signal),
    staleTime: Infinity,
  });
}
