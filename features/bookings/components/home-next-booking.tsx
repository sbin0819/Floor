import Link from "next/link";
import { ChevronRight, MessageSquare } from "lucide-react";
import { SpacePhoto } from "@/components/photos/space-photo";
import { StatusLine } from "@/components/status-line";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  formatBookingTime,
  relativeBookingStatus,
} from "@/features/bookings/format";
import { homeBookingStatus } from "@/features/bookings/home-booking-status";
import type { HomeUpcomingBookingsData } from "@/features/bookings/types";
import { addDays, localDate } from "@/lib/time/zoned";
import { CancelBookingButton } from "./cancel-booking-button";
import {
  bookingSpaceHref,
  bookingSpaceLabel,
  bookingPhoto,
  canLeaveBooking,
  isUnfinishedBooking,
} from "@/features/bookings/booking-presentation";
import { deskPartLabels } from "@/features/bookings/desk-parts";
import { BookingTime } from "./booking-time";
import { LeaveBookingButton } from "./leave-booking-button";
import { BookingParticipantsSummary } from "./booking-participants-summary";
import { HomeMiniPlan } from "@/features/floor-plan/components/home-mini-plan";

const linkClass =
  "inline-flex min-h-11 items-center gap-1 rounded-lg text-sm text-primary focus-visible:outline-2 focus-visible:outline-ring hover:underline";
export function HomeNextBooking({ data }: { data: HomeUpcomingBookingsData }) {
  const [booking, next] = data.bookings;
  if (!booking)
    return (
      <section
        aria-label="다음 예약"
        className="space-y-3 rounded-xl border border-border bg-card p-5 shadow-card"
      >
        <h2 className="font-semibold">다음 예약</h2>
        <p className="text-muted-foreground">예약이 아직 없어요</p>
        <Link href="/booking" className={linkClass}>
          공간 예약하기
          <ChevronRight aria-hidden="true" className="size-4" />
        </Link>
      </section>
    );
  const status = homeBookingStatus(booking, data.now);
  const spaceHref = bookingSpaceHref(booking);
  const nextToday = next ? localDate(new Date(data.now), next.timezone) : null;
  return (
    <section
      aria-label="다음 예약"
      className="@container overflow-hidden rounded-xl border border-border bg-card shadow-card"
    >
      <h2 className="px-5 pt-5 font-semibold">다음 예약</h2>
      <div className="flex flex-col gap-5 p-5 has-[[data-cancelling=true]]:opacity-50 md:flex-row md:items-center">
        <div
          className={`flex min-w-0 flex-1 flex-col gap-5 ${booking.plan ? "@min-[880px]:flex-row @min-[880px]:items-center" : "md:flex-row md:items-center"}`}
        >
          <SpacePhoto
            photo={bookingPhoto(booking)}
            type={booking.spaceType}
            size="fill"
            eager
            className={`h-[150px] w-full shrink-0 rounded-lg ${booking.plan ? "@min-[880px]:w-[232px]" : "md:w-[232px]"}`}
            sizes="(max-width: 767px) calc(100vw - 72px), 232px"
            decorative
          />
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <StatusLine kind={status.kind}>{status.label}</StatusLine>
              {status.remaining && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {status.remaining}
                </span>
              )}
            </div>
            <p className="text-[28px] leading-tight font-bold tabular-nums">
              <BookingTime booking={booking} />
            </p>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <h3 className="font-semibold">{bookingSpaceLabel(booking)}</h3>
              {booking.desk && <Badge variant="secondary">좌석</Badge>}
              {booking.attendeeCount != null && (
                <Badge variant="secondary" className="tabular-nums">
                  {booking.attendeeCount}명
                </Badge>
              )}
              <p className="text-sm text-muted-foreground">
                {booking.branchName} {booking.floorName} ·{" "}
                {booking.teamName ?? "개인"}
                {booking.title && ` · ${booking.title}`}
              </p>
            </div>
            <BookingParticipantsSummary booking={booking} />
            <div className="flex flex-wrap items-center gap-2">
              {!booking.desk && (
                <Button asChild variant="outline">
                  <Link href={`/m/${booking.id}`}>
                    <MessageSquare aria-hidden="true" className="size-4" />
                    채팅
                  </Link>
                </Button>
              )}
              {spaceHref && (
                <Button asChild variant="outline">
                  <Link href={spaceHref}>일정 보기</Link>
                </Button>
              )}
              {canLeaveBooking(booking, data.now) ? (
                <LeaveBookingButton bookingId={booking.id} />
              ) : (
                booking.relation === "owner" &&
                booking.canCancel &&
                isUnfinishedBooking(booking, data.now) && (
                  <CancelBookingButton
                    bookingId={booking.id}
                    triggerLabel="예약 취소"
                  />
                )
              )}
            </div>
          </div>
        </div>
        {booking.relation === "owner" && booking.plan && (
          <HomeMiniPlan
            planId={booking.plan.id}
            spaceId={booking.spaceId}
            seatId={booking.desk?.id}
          />
        )}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border px-5 py-2">
        {next ? (
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums">
            <span className="text-muted-foreground">다음</span>
            <strong>
              {next.date === nextToday
                ? "오늘"
                : next.date === addDays(nextToday!, 1)
                  ? "내일"
                  : next.date}{" "}
              {formatBookingTime(next.start, next.end, next.timezone)}
              {next.desk?.part && ` · ${deskPartLabels[next.desk.part]}`}
            </strong>
            <span className="text-muted-foreground">
              {bookingSpaceLabel(next)} · {next.branchName} {next.floorName}
            </span>
            <BookingParticipantsSummary booking={next} />
            {relativeBookingStatus(next.start, next.end, data.now) && (
              <span className="rounded-md bg-muted px-2 py-1">
                {relativeBookingStatus(next.start, next.end, data.now)}
              </span>
            )}
          </div>
        ) : (
          <span />
        )}
        <Link href="/bookings" className={linkClass}>
          내 예약 모두 보기
          <ChevronRight aria-hidden="true" className="size-4" />
        </Link>
      </footer>
    </section>
  );
}
