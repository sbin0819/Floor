import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  floorHref,
  formatBookingDate,
  formatBookingTime,
} from "@/features/bookings/format";
import type { MyBooking, MyBookingsData } from "@/features/bookings/types";
import { CancelBookingButton } from "./cancel-booking-button";

function BookingList({
  bookings,
  upcoming,
}: {
  bookings: MyBooking[];
  upcoming: boolean;
}) {
  if (!bookings.length)
    return <p className="text-sm text-muted-foreground">예약이 아직 없어요</p>;
  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-card">
      {bookings.map((booking) => (
        <li
          key={booking.id}
          className="flex flex-wrap items-center justify-between gap-4 p-5"
        >
          <div className="space-y-2">
            <p className="text-sm tabular-nums">
              {formatBookingDate(booking.date, booking.timezone)} ·{" "}
              {formatBookingTime(booking.start, booking.end, booking.timezone)}
            </p>
            <p className="font-medium">
              {booking.branchName} · {booking.floorName} ·{" "}
              {upcoming ? (
                <Link
                  className="inline-flex min-h-11 items-center underline underline-offset-4"
                  href={floorHref(
                    booking.branchId,
                    booking.floorId,
                    booking.date,
                    booking.spaceId,
                  )}
                >
                  {booking.spaceName}
                </Link>
              ) : (
                booking.spaceName
              )}
            </p>
            <p className="text-sm text-muted-foreground">
              {booking.teamName ?? "개인"}
              {booking.title && ` · ${booking.title}`}
            </p>
            <Badge variant="secondary">
              {booking.status === "cancelled"
                ? "취소됨"
                : upcoming
                  ? "예약 확정"
                  : "이용 종료"}
            </Badge>
          </div>
          {upcoming && <CancelBookingButton bookingId={booking.id} />}
        </li>
      ))}
    </ul>
  );
}
export function MyBookings({ data }: { data: MyBookingsData }) {
  return (
    <main className="mx-auto max-w-5xl space-y-8 px-6 py-8">
      <h1 className="text-2xl font-semibold">내 예약</h1>
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">다가오는 예약</h2>
        <BookingList bookings={data.upcoming} upcoming />
      </section>
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">지난 예약</h2>
        <BookingList bookings={data.past} upcoming={false} />
      </section>
    </main>
  );
}
