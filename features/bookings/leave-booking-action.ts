"use server";

import { createLeaveBookingAction } from "./leave-booking-factory";

export async function leaveBooking(input: unknown) {
  return createLeaveBookingAction()(input);
}
