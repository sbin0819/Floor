"use server";

import { createUpdateBookingAction } from "./update-booking-factory";

export async function updateBooking(input: unknown) {
  return createUpdateBookingAction()(input);
}
