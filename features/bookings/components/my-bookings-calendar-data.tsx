"use client";

import { Suspense, use, type ReactNode } from "react";
import type { MyCalendarBooking } from "@/features/bookings/types";

export type CalendarBookings =
  MyCalendarBooking[] | Promise<MyCalendarBooking[]> | null;

function ResolvedBookings({
  source,
  children,
}: {
  source: Exclude<CalendarBookings, null>;
  children: (bookings: MyCalendarBooking[]) => ReactNode;
}) {
  const bookings = Array.isArray(source) ? source : use(source);
  return children(bookings);
}

export function CalendarBookingData({
  source,
  fallback,
  children,
}: {
  source: CalendarBookings;
  fallback: ReactNode;
  children: (bookings: MyCalendarBooking[]) => ReactNode;
}) {
  if (source === null) return fallback;
  return (
    <Suspense fallback={fallback}>
      <ResolvedBookings source={source}>{children}</ResolvedBookings>
    </Suspense>
  );
}
