import type {
  FloorDayData,
  FloorVisibleSpace,
} from "@/features/bookings/types";
import { floorDayFixture } from "./booking-ui-fixtures";

export const at = (hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 9, 7, hour - 9, minute)).toISOString();
export function timetableFixture(): FloorDayData {
  const data = floorDayFixture();
  const base = data.spaces.find(
    (space): space is FloorVisibleSpace => space.kind === "accessible",
  )!;
  data.spaces = [
    { ...base, id: "b", name: "회의실 B", intervals: [] },
    { kind: "restricted", id: "hidden", type: "meeting_room" },
    {
      ...base,
      id: "a",
      name: "회의실 A",
      intervals: [{ start: at(11), end: at(12), kind: "other" }],
    },
    {
      ...base,
      id: "lounge",
      name: "라운지",
      type: "lounge",
      bookable: false,
      intervals: [],
    },
    {
      ...base,
      id: "desk",
      name: "데스크 구역",
      type: "desk_area",
      bookable: false,
      deskCount: 12,
      intervals: [],
    },
  ];
  data.groups = [
    { type: "meeting_room", totalCount: 3, freeCount: 2 },
    { type: "desk_area", totalCount: 1, freeCount: null },
    { type: "lounge", totalCount: 1, freeCount: null },
  ];
  return data;
}
