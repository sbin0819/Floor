import type { FloorDayData, SpaceDayData } from "@/features/bookings/types";
import { getOperatingState } from "@/features/bookings/operating-state";

export function spaceDayFixture(): SpaceDayData {
  return {
    branch: {
      id: "branch",
      name: "가상 지점",
      address: "가상 주소",
      timezone: "Asia/Seoul",
      openHours: { wed: { open: "09:00", close: "14:00" } },
      cover: null,
    },
    floor: { id: "floor", name: "7F", level: 7, sortOrder: 1 },
    space: {
      kind: "accessible",
      id: "space",
      name: "회의실 C",
      type: "meeting_room",
      capacity: 6,
      amenities: ["monitor"],
      bookable: true,
      deskCount: 0,
      bookingCount: 1,
      status: "free",
      photo: null,
    },
    date: "2026-10-07",
    photos: [],
    now: "2026-10-07T01:10:00.000Z",
    openHours: { open: "09:00", close: "14:00" },
    bookings: [
      {
        id: "booking",
        start: "2026-10-07T02:00:00.000Z",
        end: "2026-10-07T03:00:00.000Z",
        bookerName: "가상 팀",
        isMine: false,
        canCancel: false,
      },
    ],
    blocks: [
      {
        id: "block",
        start: "2026-10-07T04:00:00.000Z",
        end: "2026-10-07T04:30:00.000Z",
        reason: "시설 점검",
      },
    ],
    actors: [
      {
        teamId: null,
        name: "개인으로",
        limits: {
          maxMinutesPerBooking: 120,
          maxMinutesPerDay: 120,
          maxDaysAhead: 7,
        },
        remainingMinutes: 60,
      },
    ],
    hasTeams: false,
  };
}

export function floorDayFixture(): FloorDayData {
  const data = spaceDayFixture();
  return {
    branch: data.branch,
    floor: data.floor,
    floors: [data.floor],
    date: data.date,
    isToday: true,
    openHours: data.openHours,
    now: data.now,
    operatingState: getOperatingState(
      new Date(data.now),
      data.branch.timezone,
      data.branch.openHours,
    ),
    groups: [{ type: "meeting_room", totalCount: 2, freeCount: 1 }],
    spaces: [
      {
        ...data.space,
        intervals: [],
        summary: { status: "free", until: data.bookings[0]!.start },
      },
      { kind: "restricted", id: "restricted", type: "meeting_room" },
    ],
  };
}
