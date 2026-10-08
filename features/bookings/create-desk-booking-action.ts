"use server";

import { createDeskBookingAction } from "@/features/bookings/create-desk-booking-factory";

export async function createDeskBooking(input: unknown) {
  return createDeskBookingAction()(input);
}
