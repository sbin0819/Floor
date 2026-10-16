import { queryOptions } from "@tanstack/react-query";
import { floorPlanSchema } from "@/lib/floor-plan/schema";
import { requestJson } from "@/lib/http/client";

export async function fetchFloorPlan(planId: string, signal?: AbortSignal) {
  return requestJson(
    `/api/floor-plans/${encodeURIComponent(planId)}`,
    floorPlanSchema,
    { signal, cache: "default" },
  );
}

export function floorPlanQueryOptions(planId: string) {
  return queryOptions({
    queryKey: ["floor-plan", planId] as const,
    queryFn: ({ signal }) => fetchFloorPlan(planId, signal),
    staleTime: Infinity,
    // 접근 거절도 재시도하지 않는다. 전체 보기의 오류 화면에서 명시적으로 다시 읽는다.
    retry: false,
  });
}
