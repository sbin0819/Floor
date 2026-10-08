"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  usePathname,
  useSearchParams,
  useSelectedLayoutSegments,
} from "next/navigation";

export type FloorSearchParams = Pick<
  URLSearchParams,
  "get" | "getAll" | "toString"
>;

export function floorIdFromSegments(segments: readonly string[]): string {
  return segments[0] === "floors" ? (segments[1]?.toLowerCase() ?? "") : "";
}

export function useBranchRouteScope(sourceBranchId: string) {
  const branchId = sourceBranchId.toLowerCase();
  const segments = useSelectedLayoutSegments();
  const pathname = usePathname();
  const currentSearch = useSearchParams();
  const floorId = floorIdFromSegments(segments);
  const path = `/branches/${branchId}${floorId ? `/floors/${floorId}` : ""}`;
  const isActive = pathname.replace(/\/$/, "").toLowerCase() === path;
  const query = currentSearch.toString();
  const [retained, setRetained] = useState({
    floorId,
    query: isActive ? query : "",
  });
  let snapshot = retained;
  if (isActive && (retained.floorId !== floorId || retained.query !== query)) {
    snapshot = { floorId, query };
    setRetained(snapshot);
  }
  // Activity에 남은 지점이 다른 화면의 query를 자기 선택으로 해석하지 않는다.
  const search: FloorSearchParams = useMemo(
    () => new URLSearchParams(snapshot.query),
    [snapshot.query],
  );
  const active = useRef(false);
  useLayoutEffect(() => {
    active.current = isActive;
    return () => {
      active.current = false;
    };
  }, [isActive]);
  const isCurrentRoute = useCallback(() => active.current, []);
  return {
    branchId,
    floorId: snapshot.floorId,
    search,
    isActive,
    isCurrentRoute,
  };
}
