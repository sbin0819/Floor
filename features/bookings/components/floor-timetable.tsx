"use client";

import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useSearchParams } from "next/navigation";
import { ChevronRight, LockKeyhole } from "lucide-react";
import { SpacePhoto } from "@/components/photos/space-photo";
import { Button } from "@/components/ui/button";
import {
  floorHref,
  formatBookingTime,
  spaceTypeLabels,
} from "@/features/bookings/format";
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
import { amenityKeys, amenityLabels } from "@/lib/spaces/amenities";
import { cn } from "@/lib/utils";
import { useFloorSelection } from "./branch-workspace";
import { FloorNavigationLink } from "./floor-navigation-link";

export type TimetableSlotSelection = {
  spaceId: string;
  slots: SelectableSlot[];
  start: string;
  href: string;
  trigger?: HTMLElement;
};
const blockLabels = {
  other: "예약됨",
  mine: "내 예약",
  maintenance: "점검",
} as const;
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
}: {
  data: FloorDayData;
  selection?: FloorBookingSelection | null;
  onSelectSlot?: (input: TimetableSlotSelection) => void;
}) {
  const workspace = useFloorSelection();
  const search = useSearchParams();
  const view = search.get("view") ?? undefined;
  const selection =
    controlledSelection === undefined
      ? (workspace?.selection ?? null)
      : controlledSelection;
  const layout = useMemo(() => floorTimetableLayout(data), [data]);
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
  const percent = (value: number) => `${(value / columns) * 100}%`;
  const rowColumns = "var(--timetable-label-width) minmax(0, 1fr)";
  const timeColumns = `repeat(${columns}, minmax(0, 1fr))`;
  const chosenSpace = workspace?.location.spaceId ?? selection?.spaceId ?? null;
  return (
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
          className="grid h-12 border-b border-border text-xs text-muted-foreground tabular-nums"
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
                  "flex items-center border-l px-1",
                  slot.label.endsWith(":00")
                    ? "border-border"
                    : "border-border/40",
                )}
              >
                <span aria-hidden="true">
                  {index === 0 || slot.label.endsWith(":00") ? slot.label : ""}
                </span>
              </div>
            ))}
            {layout.slots.at(-1) && (
              <span
                aria-hidden="true"
                className="absolute top-1 right-1 text-[10px]"
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
                  {group.freeCount === null
                    ? `${group.totalCount}곳`
                    : `${group.totalCount}곳 · 지금 ${group.freeCount}곳 비어 있음`}
                </span>
              </div>
            </div>
            {group.rows.map((row) => {
              const space = row.space;
              if (row.kind === "restricted")
                return (
                  <div
                    key={space.id}
                    role="row"
                    className="grid min-h-[76px] border-b border-border last:border-b-0"
                    style={{ gridTemplateColumns: rowColumns }}
                  >
                    <div
                      role="rowheader"
                      className="sticky left-0 z-20 flex items-center gap-2 bg-card px-4 text-muted-foreground"
                    >
                      <LockKeyhole
                        className="size-4 shrink-0"
                        aria-hidden="true"
                      />
                      <div>
                        <p className="text-sm font-medium">전용 공간</p>
                        <p className="mt-1 text-xs">
                          다른 팀이 쓰는 공간이에요
                        </p>
                      </div>
                    </div>
                    <div
                      role="gridcell"
                      aria-colindex={2}
                      aria-colspan={columns}
                      className="bg-status-maintenance-hatch"
                    />
                  </div>
                );
              const visible = row.space;
              const href = floorHref(
                data.branch.id,
                data.floor.id,
                data.date,
                space.id,
                view,
              );
              const isSelected = chosenSpace === space.id;
              const detailHref = floorHref(
                data.branch.id,
                data.floor.id,
                data.date,
                space.id,
                view,
                true,
              );
              const height = Math.max(76, row.laneCount * 44 + 16);
              const selected =
                selection?.spaceId === space.id ? selection : null;
              const selectedStart =
                selected && layout.start !== null
                  ? (Date.parse(selected.start) - layout.start) / 1_800_000
                  : null;
              const selectedSize = selected
                ? (Date.parse(selected.end) - Date.parse(selected.start)) /
                  1_800_000
                : 0;
              return (
                <div
                  key={space.id}
                  role="row"
                  className="grid border-b border-border last:border-b-0"
                  style={{ gridTemplateColumns: rowColumns, minHeight: height }}
                >
                  <div
                    role="rowheader"
                    className={cn(
                      "sticky left-0 z-20 border-l-[3px] bg-card",
                      isSelected
                        ? "border-l-primary bg-accent"
                        : "border-l-transparent",
                    )}
                  >
                    <FloorNavigationLink
                      {...focusProps({ spaceId: space.id, target: "space" })}
                      data-space-id={space.id}
                      href={detailHref}
                      location={{
                        floorId: data.floor.id,
                        date: data.date,
                        spaceId: space.id,
                        detail: true,
                      }}
                      aria-current={isSelected ? "true" : undefined}
                      aria-haspopup="dialog"
                      className="flex h-full min-h-11 items-center gap-3 px-3 py-2 hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
                    >
                      <span className="hidden shrink-0 lg:block">
                        <SpacePhoto
                          photo={visible.photo}
                          type={visible.type}
                          size={{ width: 48, height: 36 }}
                          decorative
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">
                          {visible.name}
                        </span>
                        <span className="mt-1 block truncate text-xs text-muted-foreground tabular-nums">
                          {visible.capacity === null
                            ? spaceTypeLabels[visible.type]
                            : `최대 ${visible.capacity}인`}
                          {amenityKeys
                            .filter((amenity) =>
                              visible.amenities.includes(amenity),
                            )
                            .map((amenity) => ` · ${amenityLabels[amenity]}`)
                            .join("")}
                        </span>
                      </span>
                      <ChevronRight
                        aria-hidden="true"
                        className={cn(
                          "hidden size-4 shrink-0 lg:block",
                          isSelected ? "text-primary" : "text-muted-foreground",
                        )}
                      />
                    </FloorNavigationLink>
                  </div>
                  <div
                    role="presentation"
                    className="relative grid"
                    style={{ gridTemplateColumns: timeColumns }}
                  >
                    {!visible.bookable ? (
                      <div
                        role="gridcell"
                        aria-colindex={2}
                        aria-colspan={columns}
                        className="col-span-full flex items-center bg-muted/30 px-4 text-xs text-muted-foreground"
                      >
                        <span className="sticky left-[calc(var(--timetable-label-width)+16px)]">
                          {visible.deskCount
                            ? `좌석 ${visible.deskCount}석 · 좌석 예약은 준비 중이에요`
                            : "예약 없이 이용해요"}
                        </span>
                      </div>
                    ) : (
                      <>
                        {row.slots.map((slot, index) => {
                          const pressed = Boolean(
                            selected &&
                            Date.parse(slot.start) >=
                              Date.parse(selected.start) &&
                            Date.parse(slot.end) <= Date.parse(selected.end),
                          );
                          return (
                            <div
                              key={slot.start}
                              role={
                                slot.state === "free" || slot.state === "past"
                                  ? "gridcell"
                                  : "presentation"
                              }
                              aria-colindex={
                                slot.state === "free" || slot.state === "past"
                                  ? index + 2
                                  : undefined
                              }
                              className={cn(
                                "relative before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:z-10 before:border-l",
                                slot.label.endsWith(":00")
                                  ? "before:border-border"
                                  : "before:border-border/40",
                              )}
                            >
                              {slot.state === "free" && (
                                <Button
                                  {...focusProps({
                                    spaceId: space.id,
                                    target: "slot",
                                    start: slot.start,
                                  })}
                                  type="button"
                                  variant="ghost"
                                  data-floor-timetable-slot="true"
                                  className={cn(
                                    "h-full min-h-11 w-full min-w-0 [scroll-margin-inline-start:var(--timetable-label-width)] rounded-none p-0 hover:bg-accent focus-visible:relative focus-visible:z-30",
                                    pressed && "bg-accent",
                                  )}
                                  aria-label={`${visible.name}, ${slot.label}, 비어 있음`}
                                  aria-pressed={pressed}
                                  onClick={(event) =>
                                    (onSelectSlot ?? workspace?.selectSlot)?.({
                                      spaceId: space.id,
                                      slots: row.slots,
                                      start: slot.start,
                                      href,
                                      trigger: event.currentTarget,
                                    })
                                  }
                                />
                              )}
                            </div>
                          );
                        })}
                        {layout.pastColumns > 0 && (
                          <div
                            aria-hidden="true"
                            data-timetable-past
                            className="pointer-events-none absolute inset-y-0 left-0 bg-muted/50"
                            style={{ width: percent(layout.pastColumns) }}
                          />
                        )}
                        {row.blocks.map((block, index) => (
                          <div
                            key={`${block.kind}:${block.start}:${index}`}
                            role="gridcell"
                            aria-colindex={block.column + 2}
                            aria-colspan={block.span}
                            aria-label={`${blockLabels[block.kind]} ${formatBookingTime(block.start, block.end, data.branch.timezone)}`}
                            data-timetable-block={block.kind}
                            data-lane={block.lane}
                            className={cn(
                              "pointer-events-none absolute z-10 flex items-center justify-center overflow-hidden rounded-sm border px-1 text-xs font-medium",
                              block.kind === "mine"
                                ? "border-primary bg-primary text-primary-foreground"
                                : block.kind === "maintenance"
                                  ? "border-border bg-status-maintenance-hatch text-muted-foreground"
                                  : "border-booked-border bg-booked text-booked-foreground",
                              block.ended && "opacity-50",
                            )}
                            style={{
                              left: percent(block.offset),
                              width: percent(block.size),
                              top: 8 + block.lane * 44,
                              height:
                                height - 16 > 44 && row.laneCount === 1
                                  ? height - 16
                                  : 40,
                            }}
                          >
                            <span
                              className={
                                block.size >= 2 ? "truncate" : "sr-only"
                              }
                            >
                              {blockLabels[block.kind]}
                            </span>
                          </div>
                        ))}
                        {selectedStart !== null && selectedSize > 0 && (
                          <div
                            aria-hidden="true"
                            data-timetable-selection
                            className="pointer-events-none absolute inset-y-2 z-10 flex items-center justify-center overflow-hidden rounded-sm border-2 border-dashed border-primary bg-accent/70 text-xs font-semibold text-accent-foreground"
                            style={{
                              left: percent(selectedStart),
                              width: percent(selectedSize),
                            }}
                          >
                            새 예약
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        {layout.nowPosition !== null && (
          <div
            data-timetable-clock
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 z-10 border-l-2 border-status-busy-strong"
            style={{
              left: `calc(var(--timetable-label-width) + (100% - var(--timetable-label-width)) * ${layout.nowPosition / columns})`,
            }}
          >
            <span className="absolute top-0 left-0 -translate-x-1/2 rounded-b bg-status-busy-strong px-1 py-0.5 text-[10px] text-primary-foreground tabular-nums">
              {localTime(new Date(data.now), data.branch.timezone)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
