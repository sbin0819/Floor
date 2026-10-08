import { floorHref } from "./format";
import type { MyBooking } from "./types";

export function bookingSpaceLabel(
  booking: Pick<MyBooking, "spaceName" | "desk">,
): string {
  return booking.desk
    ? `${booking.spaceName} · ${booking.desk.name}`
    : booking.spaceName;
}

export function bookingSpaceHref(
  booking: Pick<
    MyBooking,
    "branchId" | "floorId" | "date" | "spaceId" | "desk"
  >,
): string {
  return floorHref(
    booking.branchId,
    booking.floorId,
    booking.date,
    booking.spaceId,
    undefined,
    Boolean(booking.desk),
  );
}
