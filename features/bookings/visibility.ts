import { can } from "@/lib/permissions/can";
import type { PermissionContext } from "@/lib/permissions/types";

type BookingOwner = { userId: string; teamId: string | null };
export function canSeeBookingTitle(
  context: PermissionContext,
  booking: BookingOwner,
  branchId: string,
) {
  return (
    booking.userId === context.userId ||
    context.staffBranchIds.includes(branchId) ||
    (booking.teamId !== null &&
      context.teams.some(({ teamId }) => teamId === booking.teamId))
  );
}
export function canCancelBooking(
  context: PermissionContext,
  booking: BookingOwner,
  branchId: string,
) {
  if (booking.userId === context.userId) return true;
  if (
    context.staffBranchIds.includes(branchId) &&
    can(context, "booking.manage_all", { branchId })
  )
    return true;
  return (
    booking.teamId !== null &&
    context.teams.some(
      ({ teamId, role }) => teamId === booking.teamId && role === "admin",
    ) &&
    can(context, "booking.manage_team", { branchId, teamId: booking.teamId })
  );
}
