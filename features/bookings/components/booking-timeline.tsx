"use client";

import { Button } from "@/components/ui/button";
import { formatBookingTime } from "@/features/bookings/format";
import type { SelectableSlot } from "@/features/bookings/selection";
import { localDate, localTime } from "@/lib/time/zoned";
import { CancelBookingButton } from "./cancel-booking-button";

const labels = {
  free: "비어 있음",
  past: "지난 시간",
  reserved: "예약 중",
  maintenance: "점검 중",
};

export function BookingTimeline({
  slots,
  timeZone,
  now,
  date,
  start,
  end,
  disabled,
  onSelect,
}: {
  slots: SelectableSlot[];
  timeZone: string;
  now: string;
  date: string;
  start: string;
  end: string;
  disabled: boolean;
  onSelect: (start: string) => void;
}) {
  const current = new Date(now);
  return (
    <section aria-label="하루 일정" className="space-y-3">
      <h3 className="font-semibold">하루 일정</h3>
      {slots.length === 0 && (
        <p className="text-sm text-muted-foreground">
          이 날은 고를 수 있는 시간이 없어요
        </p>
      )}
      <ol className="max-h-[28rem] overflow-y-auto rounded-lg border border-border">
        {slots.map((slot, index) => {
          const booking = slot.booking;
          const showBooking =
            booking && slots[index - 1]?.booking?.id !== booking.id;
          const block = slot.block;
          const showBlock = block && slots[index - 1]?.block?.id !== block.id;
          const selected =
            start !== "" &&
            end !== "" &&
            slot.start >= start &&
            slot.end <= end;
          const isCurrent =
            localDate(current, timeZone) === date &&
            current >= new Date(slot.start) &&
            current < new Date(slot.end);
          return (
            <li
              key={slot.start}
              className={`border-b border-border last:border-0 ${slot.state === "maintenance" ? "bg-status-maintenance-hatch" : booking?.isMine || selected ? "bg-status-mine text-status-mine-foreground" : slot.state === "free" ? "bg-card" : "bg-muted"}`}
            >
              {isCurrent && (
                <p className="border-t-2 border-status-busy-border px-3 text-xs tabular-nums">
                  현재 {localTime(current, timeZone)}
                </p>
              )}
              <Button
                type="button"
                variant="ghost"
                className="min-h-11 w-full justify-between rounded-none px-3 text-sm tabular-nums"
                aria-label={`${slot.label}, ${labels[slot.state]}`}
                aria-pressed={selected}
                disabled={disabled || slot.state !== "free"}
                onClick={() => onSelect(slot.start)}
              >
                <span>{slot.label}</span>
                <span>{labels[slot.state]}</span>
              </Button>
              {showBooking && (
                <div className="flex items-center justify-between gap-2 px-3 pb-3 text-sm">
                  <div>
                    <p className="tabular-nums">
                      {formatBookingTime(booking.start, booking.end, timeZone)}{" "}
                      · {booking.bookerName}
                    </p>
                    {booking.title && <p>{booking.title}</p>}
                  </div>
                  {booking.canCancel && (
                    <CancelBookingButton bookingId={booking.id} />
                  )}
                </div>
              )}
              {showBlock && (
                <p className="px-3 pb-3 text-sm tabular-nums">
                  {formatBookingTime(block.start, block.end, timeZone)} ·{" "}
                  {block.reason ?? "점검 중이에요"}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
