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
import type { FloorDayData } from "@/features/bookings/types";
import {
  useOptimisticNavigation,
  type NavigateAction,
} from "@/components/optimistic-navigation";
import { normalizeBookingDateForToday } from "@/features/bookings/date";
import {
  selectFloorBookingSlot,
  type BookingSelection,
  type FloorBookingSelection,
  type SelectableSlot,
} from "@/features/bookings/selection";
import {
  floorSelectionKey,
  requestedSpaceId,
  searchValue,
  type FloorLocation,
} from "@/features/bookings/floor-selection";

type SelectionContext = {
  floorData: FloorDayData | null;
  registerFloor: (data: FloorDayData) => () => void;
  closeAfterBooking: (spaceId: string, date: string) => void;
  selection: FloorBookingSelection | null;
  changeRange: (spaceId: string, range: BookingSelection | null) => void;
  selectSlot: (input: {
    spaceId: string;
    slots: SelectableSlot[];
    start: string;
    href: string;
    trigger?: HTMLElement;
  }) => void;
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
  rememberSpaceTrigger: (element: HTMLElement, spaceId: string) => void;
  restoreSpaceTrigger: () => void;
};
const FloorSelectionContext = createContext<SelectionContext | null>(null);
function isVisibleLink(element: HTMLElement) {
  for (
    let node: HTMLElement | null = element;
    node;
    node = node.parentElement
  ) {
    if (
      node.hidden ||
      getComputedStyle(node).display === "none" ||
      getComputedStyle(node).visibility === "hidden"
    )
      return false;
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
  const trigger = useRef<HTMLElement | null>(null);
  const lastSpace = useRef<string | null>(null);
  const rememberSpaceTrigger = useCallback(
    (element: HTMLElement, spaceId: string) => {
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
        '[aria-label="공간 목록"] a[href], [data-floor-timetable] a[data-space-id]',
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
  const [registeredFloor, setRegisteredFloor] = useState<{
    data: FloorDayData;
    registration: symbol;
  } | null>(null);
  const registerFloor = useCallback(
    (data: FloorDayData) => {
      if (
        data.branch.id !== branchId ||
        data.floor.id !== floorId ||
        (date && data.date !== date)
      )
        return () => {};
      const registration = Symbol();
      setRegisteredFloor({ data, registration });
      return () =>
        setRegisteredFloor((current) =>
          current?.registration === registration ? null : current,
        );
    },
    [branchId, floorId, date],
  );
  const floorData =
    registeredFloor?.data.branch.id === branchId &&
    registeredFloor.data.floor.id === navigation.value.floorId &&
    registeredFloor.data.date === navigation.value.date
      ? registeredFloor.data
      : null;
  const rangeScope = `${branchId}|${floorId}|${date}|${requested ?? ""}`;
  const [lastRangeScope, setLastRangeScope] = useState(rangeScope);
  const [range, setRange] = useState<{
    scope: string;
    selection: FloorBookingSelection;
  } | null>(null);
  if (rangeScope !== lastRangeScope) {
    setLastRangeScope(rangeScope);
    // 새 행 클릭으로 미리 정한 구간은 해당 주소가 도착해도 유지한다.
    if (range?.scope !== rangeScope) setRange(null);
  }
  const visibleScope = `${branchId}|${navigation.value.floorId}|${navigation.value.date}|${navigation.value.spaceId ?? ""}`;
  const bookingSelection =
    range?.scope === visibleScope ? range.selection : null;
  const changeLocation = navigation.change;
  const change = useCallback<SelectionContext["change"]>(
    (next, href, options) => {
      setDismissedKey(next.spaceId === null ? locationKey : null);
      if (
        next.floorId !== navigation.value.floorId ||
        next.date !== navigation.value.date ||
        next.spaceId !== navigation.value.spaceId ||
        next.spaceId === null
      )
        setRange(null);
      changeLocation(next, href, options);
    },
    [locationKey, changeLocation, navigation.value],
  );
  const currentNavigation = useRef({ location: navigation.value, change });
  useEffect(() => {
    currentNavigation.current = { location: navigation.value, change };
  }, [navigation.value, change]);
  const closeAfterBooking = useCallback(
    (spaceId: string, bookedDate: string) => {
      const current = currentNavigation.current;
      // 늦게 끝난 이전 예약은 새 공간이나 날짜의 상세를 닫지 않는다.
      if (
        current.location.spaceId !== spaceId ||
        current.location.date !== bookedDate
      )
        return;
      const url = new URL(window.location.href);
      url.searchParams.delete("space");
      current.change(
        { ...current.location, spaceId: null },
        `${url.pathname}${url.search}${url.hash}`,
        { replace: true },
      );
      restoreSpaceTrigger();
    },
    [restoreSpaceTrigger],
  );
  const changeRange = useCallback<SelectionContext["changeRange"]>(
    (spaceId, next) => {
      const scope = `${branchId}|${navigation.value.floorId}|${navigation.value.date}|${spaceId}`;
      // 보존된 이전 폼의 늦은 성공 응답이 새 공간의 선택을 지우지 않게 한다.
      setRange((current) =>
        next
          ? { scope, selection: { spaceId, ...next } }
          : current?.scope === scope
            ? null
            : current,
      );
    },
    [branchId, navigation.value.floorId, navigation.value.date],
  );
  const selectSlot = useCallback<SelectionContext["selectSlot"]>(
    ({ spaceId, slots, start, href, trigger: element }) => {
      if (!slots.some((slot) => slot.start === start && slot.state === "free"))
        return;
      const next = selectFloorBookingSlot(
        spaceId,
        slots,
        bookingSelection,
        start,
      );
      changeRange(spaceId, next);
      if (element) rememberSpaceTrigger(element, spaceId);
      setDismissedKey(null);
      if (spaceId !== navigation.value.spaceId)
        changeLocation({ ...navigation.value, spaceId }, href);
    },
    [
      bookingSelection,
      changeRange,
      rememberSpaceTrigger,
      navigation.value,
      changeLocation,
    ],
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
      floorData,
      registerFloor,
      closeAfterBooking,
      selection: bookingSelection,
      changeRange,
      selectSlot,
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
      floorData,
      registerFloor,
      closeAfterBooking,
      bookingSelection,
      changeRange,
      selectSlot,
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
