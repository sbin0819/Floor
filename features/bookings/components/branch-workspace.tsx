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
import { useRouter } from "next/navigation";
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
  requestedDetail,
  searchValue,
  type FloorLocation,
} from "@/features/bookings/floor-selection";
import {
  useBranchRouteScope,
  type FloorSearchParams,
} from "./use-branch-route-scope";
import { useSpaceTriggerFocus } from "./use-space-trigger-focus";

type BookingDraft = { title: string; actorId: string | null };
const emptyDraft: BookingDraft = { title: "", actorId: null };
type SelectionContext = {
  branchId: string;
  search: FloorSearchParams;
  routeActive: boolean;
  isCurrentRoute: () => boolean;
  draft: BookingDraft;
  changeDraft: (spaceId: string, patch: Partial<BookingDraft>) => void;
  clearDraftTitle: (spaceId: string) => void;
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
  selectionKey: string;
  selectionResolved: boolean;
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
  navigationPending: boolean;
  detailPending: boolean;
  detailCleared: boolean;
  rememberSpaceTrigger: (element: HTMLElement, spaceId: string) => void;
  restoreSpaceTrigger: () => void;
};
const FloorSelectionContext = createContext<SelectionContext | null>(null);
export function useFloorSelection() {
  return useContext(FloorSelectionContext);
}

export function BranchWorkspace({
  branchId: sourceBranchId,
  children,
  navigateAction,
}: {
  branchId: string;
  children: ReactNode;
  navigateAction?: NavigateAction;
}) {
  const { branchId, floorId, search, isActive, isCurrentRoute } =
    useBranchRouteScope(sourceBranchId);
  const router = useRouter();
  const route = useCallback<NavigateAction>(
    (href, { replace }) => {
      if (replace) router.replace(href);
      else router.push(href);
    },
    [router],
  );
  const locationKey = floorSelectionKey(
    branchId,
    floorId,
    searchValue(search, "date"),
    searchValue(search, "space"),
  );
  const requested = requestedSpaceId(searchValue(search, "space"));
  const detailRequested = requestedDetail(searchValue(search, "detail"));
  const { rememberConfirmedSpace, rememberSpaceTrigger, restoreSpaceTrigger } =
    useSpaceTriggerFocus(isCurrentRoute);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  if (dismissedKey !== null && dismissedKey !== locationKey)
    setDismissedKey(null);
  const [clock, setClock] = useState<{
    branchId: string;
    today: string;
    now: string;
  } | null>(null);
  const registerNavigation = useCallback(
    (sourceBranchId: string, today: string, now: string) => {
      if (sourceBranchId.toLowerCase() !== branchId) return () => {};
      setClock({ branchId, today, now });
      // 숨김은 날짜 변경이 아니다. 복귀할 때까지 마지막 서버 날짜를 유지한다.
      return () => {};
    },
    [branchId],
  );
  const [selection, setSelection] = useState<{
    key: string;
    spaceId: string | null;
    registration: symbol;
  } | null>(null);
  const [pendingSelection, setPendingSelection] = useState<{
    key: string;
    spaceId: string;
  } | null>(null);
  const register = useCallback(
    (key: string, spaceId: string | null) => {
      // Activity가 보존한 이전 상세는 새 주소의 선택을 덮어쓸 수 없다.
      if (key !== locationKey || (spaceId !== null && spaceId !== requested))
        return () => {};
      const registration = Symbol();
      if (spaceId !== null) rememberConfirmedSpace(spaceId);
      setSelection({ key, spaceId, registration });
      setPendingSelection((current) => (current?.key === key ? null : current));
      return () =>
        setSelection((current) =>
          current?.registration === registration ? null : current,
        );
    },
    [locationKey, requested, rememberConfirmedSpace],
  );
  const selectedSpaceId =
    selection?.key === locationKey && dismissedKey !== locationKey
      ? selection.spaceId
      : null;
  const selectionResolved = selection?.key === locationKey;
  const awaitingSelection =
    !selectionResolved &&
    dismissedKey !== locationKey &&
    pendingSelection?.key === locationKey
      ? pendingSelection.spaceId
      : null;
  const presentedSpaceId = selectedSpaceId ?? awaitingSelection;
  const today = clock?.branchId === branchId ? clock.today : null;
  const date = today
    ? normalizeBookingDateForToday(searchValue(search, "date"), today)
    : "";
  const base = useMemo<FloorLocation>(
    () => ({
      floorId,
      date,
      spaceId: presentedSpaceId,
      detail: presentedSpaceId !== null && detailRequested,
    }),
    [floorId, date, presentedSpaceId, detailRequested],
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
  const [draft, setDraft] = useState<{
    scope: string;
    value: BookingDraft;
  } | null>(null);
  if (rangeScope !== lastRangeScope) {
    setLastRangeScope(rangeScope);
    // 새 행 클릭으로 미리 정한 구간은 해당 주소가 도착해도 유지한다.
    if (range?.scope !== rangeScope) setRange(null);
    if (draft?.scope !== rangeScope) setDraft(null);
  }
  const visibleScope = `${branchId}|${navigation.value.floorId}|${navigation.value.date}|${navigation.value.spaceId ?? ""}`;
  const bookingSelection =
    range?.scope === visibleScope ? range.selection : null;
  const visibleDraft = draft?.scope === visibleScope ? draft.value : emptyDraft;
  const changeDraft = useCallback<SelectionContext["changeDraft"]>(
    (spaceId, patch) => {
      const scope = `${branchId}|${navigation.value.floorId}|${navigation.value.date}|${spaceId}`;
      setDraft((current) => ({
        scope,
        value: {
          ...(current?.scope === scope ? current.value : emptyDraft),
          ...patch,
        },
      }));
    },
    [branchId, navigation.value.floorId, navigation.value.date],
  );
  const clearDraftTitle = useCallback<SelectionContext["clearDraftTitle"]>(
    (spaceId) => {
      const scope = `${branchId}|${navigation.value.floorId}|${navigation.value.date}|${spaceId}`;
      setDraft((current) =>
        current?.scope === scope
          ? { ...current, value: { ...current.value, title: "" } }
          : current,
      );
    },
    [branchId, navigation.value.floorId, navigation.value.date],
  );
  const changeLocation = navigation.change;
  const rememberPending = useCallback(
    (next: FloorLocation, href: string) => {
      const target = new URL(href, "http://floor.local");
      setPendingSelection(
        next.spaceId === null
          ? null
          : {
              key: floorSelectionKey(
                branchId,
                next.floorId,
                searchValue(target.searchParams, "date"),
                next.spaceId,
              ),
              spaceId: next.spaceId,
            },
      );
    },
    [branchId],
  );
  const change = useCallback<SelectionContext["change"]>(
    (next, href, options) => {
      if (!isCurrentRoute()) return;
      next = { ...next, detail: next.spaceId !== null && next.detail === true };
      setDismissedKey(next.spaceId === null ? locationKey : null);
      rememberPending(next, href);
      if (
        next.floorId !== navigation.value.floorId ||
        next.date !== navigation.value.date ||
        next.spaceId !== navigation.value.spaceId ||
        next.spaceId === null
      ) {
        setRange(null);
        setDraft(null);
      }
      changeLocation(next, href, options);
    },
    [
      locationKey,
      changeLocation,
      navigation.value,
      rememberPending,
      isCurrentRoute,
    ],
  );
  const currentNavigation = useRef({ location: navigation.value, change });
  useEffect(() => {
    currentNavigation.current = { location: navigation.value, change };
  }, [navigation.value, change]);
  const closeAfterBooking = useCallback(
    (spaceId: string, bookedDate: string) => {
      if (!isCurrentRoute()) return;
      const current = currentNavigation.current;
      // 늦게 끝난 이전 예약은 새 공간이나 날짜의 상세를 닫지 않는다.
      if (
        current.location.spaceId !== spaceId ||
        current.location.date !== bookedDate ||
        current.location.detail
      )
        return;
      const url = new URL(window.location.href);
      url.searchParams.delete("space");
      url.searchParams.delete("detail");
      current.change(
        { ...current.location, spaceId: null },
        `${url.pathname}${url.search}${url.hash}`,
        { replace: true },
      );
      restoreSpaceTrigger();
    },
    [restoreSpaceTrigger, isCurrentRoute],
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
      if (!isCurrentRoute()) return;
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
      if (spaceId !== navigation.value.spaceId || navigation.value.detail) {
        if (spaceId !== navigation.value.spaceId) setDraft(null);
        const nextLocation = { ...navigation.value, spaceId, detail: false };
        rememberPending(nextLocation, href);
        changeLocation(nextLocation, href);
      }
    },
    [
      bookingSelection,
      changeRange,
      rememberSpaceTrigger,
      navigation.value,
      changeLocation,
      rememberPending,
      isCurrentRoute,
    ],
  );
  const floorChanged = navigation.value.floorId !== base.floorId;
  const dateChanged = base.date !== "" && navigation.value.date !== base.date;
  const spaceChanged = navigation.value.spaceId !== base.spaceId;
  const listPending = navigation.isPending && (floorChanged || dateChanged);
  const detailChanged =
    navigation.isPending && (floorChanged || dateChanged || spaceChanged);
  const detailPending =
    (detailChanged || awaitingSelection !== null) &&
    navigation.value.spaceId !== null;
  const detailCleared =
    dismissedKey === locationKey ||
    (detailChanged && navigation.value.spaceId === null);
  const value = useMemo(
    () => ({
      branchId,
      search,
      routeActive: isActive,
      isCurrentRoute,
      draft: visibleDraft,
      changeDraft,
      clearDraftTitle,
      floorData,
      registerFloor,
      closeAfterBooking,
      selection: bookingSelection,
      changeRange,
      selectSlot,
      selectedSpaceId,
      selectionKey: locationKey,
      selectionResolved,
      register,
      registerNavigation,
      location: navigation.value,
      change,
      listPending,
      navigationPending: navigation.isPending,
      detailPending,
      detailCleared,
      rememberSpaceTrigger,
      restoreSpaceTrigger,
    }),
    [
      branchId,
      search,
      isActive,
      isCurrentRoute,
      visibleDraft,
      changeDraft,
      clearDraftTitle,
      floorData,
      registerFloor,
      closeAfterBooking,
      bookingSelection,
      changeRange,
      selectSlot,
      selectedSpaceId,
      locationKey,
      selectionResolved,
      register,
      registerNavigation,
      navigation.value,
      change,
      listPending,
      navigation.isPending,
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
