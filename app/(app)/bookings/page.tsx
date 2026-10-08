import { Suspense } from "react";
import { requirePageSession } from "@/lib/auth/session";
import {
  getMyBookings,
  getMyBookingsMonthStream,
} from "@/features/bookings/queries";
import { MyBookings } from "@/features/bookings/components/my-bookings";
import { StreamingMyBookingsCalendar } from "@/features/bookings/components/my-bookings-calendar";
import { MyBookingsCalendarSkeleton } from "@/features/bookings/components/my-bookings-calendar-skeleton";
import { MyBookingsSkeleton } from "@/features/bookings/components/booking-skeletons";
import { BookingMeetingRegion } from "@/features/bookings/components/booking-meeting-region";
import { bookingPageHref } from "@/features/bookings/meeting-navigation";

type Props = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};
async function BookingsContent({ searchParams }: Props) {
  const query = await searchParams;
  if (query?.view === "calendar") {
    return (
      <Suspense fallback={<MyBookingsCalendarSkeleton />}>
        <CalendarContent
          month={query.month}
          day={query.day}
          next={bookingPageHref(query)}
        />
      </Suspense>
    );
  }
  const tab = query?.tab === "past" ? "past" : "upcoming";
  await requirePageSession(bookingPageHref(query));
  return <MyBookings data={await getMyBookings()} tab={tab} />;
}
async function CalendarContent({
  month,
  day,
  next,
}: {
  month: unknown;
  day: unknown;
  next: string;
}) {
  await requirePageSession(next);
  return (
    <StreamingMyBookingsCalendar
      {...await getMyBookingsMonthStream({ month, day })}
    />
  );
}
export default function BookingsPage(props: Props = {}) {
  return (
    <>
      <Suspense fallback={<MyBookingsSkeleton />}>
        <BookingsContent {...props} />
      </Suspense>
      <Suspense fallback={null}>
        <BookingMeetingRegion {...props} />
      </Suspense>
    </>
  );
}
