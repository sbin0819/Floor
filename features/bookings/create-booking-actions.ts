"use server";

import { createBookingActions } from "@/features/bookings/create-booking-factory";

export async function createBooking(input: unknown) {
  return createBookingActions().createBooking(input);
}
export async function setDefaultBranch(input: unknown) {
  return createBookingActions().setDefaultBranch(input);
}
