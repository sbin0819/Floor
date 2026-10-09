"use server";

import { createCancelBookingAsOperator } from "./booking-action-factory";

export async function cancelBookingAsOperator(input: unknown) {
  return createCancelBookingAsOperator()(input);
}
