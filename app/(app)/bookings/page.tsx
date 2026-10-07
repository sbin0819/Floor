import { Suspense } from "react";
import { requirePageSession } from "@/lib/auth/session";
import { getMyBookings } from "@/features/bookings/queries";
import { MyBookings } from "@/features/bookings/components/my-bookings";
import { MyBookingsSkeleton } from "@/features/bookings/components/booking-skeletons";

async function BookingsContent() {
  await requirePageSession("/bookings");
  return <MyBookings data={await getMyBookings()} />;
}
export default function BookingsPage() {
  return (
    <Suspense fallback={<MyBookingsSkeleton />}>
      <BookingsContent />
    </Suspense>
  );
}
