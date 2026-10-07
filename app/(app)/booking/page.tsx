import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requirePageSession } from "@/lib/auth/session";
import { getBookingDestination } from "@/features/bookings/queries";
import { FloorPageSkeleton } from "@/features/bookings/components/booking-skeletons";

async function BookingContent() {
  await requirePageSession("/booking");
  return redirect(await getBookingDestination());
}
export default function BookingPage() {
  return (
    <Suspense fallback={<FloorPageSkeleton />}>
      <BookingContent />
    </Suspense>
  );
}
