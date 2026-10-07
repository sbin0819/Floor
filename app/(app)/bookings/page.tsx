import { Suspense } from "react";
import { requirePageSession } from "@/lib/auth/session";
import { getMyBookings } from "@/features/bookings/queries";
import { MyBookings } from "@/features/bookings/components/my-bookings";
import { MyBookingsSkeleton } from "@/features/bookings/components/booking-skeletons";

type Props = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};
async function BookingsContent({ searchParams }: Props) {
  const query = await searchParams;
  const tab = query?.tab === "past" ? "past" : "upcoming";
  await requirePageSession(tab === "past" ? "/bookings?tab=past" : "/bookings");
  return <MyBookings data={await getMyBookings()} tab={tab} />;
}
export default function BookingsPage(props: Props = {}) {
  return (
    <Suspense fallback={<MyBookingsSkeleton />}>
      <BookingsContent {...props} />
    </Suspense>
  );
}
