import { Suspense } from "react";
import { requirePageSession } from "@/lib/auth/session";
import { getMyBookings } from "@/features/bookings/queries";
import { MyBookings } from "@/features/bookings/components/my-bookings";

async function BookingsContent() {
  await requirePageSession("/bookings");
  return <MyBookings data={await getMyBookings()} />;
}
export default function BookingsPage() {
  return (
    <Suspense
      fallback={
        <p role="status" className="p-6 text-muted-foreground">
          예약을 불러오고 있어요.
        </p>
      }
    >
      <BookingsContent />
    </Suspense>
  );
}
