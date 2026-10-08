"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dayGridLayout } from "@/features/bookings/day-grid";
import { formatBookingTime } from "@/features/bookings/format";
import type { SelectableSlot } from "@/features/bookings/selection";
import type { DayBooking, SpaceDayData } from "@/features/bookings/types";
import { localDate, localTime } from "@/lib/time/zoned";
import { useBranchDisplayNow } from "./branch-display-clock";
import { cn } from "@/lib/utils";

const offset = (rows: number) => `calc(var(--booking-slot-height) * ${rows})`;

export function BookingTimeline({
  branchId = "standalone",
  slots,
  bookings,
  blocks,
  timeZone,
  now,
  date,
  start,
  end,
  disabled,
  onSelect,
  renderCancel,
}: {
  branchId?: string;
  slots: SelectableSlot[];
  bookings: DayBooking[];
  blocks: SpaceDayData["blocks"];
  timeZone: string;
  now: string;
  date: string;
  start: string;
  end: string;
  disabled: boolean;
  onSelect: (start: string) => void;
  renderCancel: (bookingId: string) => ReactNode;
}) {
  const id = useId();
  const displayNow = useBranchDisplayNow({ branchId, now });
  const [showPast, setShowPast] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const grid = dayGridLayout({
    slots,
    bookings,
    blocks,
    timeZone,
    now,
    date,
    showPast,
  });
  const freeSlots = grid.slots.filter((slot) => slot.state === "free");
  const tabStop = freeSlots.some((slot) => slot.start === focused)
    ? focused
    : freeSlots[0]?.start;
  const selected = (slot: SelectableSlot) =>
    Boolean(start && end) &&
    Date.parse(slot.start) >= Date.parse(start) &&
    Date.parse(slot.end) <= Date.parse(end);
  const hiddenFirst = grid.hiddenSlots[0];
  const hiddenLast = grid.hiddenSlots.at(-1);
  const displayPosition = grid.position(displayNow);
  const currentPosition =
    localDate(new Date(displayNow), timeZone) === date &&
    displayPosition >= 0 &&
    displayPosition < grid.slots.length
      ? displayPosition
      : null;
  return (
    <div className="space-y-3 [--booking-slot-height:44px] lg:[--booking-slot-height:28px]">
      {hiddenFirst && hiddenLast && (
        <Button
          type="button"
          variant="secondary"
          className="w-full justify-start gap-2 text-xs tabular-nums"
          aria-expanded={showPast}
          aria-controls={id}
          onClick={() => setShowPast((value) => !value)}
        >
          <Clock3 aria-hidden="true" className="size-4 shrink-0" />
          지난 시간 {showPast ? "접기" : "보기"} · {hiddenFirst.label}–
          {hiddenLast.endLabel} (예약 {grid.hiddenBookingCount}건)
        </Button>
      )}
      <div
        id={id}
        className="relative mb-4"
        style={{ height: offset(grid.slots.length) }}
      >
        {grid.slots.map((slot, index) => (
          <div
            key={slot.start}
            aria-hidden="true"
            className="absolute inset-x-0"
            style={{ top: offset(index), height: offset(1) }}
          >
            {(index === 0 || slot.label.endsWith(":00")) && (
              <span className="absolute top-0 left-0 text-xs text-muted-foreground tabular-nums">
                {slot.label}
              </span>
            )}
            <div
              className={cn(
                "absolute inset-y-0 right-0 left-14 border-t border-border",
                slot.label.endsWith(":30") && "border-dashed",
                slot.state === "past" && "bg-muted/40",
              )}
            />
          </div>
        ))}
        {grid.slots.at(-1) && (
          <span
            aria-hidden="true"
            className="absolute bottom-0 left-0 translate-y-full text-xs text-muted-foreground tabular-nums"
          >
            {grid.slots.at(-1)?.endLabel}
          </span>
        )}
        <div
          role="group"
          aria-label={`${date} 빈 시간`}
          className="absolute inset-y-0 right-0 left-14"
        >
          {freeSlots.map((slot) => (
            <Button
              key={slot.start}
              ref={(node) => {
                if (node) buttons.current.set(slot.start, node);
                else buttons.current.delete(slot.start);
              }}
              type="button"
              variant="ghost"
              data-booking-slot="true"
              className={cn(
                "absolute inset-x-0 w-full rounded-none p-0 transition-colors hover:bg-accent focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-ring",
                selected(slot) && "bg-status-mine",
              )}
              style={{
                top: offset(grid.position(slot.start)),
                height: offset(1),
              }}
              disabled={disabled}
              tabIndex={slot.start === tabStop ? 0 : -1}
              aria-label={`${slot.label}, 비어 있음`}
              aria-pressed={selected(slot)}
              onFocus={() => setFocused(slot.start)}
              onClick={() => onSelect(slot.start)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowUp" && event.key !== "ArrowDown")
                  return;
                event.preventDefault();
                const index = freeSlots.findIndex(
                  (item) => item.start === slot.start,
                );
                const next =
                  freeSlots[
                    Math.max(
                      0,
                      Math.min(
                        freeSlots.length - 1,
                        index + (event.key === "ArrowDown" ? 1 : -1),
                      ),
                    )
                  ];
                if (next) buttons.current.get(next.start)?.focus();
              }}
            />
          ))}
        </div>
        <div className="pointer-events-none absolute inset-y-0 right-0 left-14">
          {grid.blocks.map((block) => (
            <article
              key={`${block.kind}:${block.item.id}`}
              data-grid-block={block.kind}
              data-lane={block.lane}
              aria-label={
                block.kind === "booking"
                  ? `${block.item.bookerName} 예약`
                  : "점검 중"
              }
              className={cn(
                "pointer-events-auto absolute flex items-center gap-1 rounded-md border px-2 text-xs has-[[data-cancelling=true]]:opacity-50",
                block.kind === "maintenance"
                  ? "border-status-maintenance-border bg-status-maintenance-hatch text-status-maintenance-foreground"
                  : block.item.isMine
                    ? "border-status-mine-border bg-status-mine text-status-mine-foreground"
                    : "border-border bg-muted text-foreground",
              )}
              style={{
                top: offset(block.offset),
                height: offset(block.size),
                left: `calc(${(block.lane * 100) / block.lanes}% + 2px)`,
                width: `calc(${100 / block.lanes}% - 4px)`,
              }}
            >
              <div
                className={cn(
                  "min-w-0 flex-1",
                  block.size < 2 && "flex items-center gap-1",
                )}
              >
                <p
                  className="truncate tabular-nums"
                  title={formatBookingTime(
                    block.item.start,
                    block.item.end,
                    timeZone,
                  )}
                >
                  {formatBookingTime(
                    block.item.start,
                    block.item.end,
                    timeZone,
                  )}
                </p>
                <p
                  className="truncate"
                  title={
                    block.kind === "booking"
                      ? [block.item.bookerName, block.item.title]
                          .filter(Boolean)
                          .join(" · ")
                      : block.item.reason || "점검 중"
                  }
                >
                  {block.kind === "booking"
                    ? block.item.bookerName
                    : block.item.reason || "점검 중"}
                  {block.kind === "booking" && block.item.title
                    ? ` · ${block.item.title}`
                    : ""}
                </p>
              </div>
              {block.kind === "booking" && block.item.canCancel && (
                <span className="shrink-0 [&_button]:px-1.5 lg:[&_button]:h-7">
                  {renderCancel(block.item.id)}
                </span>
              )}
            </article>
          ))}
          {start && end && (
            <div
              className="absolute inset-x-0 rounded-md border border-dashed border-status-mine-border px-2 py-1 text-xs font-semibold text-status-mine-foreground"
              style={{
                top: offset(grid.position(start)),
                height: offset(grid.position(end) - grid.position(start)),
              }}
            >
              새 예약{" "}
              <span className="tabular-nums">
                {formatBookingTime(start, end, timeZone)}
              </span>
            </div>
          )}
          {currentPosition !== null && (
            <div
              aria-label={`지금 ${localTime(new Date(displayNow), timeZone)}`}
              className="absolute inset-x-0 z-10 border-t-2 border-status-busy-strong before:absolute before:-top-1 before:-left-1 before:size-1.5 before:rounded-full before:bg-status-busy-strong"
              style={{ top: offset(currentPosition) }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
