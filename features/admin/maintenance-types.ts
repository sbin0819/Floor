import type { SpaceType } from "@/features/bookings/types";

export type MaintenanceStart = { kind: "now" } | { kind: "at"; at: string };
export type MaintenanceWindow = { start: string; end: string };
export type MaintenanceTab = "active" | "past";
export type MaintenanceSpaceType = Exclude<SpaceType, "lounge">;
export type MaintenanceSpaceOption = {
  id: string;
  name: string;
  floorId: string;
  floorName: string;
  type: MaintenanceSpaceType;
};
export type MaintenanceRow = MaintenanceWindow & {
  id: string;
  space: { id: string; name: string; floorName: string; type: SpaceType };
  reason: string | null;
  state: "ongoing" | "upcoming" | "past";
  createdByName: string;
};
export type MaintenanceListData = {
  branch: { id: string; name: string; timezone: string };
  now: string;
  tab: MaintenanceTab;
  activeCount: number;
  spaces: MaintenanceSpaceOption[];
  rows: MaintenanceRow[];
};
export type MaintenanceBookingPreview = MaintenanceWindow & {
  id: string;
  bookerName: string;
  teamName: string | null;
  attendeeCount: number;
};
export type MaintenancePreview = {
  branchId: string;
  window: MaintenanceWindow;
  bookings: MaintenanceBookingPreview[];
};
