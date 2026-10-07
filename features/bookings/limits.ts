import { defaultLimits } from "@/lib/permissions/defaults";
import type { PermissionContext, RoleLimits } from "@/lib/permissions/types";

export type BookingLimitRole = "user" | "team_member" | "operator";
export type BookingLimitReason = "per_booking" | "days_ahead" | "per_day";

export function bookingLimitRole(
  context: PermissionContext,
  branchId: string,
  teamId: string | null,
): BookingLimitRole {
  if (teamId !== null) return "team_member";
  return context.staffBranchIds.includes(branchId) ? "operator" : "user";
}

export function resolveBookingLimits(
  role: BookingLimitRole,
  overrides: Partial<RoleLimits> = {},
): RoleLimits {
  const defaults = defaultLimits[role];
  return {
    maxMinutesPerBooking:
      overrides.maxMinutesPerBooking === undefined
        ? defaults.maxMinutesPerBooking
        : overrides.maxMinutesPerBooking,
    maxMinutesPerDay:
      overrides.maxMinutesPerDay === undefined
        ? defaults.maxMinutesPerDay
        : overrides.maxMinutesPerDay,
    maxDaysAhead:
      overrides.maxDaysAhead === undefined
        ? defaults.maxDaysAhead
        : overrides.maxDaysAhead,
  };
}

export function checkBookingLimits({
  limits,
  durationMinutes,
  usedMinutes,
  daysAhead,
}: {
  limits: RoleLimits;
  durationMinutes: number;
  usedMinutes: number;
  daysAhead: number;
}): BookingLimitReason | null {
  if (
    limits.maxMinutesPerBooking !== null &&
    durationMinutes > limits.maxMinutesPerBooking
  )
    return "per_booking";
  if (limits.maxDaysAhead !== null && daysAhead > limits.maxDaysAhead)
    return "days_ahead";
  if (
    limits.maxMinutesPerDay !== null &&
    usedMinutes + durationMinutes > limits.maxMinutesPerDay
  )
    return "per_day";
  return null;
}

export function remainingDailyMinutes(
  limits: RoleLimits,
  usedMinutes: number,
): number | null {
  return limits.maxMinutesPerDay === null
    ? null
    : Math.max(0, limits.maxMinutesPerDay - usedMinutes);
}
