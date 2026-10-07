import Link from "next/link";
import { BookingChip } from "@/components/booking-chip";
import { SpacePhoto } from "@/components/photos/space-photo";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { bookingChipKind } from "@/features/bookings/booking-chip-state";
import { floorHref } from "@/features/bookings/format";
import type {
  HomeFrequentSpacesData,
  HomeWeekBookingsData,
} from "@/features/bookings/types";
import { getOpenHours } from "@/lib/time/open-hours";
import { localTime, weekday } from "@/lib/time/zoned";

const dayLabels = {
  sun: "일",
  mon: "월",
  tue: "화",
  wed: "수",
  thu: "목",
  fri: "금",
  sat: "토",
};

export function HomeWeekBookings({ data }: { data: HomeWeekBookingsData }) {
  return (
    <section aria-label="이번 주 내 예약">
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">이번 주 내 예약</h2>
          <Link
            href="/bookings?view=calendar"
            className="inline-flex min-h-11 items-center rounded-lg text-xs text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            달력으로 보기
          </Link>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1">
            {data.days.map(({ date, bookings }) => (
              <li
                key={date}
                className={`flex min-h-11 items-start gap-3 rounded-lg px-2 py-2 ${date === data.today ? "bg-accent" : ""}`}
              >
                <time
                  dateTime={date}
                  className="w-16 shrink-0 pt-1 text-xs tabular-nums"
                >
                  <span className="sr-only">{date.slice(0, 4)}년 </span>
                  {Number(date.slice(5, 7))}/{Number(date.slice(8, 10))}{" "}
                  <span
                    className={
                      date === data.today
                        ? "font-semibold text-primary"
                        : "text-muted-foreground"
                    }
                  >
                    {date === data.today ? "오늘" : dayLabels[weekday(date)]}
                  </span>
                </time>
                <div className="min-w-0 flex-1 space-y-1">
                  {bookings.length ? (
                    bookings.map((booking) => (
                      <Link
                        key={booking.id}
                        href={floorHref(
                          booking.branchId,
                          booking.floorId,
                          booking.date,
                          booking.spaceId,
                        )}
                        className="flex min-h-11 items-center rounded-md focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        <BookingChip
                          kind={bookingChipKind(booking, data.now)}
                          className="w-full"
                        >
                          {localTime(new Date(booking.start), booking.timezone)}{" "}
                          {booking.spaceName}
                        </BookingChip>
                      </Link>
                    ))
                  ) : (
                    <p className="py-1 text-xs text-muted-foreground">
                      {data.openHours &&
                      getOpenHours(data.openHours, date) === null
                        ? "쉬는 날"
                        : "예약 없음"}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}

export function HomeFrequentSpaces({ data }: { data: HomeFrequentSpacesData }) {
  if (!data.spaces.length) return null;
  return (
    <section aria-label="자주 쓰는 공간">
      <Card>
        <CardHeader className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">자주 쓰는 공간</h2>
          <span className="text-xs text-muted-foreground">최근 30일</span>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-3 sm:grid-cols-3">
            {data.spaces.map((space) => (
              <li key={space.id}>
                <Link
                  href={floorHref(
                    space.branchId,
                    space.floorId,
                    space.date,
                    space.id,
                  )}
                  className="block overflow-hidden rounded-lg border border-border hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <SpacePhoto
                    photo={space.photo}
                    type={space.type}
                    size="fill"
                    className="aspect-[4/3] w-full rounded-none"
                    sizes="(min-width: 1280px) 230px, (min-width: 1024px) 18vw, (min-width: 640px) 28vw, calc(100vw - 72px)"
                    decorative
                  />
                  <div className="space-y-1 p-3">
                    <h3 className="truncate text-sm font-semibold">
                      {space.name}
                    </h3>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {space.branchName} {space.floorName} ·{" "}
                      {space.bookingCount}번 예약
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}
