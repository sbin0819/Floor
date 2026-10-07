"use server";

import { createCancelBookingAction } from "@/features/bookings/cancel-booking-factory";

export async function cancelBooking(input: unknown) {
  return createCancelBookingAction()(input);
}
