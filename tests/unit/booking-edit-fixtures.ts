import type { BookingForEditData } from "@/features/bookings/types";
import { spaceDayFixture } from "./booking-ui-fixtures";

export function bookingEditFixture(): BookingForEditData {
  const data = spaceDayFixture();
  return {
    booking: {
      id: "edit-booking",
      start: "2026-10-07T01:00:00.000Z",
      end: "2026-10-07T02:00:00.000Z",
      title: "디자인 회의",
      attendeeCount: 3,
      started: false,
    },
    participants: [
      {
        userId: "existing",
        name: "이서연",
        avatar: { color: "blue" as const, photoUrl: null },
        sharedTeamNames: [],
        maskedEmail: "se•••@floor.example",
      },
    ],
    actor: data.actors[0]!,
    space: data.space,
    branch: data.branch,
    floor: data.floor,
    date: data.date,
    now: "2026-10-07T00:00:00.000Z",
    openHours: data.openHours,
    bookings: [],
    blocks: [],
  };
}
