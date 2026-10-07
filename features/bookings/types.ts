import type { DayOpenHours, OpenHours } from "@/lib/time/open-hours";
import type { RoleLimits } from "@/lib/permissions/types";

export type SpaceType =
  "meeting_room" | "seminar" | "phone_booth" | "desk_area" | "desk" | "lounge";
export type SpaceStatus =
  "restricted" | "maintenance" | "busy" | "mine" | "free";
export type BranchDetails = {
  id: string;
  name: string;
  address: string | null;
  timezone: string;
  openHours: OpenHours;
};
export type FloorSummary = {
  id: string;
  name: string;
  level: number;
  sortOrder: number;
};
export type BranchListItem = BranchDetails & {
  isDefault: boolean;
  todayHours: DayOpenHours | null;
};
export type BranchFloorsData = {
  branch: BranchDetails;
  floors: FloorSummary[];
};
export type BranchNavigationData = BranchFloorsData & {
  branches: { id: string; name: string }[];
  today: string;
  now: string;
};
export type VisibleSpace = {
  kind: "accessible";
  id: string;
  type: SpaceType;
  name: string;
  capacity: number | null;
  amenities: string[];
  bookable: boolean;
  deskCount: number;
  bookingCount: number;
  status: SpaceStatus | null;
};
export type RestrictedSpace = {
  kind: "restricted";
  id: string;
  type: SpaceType;
};
export type FloorDayData = BranchFloorsData & {
  floor: FloorSummary;
  date: string;
  isToday: boolean;
  openHours: DayOpenHours | null;
  spaces: (VisibleSpace | RestrictedSpace)[];
};
export type DayBooking = {
  id: string;
  start: string;
  end: string;
  bookerName: string;
  isMine: boolean;
  canCancel: boolean;
  title?: string | null;
};
export type BookingActor = {
  teamId: string | null;
  name: string;
  limits: RoleLimits;
  remainingMinutes: number | null;
};
export type SpaceDayData = {
  space: VisibleSpace;
  branch: BranchDetails;
  floor: FloorSummary;
  date: string;
  now: string;
  openHours: DayOpenHours | null;
  bookings: DayBooking[];
  blocks: { id: string; start: string; end: string; reason: string | null }[];
  actors: BookingActor[];
  hasTeams: boolean;
};
export type MyBooking = {
  id: string;
  start: string;
  end: string;
  date: string;
  timezone: string;
  title: string | null;
  teamName: string | null;
  status: "confirmed" | "cancelled";
  cancelledAt: string | null;
  branchId: string;
  branchName: string;
  floorId: string;
  floorName: string;
  spaceId: string;
  spaceName: string;
};
export type MyBookingsData = { upcoming: MyBooking[]; past: MyBooking[] };
