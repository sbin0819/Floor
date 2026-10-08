"use client";

import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useSearchParams } from "next/navigation";
import { Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { spaceTypeLabels } from "@/features/bookings/format";
import type {
  FloorBookingSelection,
  SelectableSlot,
} from "@/features/bookings/selection";
import {
  floorTimetableLayout,
  moveTimetableFocus,
  timetableFocusKey,
  timetableFocusTargets,
  type TimetableFocus,
} from "@/features/bookings/timetable";
import type { FloorDayData } from "@/features/bookings/types";
import { localTime } from "@/lib/time/zoned";
import { cn } from "@/lib/utils";
import { useFloorSelection } from "./branch-workspace";
import { useBookingRange } from "./use-booking-draft";
import { FloorTimetableRow } from "./floor-timetable-row";
import { useBranchDisplayNow } from "./branch-display-clock";
import { getDisplayOperatingState } from "@/features/bookings/display-operating-state";
import type { DeskPart } from "@/features/bookings/desk-parts";
import { bookingDraftScope } from "@/features/bookings/booking-draft-store";

export type TimetableSlotSelection = {
  spaceId: string;
  slots: SelectableSlot[];
  start: string;
  href: string;
  trigger?: HTMLElement;
};
export type TimetableDeskSelection = {
  spaceId: string;
  part: DeskPart;
  href: string;
  trigger?: HTMLElement;
};
const arrowKeys = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
]);

export function FloorTimetable({
  data,
  selection: controlledSelection,
  onSelectSlot,
  onSelectDeskPart,
}: {
  data: FloorDayData;
  selection?: FloorBookingSelection | null;
  onSelectSlot?: (input: TimetableSlotSelection) => void;
  onSelectDeskPart?: (input: TimetableDeskSelection) => void;
}) {
  const workspace = useFloorSelection();
  const selectDeskPart = (input: TimetableDeskSelection) => {
    if (!workspace?.isCurrentRoute()) return;
    const scope = bookingDraftScope(
      data.branch.id,
      data.floor.id,
      data.date,
      input.spaceId,
    );
    workspace.draftStore.getState().activate(scope);
    workspace.draftStore.getState().changeDeskPart(scope, input.part);
    if (input.trigger)
      workspace.rememberSpaceTrigger(input.trigger, input.spaceId);
    workspace.change(
      {
        floorId: data.floor.id,
        date: data.date,
        spaceId: input.spaceId,
        detail: true,
      },
      input.href,
    );
  };
  const sharedRange = useBookingRange(
    workspace?.draftStore,
    workspace?.bookingScope,
  );
  const currentSearch = useSearchParams();
  const search = workspace?.search ?? currentSearch;
  const view = search.get("view") ?? undefined;
  const selection =
    controlledSelection === undefined ? sharedRange : controlledSelection;
  const displayNow = useBranchDisplayNow({
    branchId: data.branch.id,
    now: data.now,
  });
  const displayState = getDisplayOperatingState({
    date: data.date,
    now: displayNow,
    timeZone: data.branch.timezone,
    openHours: data.branch.openHours,
  });
  const layout = useMemo(
    () => floorTimetableLayout(data, displayNow),
    [data, displayNow],
  );
  const targets = timetableFocusTargets(layout.rows);
  const [focused, setFocused] = useState<string | null>(null);
  const tabStop = targets.some(
    (target) => timetableFocusKey(target) === focused,
  )
    ? focused
    : targets[0]
      ? timetableFocusKey(targets[0])
      : null;
  const nodes = useRef(new Map<string, HTMLElement>());
  const scroller = useRef<HTMLDivElement>(null);
  const initialized = useRef<string | null>(null);
  const scrollKey = `${data.branch.id}:${data.floor.id}:${data.date}`;
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const position = () => {
      if (initialized.current === scrollKey || element.clientWidth === 0)
        return;
      const first = element.querySelector<HTMLElement>('[role="columnheader"]');
      if (
        layout.nowPosition !== null &&
        first &&
        element.scrollWidth > element.clientWidth
      ) {
        const columnWidth =
          (element.scrollWidth - first.offsetWidth) / layout.slots.length;
        element.scrollLeft = Math.max(
          0,
          (layout.nowPosition - 2) * columnWidth,
        );
      } else element.scrollLeft = 0;
      initialized.current = scrollKey;
    };
    position();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(position);
    observer.observe(element);
    return () => observer.disconnect();
  }, [scrollKey, layout.nowPosition, layout.slots.length]);
  const focusProps = (position: TimetableFocus) => {
    const key = timetableFocusKey(position);
    return {
      tabIndex: key === tabStop ? 0 : -1,
      ref: (element: HTMLElement | null) => {
        if (element) nodes.current.set(key, element);
        else nodes.current.delete(key);
      },
      onFocus: () => setFocused(key),
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        if (!arrowKeys.has(event.key)) return;
        event.preventDefault();
        const next = moveTimetableFocus(layout.rows, position, event.key);
        const element = nodes.current.get(timetableFocusKey(next));
        element?.focus();
        const container = scroller.current;
        if (element && container && next.target === "slot") {
          // 브라우저의 기본 포커스 스크롤은 sticky 열이 가린 영역을 놓칠 수 있다.
          const label = container.querySelector<HTMLElement>(
            '[role="columnheader"]',
          );
          const rectangle = element.getBoundingClientRect();
          const left = label?.getBoundingClientRect().right;
          if (left !== undefined && rectangle.left < left)
            container.scrollLeft -= left - rectangle.left;
          else {
            const overflow =
              rectangle.right -
              container.getBoundingClientRect().right +
              container.clientLeft;
            if (overflow > 0) container.scrollLeft += overflow;
          }
        }
      },
    };
  };
  const columns = Math.max(1, layout.slots.length);
  const rowColumns = "var(--timetable-label-width) minmax(0, 1fr)";
  const timeColumns = `repeat(${columns}, minmax(0, 1fr))`;
  const chosenSpace = workspace?.location.spaceId ?? selection?.spaceId ?? null;
  const clockPosition =
    layout.nowPosition === null
      ? null
      : `calc(var(--timetable-label-width) + (100% - var(--timetable-label-width)) * ${layout.nowPosition / columns})`;
  const clockLabel = `현재 ${localTime(new Date(displayNow), data.branch.timezone)}`;
  const operatingLabel =
    displayState.operating.status === "before_open"
      ? `${displayState.hours?.open}에 열어요`
      : displayState.operating.status === "after_close"
        ? "오늘 영업이 끝났어요"
        : displayState.operating.status === "closed"
          ? "오늘은 쉬는 날이에요"
          : "영업 중";
  const scrollToNow = () => {
    const element = scroller.current;
    const label = element?.querySelector<HTMLElement>('[role="columnheader"]');
    if (!element || !label || layout.nowPosition === null) return;
    const width = (element.scrollWidth - label.offsetWidth) / columns;
    element.scrollTo({
      left: Math.max(0, (layout.nowPosition - 2) * width),
      behavior: "instant",
    });
  };
  return (
    <section aria-label="층 시간표" className="min-w-0 space-y-2">
      {displayState.isToday && (
        <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums">
          <p data-timetable-clock-status>
            {clockLabel} · {operatingLabel}
          </p>
          {layout.nowPosition !== null && (
            <Button
              type="button"
              variant="ghost"
              className="gap-1.5 text-xs"
              onClick={scrollToNow}
            >
              <Clock3 aria-hidden="true" className="size-4" />
              현재 시간으로 이동
            </Button>
          )}
        </div>
      )}
      <div
        ref={scroller}
        className="max-w-full min-w-0 overflow-x-auto rounded-xl border border-border bg-card [--timetable-cell-width:44px] [--timetable-label-width:148px] lg:[--timetable-cell-width:34px] lg:[--timetable-label-width:232px]"
      >
        <div
          role="grid"
          aria-label={`${data.date} 시간표`}
          aria-colcount={columns + 1}
          tabIndex={targets.length ? undefined : 0}
          data-floor-timetable
          className="relative w-full focus-visible:outline-2 focus-visible:outline-ring"
          style={{
            minWidth: `calc(var(--timetable-label-width) + var(--timetable-cell-width) * ${columns})`,
          }}
        >
          <div
            role="row"
            className="grid h-20 border-b border-border text-xs text-muted-foreground tabular-nums"
            style={{ gridTemplateColumns: rowColumns }}
          >
            <div
              role="columnheader"
              aria-colindex={1}
              className="sticky left-0 z-30 flex items-center bg-muted px-4 font-medium"
            >
              공간
            </div>
            <div
              role="presentation"
              className="relative grid"
              style={{ gridTemplateColumns: timeColumns }}
            >
              {layout.slots.map((slot, index) => (
                <div
                  key={slot.start}
                  role="columnheader"
                  aria-colindex={index + 2}
                  aria-label={slot.label}
                  data-timetable-time-header={index === 0 ? "true" : undefined}
                  className={cn(
                    "flex items-center border-l px-1 pt-7",
                    slot.label.endsWith(":00")
                      ? "border-border"
                      : "border-border/40",
                  )}
                >
                  <span aria-hidden="true">
                    {index === 0 || slot.label.endsWith(":00")
                      ? slot.label
                      : ""}
                  </span>
                </div>
              ))}
              {layout.slots.at(-1) && (
                <span
                  aria-hidden="true"
                  className="absolute top-8 right-1 text-[10px]"
                >
                  {layout.slots.at(-1)?.endLabel}
                </span>
              )}
            </div>
          </div>
          {layout.groups.map((group) => (
            <div key={group.type} role="rowgroup">
              <div
                role="row"
                className="grid h-10 border-b border-border bg-muted/60"
                style={{ gridTemplateColumns: rowColumns }}
              >
                <div
                  role="rowheader"
                  aria-colspan={columns + 1}
                  className="sticky left-0 z-30 col-span-full flex w-fit items-center gap-2 bg-muted px-4 text-sm font-semibold whitespace-nowrap"
                >
                  {spaceTypeLabels[group.type]}{" "}
                  <span className="text-xs font-normal text-muted-foreground tabular-nums">
                    {group.type === "desk_area"
                      ? `${group.totalCount}곳${group.rows.some((row) => row.kind === "accessible" && row.space.deskCount > 0) ? ` · 좌석 ${group.rows.reduce((total, row) => total + (row.kind === "accessible" ? row.space.deskCount : 0), 0)}석` : ""}`
                      : group.freeCount === null
                        ? `${group.totalCount}곳`
                        : `${group.totalCount}곳 · 지금 ${group.freeCount}곳 비어 있음`}
                  </span>
                </div>
              </div>
              {group.rows.map((row) => (
                <FloorTimetableRow
                  key={row.space.id}
                  row={row}
                  branchId={data.branch.id}
                  floorId={data.floor.id}
                  date={data.date}
                  timeZone={data.branch.timezone}
                  view={view}
                  selectedSpaceId={chosenSpace}
                  selection={selection}
                  columns={columns}
                  pastColumns={layout.pastColumns}
                  windowStart={layout.start}
                  focusProps={focusProps}
                  onSelectSlot={onSelectSlot ?? workspace?.selectSlot}
                  onSelectDeskPart={onSelectDeskPart ?? selectDeskPart}
                />
              ))}
            </div>
          ))}
          {clockPosition !== null && (
            <>
              <div
                data-timetable-clock
                aria-hidden="true"
                className="pointer-events-none absolute top-7 bottom-0 z-10 border-l-2 border-status-busy-strong"
                style={{
                  left: clockPosition,
                }}
              />
              <span
                data-timetable-clock-label
                aria-hidden="true"
                className="pointer-events-none absolute top-1 z-10 w-14 -translate-x-1/2 rounded-md bg-status-busy-strong py-1 text-center text-xs font-semibold text-primary-foreground tabular-nums"
                style={{
                  left: `clamp(calc(var(--timetable-label-width) + 28px), ${clockPosition}, calc(100% - 28px))`,
                }}
              >
                {localTime(new Date(displayNow), data.branch.timezone)}
              </span>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
