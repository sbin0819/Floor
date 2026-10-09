import planFile from "@/docs/spec/examples/gangnam-7f.plan.json";
import spaceFile from "@/docs/spec/examples/gangnam-7f.spaces.json";
import { floorPlanSchema } from "@/lib/floor-plan/schema";
import { getOperatingState } from "@/features/bookings/operating-state";
import type { AvailabilityInterval } from "@/features/bookings/availability";
import type {
  FloorDayData,
  FloorVisibleSpace,
  SpaceType,
} from "@/features/bookings/types";

export const floorPlanStoryDocument = floorPlanSchema.parse(planFile);
export const floorPlanStoryDate = "2026-10-14";
export const floorPlanStoryNow = "2026-10-14T11:30:00+09:00";
export const floorPlanStorySpaceIds = {
  meetingA: "400527fa-3c66-5cd4-a627-bf65ffb0dee2",
  meetingB: "bf9a611a-92eb-5825-9188-5ef9b191ca91",
  meetingC: "0495a219-c757-56ae-abda-4e212be70e5c",
  meetingD: "62719efa-1f4a-5896-85ab-1dc1e1bbcfb8",
} as const;

function spaceType(type: string): SpaceType {
  if (
    type === "meeting_room" ||
    type === "seminar" ||
    type === "phone_booth" ||
    type === "desk_area" ||
    type === "desk" ||
    type === "lounge"
  )
    return type;
  throw new Error("Unknown floor-plan story space type.");
}
function interval(
  start: string,
  end: string,
  kind: AvailabilityInterval["kind"],
): AvailabilityInterval {
  return {
    start: `${floorPlanStoryDate}T${start}:00+09:00`,
    end: `${floorPlanStoryDate}T${end}:00+09:00`,
    kind,
  };
}
function storyIntervals(
  name: string,
  maintenance: boolean,
): AvailabilityInterval[] {
  if (name === "회의실 B") return [interval("14:00", "15:00", "other")];
  if (name === "회의실 C") return [interval("10:30", "12:30", "other")];
  if (name === "폰부스 2") return [interval("11:00", "12:00", "mine")];
  if (name === "세미나룸") return [interval("09:00", "13:00", "other")];
  if (name === "회의실 D" && maintenance)
    return [interval("08:00", "22:00", "maintenance")];
  return [];
}

// 실제 시드의 도형·공간 식별자만 재사용하며 예약·권한·시각은 독립된 가짜 값이다.
export function createFloorPlanStoryData({
  maintenanceRestricted = false,
  holiday = false,
}: {
  maintenanceRestricted?: boolean;
  holiday?: boolean;
} = {}): FloorDayData {
  const hours = { open: "08:00", close: "22:00" };
  const branch: FloorDayData["branch"] = {
    ...spaceFile.branch,
    address: "실제 주소가 아닌 Storybook 예제예요",
    cover: null,
    openHours: holiday ? { wed: null } : { wed: hours },
  };
  const floor: FloorDayData["floor"] = {
    id: spaceFile.floor.id,
    name: spaceFile.floor.name,
    level: spaceFile.floor.level,
    sortOrder: 0,
    plan: { id: "a0000000-0000-4000-8000-000000000001", version: 1 },
  };
  const spaces: FloorDayData["spaces"] = spaceFile.spaces
    .filter(({ type }) => type !== "desk")
    .map((row) => {
      const type = spaceType(row.type);
      if (maintenanceRestricted && row.id === floorPlanStorySpaceIds.meetingA)
        return { kind: "restricted", id: row.id, type };
      const intervals = holiday
        ? []
        : storyIntervals(row.name, maintenanceRestricted);
      const space: FloorVisibleSpace = {
        kind: "accessible",
        id: row.id,
        name: row.name,
        type,
        capacity: row.capacity,
        amenities: type === "meeting_room" ? ["monitor", "whiteboard"] : [],
        bookable: row.bookable,
        photo: null,
        deskCount:
          type === "desk_area"
            ? spaceFile.spaces.filter(({ parentId }) => parentId === row.id)
                .length
            : 0,
        bookingCount: intervals.filter(({ kind }) => kind !== "maintenance")
          .length,
        status: row.bookable && !holiday ? "free" : null,
        summary: null,
        intervals,
      };
      if (type === "desk_area" && !holiday)
        space.deskParts = [
          {
            part: "am",
            start: `${floorPlanStoryDate}T08:00:00+09:00`,
            end: `${floorPlanStoryDate}T13:00:00+09:00`,
            selectable: true,
            freeCount: 17,
            myDeskName: null,
          },
          {
            part: "pm",
            start: `${floorPlanStoryDate}T13:00:00+09:00`,
            end: `${floorPlanStoryDate}T22:00:00+09:00`,
            selectable: true,
            freeCount: 19,
            myDeskName: null,
          },
        ];
      return space;
    });
  return {
    branch,
    floor,
    floors: [floor],
    spaces,
    groups: [],
    date: floorPlanStoryDate,
    isToday: true,
    now: floorPlanStoryNow,
    openHours: holiday ? null : hours,
    operatingState: getOperatingState(
      new Date(floorPlanStoryNow),
      branch.timezone,
      branch.openHours,
    ),
  };
}
