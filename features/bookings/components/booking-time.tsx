import { deskPartLabels } from "@/features/bookings/desk-parts";
import { formatBookingTime } from "@/features/bookings/format";
import type { MyBooking } from "@/features/bookings/types";

export function BookingTime({
  booking,
}: {
  booking: Pick<MyBooking, "start" | "end" | "timezone" | "desk">;
}) {
  const time = formatBookingTime(booking.start, booking.end, booking.timezone);
  return booking.desk?.part ? (
    <>
      <span className="block">{deskPartLabels[booking.desk.part]}</span>
      <span className="block text-sm font-normal text-muted-foreground">
        {time}
      </span>
    </>
  ) : (
    time
  );
}
