import Link from "next/link";
import { Button } from "@/components/ui/button";
import { canEditBooking } from "@/features/bookings/booking-presentation";
import type { MyBooking } from "@/features/bookings/types";

export function EditBookingLink({
  booking,
  now,
}: {
  booking: MyBooking;
  now: string;
}) {
  if (!canEditBooking(booking, now)) return null;
  return (
    <Button asChild variant="outline">
      <Link
        href={`/bookings/${booking.id}/edit`}
        aria-label={`${booking.spaceName} 예약 바꾸기`}
      >
        바꾸기
      </Link>
    </Button>
  );
}
