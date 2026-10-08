import { ActionError } from "@/lib/actions/result";

export function assertAttendeeCapacity(
  capacity: number | null,
  attendeeCount: number | null | undefined,
) {
  if (capacity !== null && attendeeCount != null && attendeeCount > capacity)
    throw new ActionError("OVER_CAPACITY", { message: "attendee_count" });
}
