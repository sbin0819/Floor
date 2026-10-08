import { cn } from "cn";
import { BookingChip } from "@/components/booking-chip";
import { Skeleton } from "@/components/ui/skeleton";
import { bookingChipKind } from "@/features/bookings/booking-chip-state";
import { formatBookingTime } from "@/features/bookings/format";
import type { MyCalendarBooking } from "@/features/bookings/types";
import type { CalendarDay } from "@/lib/calendar/month";

export function CalendarDayNumber({
  day,
  today,
}: {
  day: CalendarDay;
  today: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-full text-sm font-medium",
        day.date === today && "bg-foreground text-background",
      )}
    >
      {day.day}
    </span>
  );
}

export function CalendarDayBookings({
  bookings,
  now,
  labelId,
}: {
  bookings: MyCalendarBooking[];
  now: string;
  labelId?: string;
}) {
  return (
    <>
      {labelId && (
        <span id={labelId} className="sr-only">
          예약 {bookings.length}건
        </span>
      )}
      <span
        data-slot="calendar-booking-chips"
        className="mt-1 hidden space-y-1 md:block"
      >
        {bookings.slice(0, 2).map((booking) => (
          <BookingChip key={booking.id} kind={bookingChipKind(booking, now)}>
            {
              formatBookingTime(
                booking.start,
                booking.end,
                booking.timezone,
              ).split("–")[0]
            }{" "}
            {booking.spaceName}
          </BookingChip>
        ))}
        {bookings.length > 2 && (
          <span className="block px-1 text-xs text-muted-foreground">
            +{bookings.length - 2}건 더
          </span>
        )}
      </span>
      <span
        data-slot="calendar-booking-dots"
        className="mt-1 flex h-1 items-center justify-center gap-1 md:hidden"
      >
        {bookings.slice(0, 3).map((booking) => (
          <span
            key={booking.id}
            aria-hidden="true"
            className={cn(
              "size-1 shrink-0 rounded-full",
              bookingChipKind(booking, now) === "past"
                ? "bg-muted-foreground"
                : bookingChipKind(booking, now) === "ongoing"
                  ? "bg-primary"
                  : "bg-primary/40",
            )}
          />
        ))}
        <span className="sr-only">예약 {bookings.length}건</span>
      </span>
    </>
  );
}

export function CalendarDayBookingsPending({ labelId }: { labelId: string }) {
  return (
    <div aria-busy="true">
      <span id={labelId} className="sr-only">
        예약을 불러오고 있어요
      </span>
      <Skeleton
        aria-hidden="true"
        className="mt-1 hidden h-5 w-full md:block"
      />
      <Skeleton aria-hidden="true" className="mt-1 h-1 w-4 md:hidden" />
    </div>
  );
}

export function MyBookingCalendarDay({
  day,
  bookings,
  now,
  today,
}: {
  day: CalendarDay;
  bookings: MyCalendarBooking[];
  now: string;
  today: string;
}) {
  return (
    <>
      <CalendarDayNumber day={day} today={today} />
      <CalendarDayBookings bookings={bookings} now={now} />
    </>
  );
}
