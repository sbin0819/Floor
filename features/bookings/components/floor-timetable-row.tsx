import type { KeyboardEvent } from "react";
import { ChevronRight, LockKeyhole } from "lucide-react";
import { SpacePhoto } from "@/components/photos/space-photo";
import { Button } from "@/components/ui/button";
import {
  floorHref,
  formatBookingTime,
  spaceTypeLabels,
} from "@/features/bookings/format";
import type { FloorBookingSelection } from "@/features/bookings/selection";
import type {
  TimetableFocus,
  TimetableRow as TimetableRowData,
} from "@/features/bookings/timetable";
import { amenityKeys, amenityLabels } from "@/lib/spaces/amenities";
import { cn } from "@/lib/utils";
import { FloorNavigationLink } from "./floor-navigation-link";
import type { TimetableSlotSelection } from "./floor-timetable";

const blockLabels = {
  other: "예약됨",
  mine: "내 예약",
  maintenance: "점검",
} as const;

type FocusProps = {
  tabIndex: number;
  ref: (element: HTMLElement | null) => void;
  onFocus: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
};

export function FloorTimetableRow({
  row,
  branchId,
  floorId,
  date,
  timeZone,
  view,
  selectedSpaceId,
  selection,
  columns,
  pastColumns,
  windowStart,
  focusProps,
  onSelectSlot,
}: {
  row: TimetableRowData;
  branchId: string;
  floorId: string;
  date: string;
  timeZone: string;
  view?: string;
  selectedSpaceId: string | null;
  selection: FloorBookingSelection | null;
  columns: number;
  pastColumns: number;
  windowStart: number | null;
  focusProps: (position: TimetableFocus) => FocusProps;
  onSelectSlot?: (input: TimetableSlotSelection) => void;
}) {
  const rowColumns = "var(--timetable-label-width) minmax(0, 1fr)";
  const timeColumns = `repeat(${columns}, minmax(0, 1fr))`;
  const percent = (value: number) => `${(value / columns) * 100}%`;
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
          <LockKeyhole className="size-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium">전용 공간</p>
            <p className="mt-1 text-xs">다른 팀이 쓰는 공간이에요</p>
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
  const href = floorHref(branchId, floorId, date, space.id, view);
  const isSelected = selectedSpaceId === space.id;
  const detailHref = floorHref(branchId, floorId, date, space.id, view, true);
  const height = Math.max(76, row.laneCount * 44 + 16);
  const selected = selection?.spaceId === space.id ? selection : null;
  const selectedStart =
    selected && windowStart !== null
      ? (Date.parse(selected.start) - windowStart) / 1_800_000
      : null;
  const selectedSize = selected
    ? (Date.parse(selected.end) - Date.parse(selected.start)) / 1_800_000
    : 0;
  return (
    <div
      key={space.id}
      role="row"
      className="grid border-b border-border last:border-b-0"
      style={{
        gridTemplateColumns: rowColumns,
        minHeight: height,
      }}
    >
      <div
        role="rowheader"
        className={cn(
          "sticky left-0 z-20 border-l-[3px] bg-card",
          isSelected ? "border-l-primary bg-accent" : "border-l-transparent",
        )}
      >
        <FloorNavigationLink
          {...focusProps({ spaceId: space.id, target: "space" })}
          data-space-id={space.id}
          href={detailHref}
          location={{
            floorId: floorId,
            date: date,
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
                .filter((amenity) => visible.amenities.includes(amenity))
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
                Date.parse(slot.start) >= Date.parse(selected.start) &&
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
                        onSelectSlot?.({
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
            {pastColumns > 0 && (
              <div
                aria-hidden="true"
                data-timetable-past
                className="pointer-events-none absolute inset-y-0 left-0 bg-muted/50"
                style={{ width: percent(pastColumns) }}
              />
            )}
            {row.blocks.map((block, index) => (
              <div
                key={`${block.kind}:${block.start}:${index}`}
                role="gridcell"
                aria-colindex={block.column + 2}
                aria-colspan={block.span}
                aria-label={`${blockLabels[block.kind]} ${formatBookingTime(block.start, block.end, timeZone)}`}
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
                    height - 16 > 44 && row.laneCount === 1 ? height - 16 : 40,
                }}
              >
                <span className={block.size >= 2 ? "truncate" : "sr-only"}>
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
}
