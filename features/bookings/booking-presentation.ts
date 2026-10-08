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
    "branchId" | "floorId" | "date" | "spaceId" | "desk" | "relation"
  >,
): string | null {
  if (booking.relation !== "owner") return null;
  return floorHref(
    booking.branchId,
    booking.floorId,
    booking.date,
    booking.spaceId,
    undefined,
    Boolean(booking.desk),
  );
}

export function bookingPhoto(booking: Pick<MyBooking, "relation" | "photo">) {
  return booking.relation === "owner" ? booking.photo : null;
}

export function participantSummary(names: readonly string[]): string | null {
  if (!names.length) return null;
  return `참석자 ${names[0]}${names.length > 1 ? ` 외 ${names.length - 1}명` : ""}`;
}

export function isUnfinishedBooking(
  booking: Pick<MyBooking, "status" | "end">,
  now: string,
): boolean {
  return (
    booking.status === "confirmed" && Date.parse(booking.end) > Date.parse(now)
  );
}

export function canLeaveBooking(
  booking: Pick<MyBooking, "relation" | "status" | "end">,
  now: string,
): boolean {
  return booking.relation === "invited" && isUnfinishedBooking(booking, now);
}

export function canEditBooking(
  booking: Pick<
    MyBooking,
    "relation" | "status" | "end" | "desk" | "spaceType"
  >,
  now: string,
): boolean {
  return (
    booking.relation === "owner" &&
    !booking.desk &&
    booking.spaceType !== "desk" &&
    isUnfinishedBooking(booking, now)
  );
}
