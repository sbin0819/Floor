import Link from "next/link";
import { SpacePhoto } from "@/components/photos/space-photo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { bookingChipKind } from "@/features/bookings/booking-chip-state";
import {
  formatBookingDate,
  relativeBookingStatus,
} from "@/features/bookings/format";
import type {
  MyCalendarBooking,
  MyBookingsMonthMeta,
} from "@/features/bookings/types";
import { addDays } from "@/lib/time/zoned";
import { CancelBookingButton } from "./cancel-booking-button";
import {
  bookingSpaceHref,
  bookingSpaceLabel,
  bookingPhoto,
  canLeaveBooking,
  isUnfinishedBooking,
} from "@/features/bookings/booking-presentation";
import { BookingTime } from "./booking-time";
import { LeaveBookingButton } from "./leave-booking-button";
import { BookingParticipantsSummary } from "./booking-participants-summary";
import { EditBookingLink } from "./edit-booking-link";
import { BookingChatLink } from "./booking-chat-link";
import {
  CalendarBookingData,
  type CalendarBookings,
} from "./my-bookings-calendar-data";

function CalendarBookingCards({
  bookings,
  now,
}: {
  bookings: MyCalendarBooking[];
  now: string;
}) {
  if (bookings.length === 0)
    return (
      <p className="py-5 text-sm text-muted-foreground">
        이 날은 예약이 없어요
      </p>
    );
  return (
    <ul className="space-y-4">
      {bookings.map((booking) => {
        const spaceHref = bookingSpaceHref(booking);
        const kind = bookingChipKind(booking, now);
        const status =
          booking.status === "cancelled"
            ? "취소됨"
            : kind === "past"
              ? "이용 종료"
              : relativeBookingStatus(booking.start, booking.end, now);
        return (
          <li
            key={booking.id}
            className="space-y-3 rounded-lg border border-border p-3 has-[[data-cancelling=true]]:opacity-50"
          >
            <div className="flex items-start gap-3">
              <SpacePhoto
                photo={bookingPhoto(booking)}
                type={booking.spaceType}
                decorative
              />
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-semibold tabular-nums">
                  <BookingTime booking={booking} />
                </p>
                <h3 className="text-sm font-semibold">
                  {bookingSpaceLabel(booking)}
                </h3>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {booking.branchName} · {booking.floorName} ·{" "}
              {booking.teamName ?? "개인"}
              {booking.title ? ` · ${booking.title}` : ""}
            </p>
            <BookingParticipantsSummary booking={booking} />
            {booking.desk && <Badge variant="secondary">좌석</Badge>}
            {status && (
              <Badge
                variant="secondary"
                className={
                  kind === "ongoing"
                    ? "bg-status-mine text-status-mine-foreground"
                    : undefined
                }
              >
                {status}
              </Badge>
            )}
            {booking.attendeeCount != null && (
              <Badge variant="secondary" className="tabular-nums">
                {booking.attendeeCount}명
              </Badge>
            )}
            {isUnfinishedBooking(booking, now) && (
              <div className="flex flex-wrap gap-2">
                {spaceHref && (
                  <Button asChild variant="outline">
                    <Link href={spaceHref}>공간 보기</Link>
                  </Button>
                )}
                <EditBookingLink booking={booking} now={now} />
                {canLeaveBooking(booking, now) ? (
                  <LeaveBookingButton bookingId={booking.id} />
                ) : (
                  booking.relation === "owner" &&
                  booking.canCancel && (
                    <CancelBookingButton
                      bookingId={booking.id}
                      triggerLabel="예약 취소"
                    />
                  )
                )}
              </div>
            )}
            {booking.meetingRoomId && !booking.desk && (
              <BookingChatLink bookingId={booking.id} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function CalendarDayPanelPending() {
  return (
    <div
      aria-busy="true"
      aria-label="날짜 예약을 불러오고 있어요"
      className="space-y-3 rounded-lg border border-border p-3"
    >
      <div className="flex gap-3">
        <Skeleton className="h-12 w-16" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-20" />
        </div>
      </div>
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-5 w-20 rounded-full" />
      <div className="flex gap-2">
        <Skeleton className="h-11 w-24" />
        <Skeleton className="h-11 w-24" />
      </div>
    </div>
  );
}

export function SelectedDayPanel({
  day,
  meta,
  source,
}: {
  day: string | null;
  meta: MyBookingsMonthMeta;
  source: CalendarBookings;
}) {
  const canBook =
    day !== null && day >= meta.today && day <= addDays(meta.today, 60);
  return (
    <section
      aria-label="선택한 날짜 예약"
      className="space-y-4 self-start rounded-xl border border-border bg-card p-5 shadow-card"
    >
      {day === null ? (
        <p className="text-sm text-muted-foreground">날짜를 골라 주세요</p>
      ) : (
        <>
          <div className="space-y-1">
            {(day === meta.today || day === addDays(meta.today, 1)) && (
              <p className="text-xs font-medium text-muted-foreground">
                {day === meta.today ? "오늘" : "내일"}
              </p>
            )}
            <h2 className="text-lg font-semibold tabular-nums">
              {formatBookingDate(day, meta.timezone)}
            </h2>
          </div>
          <CalendarBookingData
            source={source}
            fallback={<CalendarDayPanelPending />}
          >
            {(bookings) => (
              <CalendarBookingCards
                bookings={bookings
                  .filter((booking) => booking.date === day)
                  .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))}
                now={meta.now}
              />
            )}
          </CalendarBookingData>
          {canBook && (
            <Button asChild className="w-full">
              <Link href={`/booking?date=${day}`}>이 날짜에 예약하기</Link>
            </Button>
          )}
        </>
      )}
    </section>
  );
}
