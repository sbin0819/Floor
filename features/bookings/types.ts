import type { DayOpenHours, OpenHours } from "@/lib/time/open-hours";
import type { RoleLimits } from "@/lib/permissions/types";
import type {
  AvailabilityInterval,
  AvailabilitySummary,
} from "@/features/bookings/availability";
import type { OperatingState } from "@/features/bookings/operating-state";
import type { Photo } from "@/lib/photos/schema";

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
  cover: Photo | null;
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
  accessibleFloorCount: number;
  bookableSpaceCount: number;
  freeSpaceCount: number | null;
  operatingState: OperatingState;
};
export type BranchFloorsData = {
  branch: BranchDetails;
  floors: FloorSummary[];
};
export type BranchNavigationData = BranchFloorsData & {
  branches: { id: string; name: string }[];
  bookingDates: string[];
  today: string;
  now: string;
};
export type VisibleSpace = {
  kind: "accessible";
  id: string;
  type: SpaceType;
  name: string;
  capacity: number | null;
  photo: Photo | null;
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
export type FloorVisibleSpace = VisibleSpace & {
  intervals: AvailabilityInterval[];
  summary: AvailabilitySummary | null;
};
export type FloorDayData = BranchFloorsData & {
  floor: FloorSummary;
  date: string;
  isToday: boolean;
  openHours: DayOpenHours | null;
  now: string;
  operatingState: OperatingState;
  groups: { type: SpaceType; totalCount: number; freeCount: number | null }[];
  spaces: (FloorVisibleSpace | RestrictedSpace)[];
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
  photos: Photo[];
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
  spaceType: SpaceType;
  photo: Photo | null;
};
export type MyBookingsData = {
  now: string;
  upcoming: MyBooking[];
  past: MyBooking[];
};

export type HomeHeaderData = {
  name: string;
  now: string;
  date: string;
  branch: BranchDetails | null;
  operatingState: OperatingState | null;
};
export type HomeUpcomingBookingsData = { now: string; bookings: MyBooking[] };
export type HomeFreeSpace = {
  id: string;
  name: string;
  type: SpaceType;
  capacity: number | null;
  photo: Photo | null;
  amenities: string[];
  floor: FloorSummary;
  intervals: AvailabilityInterval[];
  freeUntil: string;
};
export type HomeFreeSpacesData = {
  state: "no_branch" | "no_floors" | "outside_hours" | "ready";
  branch: BranchDetails | null;
  now: string;
  date: string;
  operatingState: OperatingState | null;
  totalCount: number;
  freeCount: number;
  spaces: HomeFreeSpace[];
};
export type HomeBookingLimitsData = {
  branch: { id: string; name: string };
  now: string;
  date: string;
  limitMinutes: number;
  usedMinutes: number;
  remainingMinutes: number;
};
