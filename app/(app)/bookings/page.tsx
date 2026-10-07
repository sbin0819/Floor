import { Suspense } from "react";
import { requirePageSession } from "@/lib/auth/session";
import { getMyBookings, getMyBookingsMonth } from "@/features/bookings/queries";
import { MyBookings } from "@/features/bookings/components/my-bookings";
import { MyBookingsCalendar } from "@/features/bookings/components/my-bookings-calendar";
import { MyBookingsCalendarSkeleton } from "@/features/bookings/components/my-bookings-calendar-skeleton";
import { MyBookingsSkeleton } from "@/features/bookings/components/booking-skeletons";

type Props = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};
async function BookingsContent({ searchParams }: Props) {
  const query = await searchParams;
  if (query?.view === "calendar") {
    const next = new URLSearchParams({ view: "calendar" });
    for (const key of ["month", "day"] as const)
      if (typeof query[key] === "string") next.set(key, query[key]);
    await requirePageSession(`/bookings?${next}`);
    return (
      <Suspense fallback={<MyBookingsCalendarSkeleton />}>
        <CalendarContent month={query.month} day={query.day} />
      </Suspense>
    );
  }
  const tab = query?.tab === "past" ? "past" : "upcoming";
  await requirePageSession(tab === "past" ? "/bookings?tab=past" : "/bookings");
  return <MyBookings data={await getMyBookings()} tab={tab} />;
}
async function CalendarContent({
  month,
  day,
}: {
  month: unknown;
  day: unknown;
}) {
  return <MyBookingsCalendar data={await getMyBookingsMonth({ month, day })} />;
}
export default function BookingsPage(props: Props = {}) {
  return (
    <Suspense fallback={<MyBookingsSkeleton />}>
      <BookingsContent {...props} />
    </Suspense>
  );
}
