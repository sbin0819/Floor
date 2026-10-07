"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useParams, useSearchParams } from "next/navigation";
import {
  floorSelectionKey,
  requestedSpaceId,
  searchValue,
} from "@/features/bookings/floor-selection";

type SelectionContext = {
  selectedSpaceId: string | null;
  register: (key: string, spaceId: string | null) => () => void;
};
const FloorSelectionContext = createContext<SelectionContext | null>(null);
export function useFloorSelection() {
  return useContext(FloorSelectionContext);
}

export function BranchWorkspace({ children }: { children: ReactNode }) {
  const params = useParams<{ branchId: string; floorId?: string }>();
  const search = useSearchParams();
  const locationKey = floorSelectionKey(
    params.branchId,
    params.floorId ?? "",
    searchValue(search, "date"),
    searchValue(search, "space"),
  );
  const requested = requestedSpaceId(searchValue(search, "space"));
  const [selection, setSelection] = useState<{
    key: string;
    spaceId: string | null;
    registration: symbol;
  } | null>(null);
  const register = useCallback(
    (key: string, spaceId: string | null) => {
      // Activity가 보존한 이전 상세는 새 주소의 선택을 덮어쓸 수 없다.
      if (key !== locationKey || (spaceId !== null && spaceId !== requested))
        return () => {};
      const registration = Symbol();
      setSelection({ key, spaceId, registration });
      return () =>
        setSelection((current) =>
          current?.registration === registration ? null : current,
        );
    },
    [locationKey, requested],
  );
  const selectedSpaceId =
    selection?.key === locationKey ? selection.spaceId : null;
  const value = useMemo(
    () => ({ selectedSpaceId, register }),
    [selectedSpaceId, register],
  );
  return (
    <FloorSelectionContext.Provider value={value}>
      {children}
    </FloorSelectionContext.Provider>
  );
}

export function ResolvedSpaceSelection({
  selectionKey,
  spaceId,
  children,
}: {
  selectionKey: string;
  spaceId: string | null;
  children: ReactNode;
}) {
  const register = useFloorSelection()?.register;
  useEffect(
    () => register?.(selectionKey, spaceId),
    [register, selectionKey, spaceId],
  );
  return children;
}
