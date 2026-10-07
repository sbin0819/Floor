"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  useOptimisticNavigation,
  type NavigateAction,
} from "@/components/optimistic-navigation";
import { normalizeBookingDateForToday } from "@/features/bookings/date";
import {
  floorSelectionKey,
  requestedSpaceId,
  searchValue,
  type FloorLocation,
} from "@/features/bookings/floor-selection";

type SelectionContext = {
  selectedSpaceId: string | null;
  register: (key: string, spaceId: string | null) => () => void;
  registerNavigation: (
    branchId: string,
    today: string,
    now: string,
  ) => () => void;
  location: FloorLocation;
  change: (
    next: FloorLocation,
    href: string,
    options?: { replace?: boolean },
  ) => void;
  listPending: boolean;
  detailPending: boolean;
  detailCleared: boolean;
  rememberSpaceTrigger: (element: HTMLAnchorElement, spaceId: string) => void;
  restoreSpaceTrigger: () => void;
};
const FloorSelectionContext = createContext<SelectionContext | null>(null);
function isVisibleLink(element: HTMLAnchorElement) {
  for (
    let node: HTMLElement | null = element;
    node;
    node = node.parentElement
  ) {
    if (node.hidden || node.style.display === "none") return false;
  }
  return true;
}
export function useFloorSelection() {
  return useContext(FloorSelectionContext);
}

export function BranchWorkspace({
  children,
  navigateAction,
}: {
  children: ReactNode;
  navigateAction?: NavigateAction;
}) {
  const params = useParams<{ branchId: string; floorId?: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const route = useCallback<NavigateAction>(
    (href, { replace }) => {
      if (replace) router.replace(href);
      else router.push(href);
    },
    [router],
  );
  const locationKey = floorSelectionKey(
    params.branchId,
    params.floorId ?? "",
    searchValue(search, "date"),
    searchValue(search, "space"),
  );
  const requested = requestedSpaceId(searchValue(search, "space"));
  const branchId = params.branchId.toLowerCase();
  const trigger = useRef<HTMLAnchorElement | null>(null);
  const lastSpace = useRef<string | null>(null);
  const rememberSpaceTrigger = useCallback(
    (element: HTMLAnchorElement, spaceId: string) => {
      trigger.current = element;
      lastSpace.current = spaceId;
    },
    [],
  );
  const restoreSpaceTrigger = useCallback(() => {
    const previous = trigger.current;
    if (previous?.isConnected && isVisibleLink(previous)) {
      previous.focus();
      return;
    }
    if (lastSpace.current === null) return;
    const link = Array.from(
      document.querySelectorAll<HTMLAnchorElement>(
        '[aria-label="공간 목록"] a[href]',
      ),
    ).find(
      (link) =>
        isVisibleLink(link) &&
        new URL(link.href).searchParams.get("space") === lastSpace.current,
    );
    link?.focus();
  }, []);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  if (dismissedKey !== null && dismissedKey !== locationKey)
    setDismissedKey(null);
  const [clock, setClock] = useState<{
    branchId: string;
    today: string;
    now: string;
    registration: symbol;
  } | null>(null);
  const registerNavigation = useCallback(
    (sourceBranchId: string, today: string, now: string) => {
      if (sourceBranchId.toLowerCase() !== branchId) return () => {};
      const registration = Symbol();
      setClock({ branchId, today, now, registration });
      return () =>
        setClock((current) =>
          current?.registration === registration ? null : current,
        );
    },
    [branchId],
  );
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
      if (spaceId !== null) lastSpace.current = spaceId;
      setSelection({ key, spaceId, registration });
      return () =>
        setSelection((current) =>
          current?.registration === registration ? null : current,
        );
    },
    [locationKey, requested],
  );
  const selectedSpaceId =
    selection?.key === locationKey && dismissedKey !== locationKey
      ? selection.spaceId
      : null;
  const today = clock?.branchId === branchId ? clock.today : null;
  const date = today
    ? normalizeBookingDateForToday(searchValue(search, "date"), today)
    : "";
  const floorId = params.floorId?.toLowerCase() ?? "";
  const base = useMemo<FloorLocation>(
    () => ({ floorId, date, spaceId: selectedSpaceId }),
    [floorId, date, selectedSpaceId],
  );
  const navigation = useOptimisticNavigation(base, navigateAction ?? route);
  const changeLocation = navigation.change;
  const change = useCallback<SelectionContext["change"]>(
    (next, href, options) => {
      setDismissedKey(next.spaceId === null ? locationKey : null);
      changeLocation(next, href, options);
    },
    [locationKey, changeLocation],
  );
  const floorChanged = navigation.value.floorId !== base.floorId;
  const dateChanged = base.date !== "" && navigation.value.date !== base.date;
  const spaceChanged = navigation.value.spaceId !== base.spaceId;
  const listPending = navigation.isPending && (floorChanged || dateChanged);
  const detailChanged =
    navigation.isPending && (floorChanged || dateChanged || spaceChanged);
  const detailPending = detailChanged && navigation.value.spaceId !== null;
  const detailCleared =
    dismissedKey === locationKey ||
    (detailChanged && navigation.value.spaceId === null);
  const value = useMemo(
    () => ({
      selectedSpaceId,
      register,
      registerNavigation,
      location: navigation.value,
      change,
      listPending,
      detailPending,
      detailCleared,
      rememberSpaceTrigger,
      restoreSpaceTrigger,
    }),
    [
      selectedSpaceId,
      register,
      registerNavigation,
      navigation.value,
      change,
      listPending,
      detailPending,
      detailCleared,
      rememberSpaceTrigger,
      restoreSpaceTrigger,
    ],
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
