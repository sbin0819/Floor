import type { Avatar } from "@/lib/avatar";
import type { FloorPlanDocument } from "@/lib/floor-plan/types";
import type { SpaceType } from "@/features/bookings/types";
import type { ReportSummary } from "./reports-types";

export type DashboardRange = "day" | "week" | "30days";
export type DashboardPeriod = {
  start: string;
  end: string;
  previousStart: string;
  previousEnd: string;
};
export type AdminDashboardData = {
  branch: {
    id: string;
    name: string;
    timezone: string;
    utilization: number | null;
  };
  now: string;
  date: string;
  range: DashboardRange;
  floorId: string | null;
  period: DashboardPeriod;
  isToday: boolean;
  canManageMaintenance: boolean;
  reportSummary?: ReportSummary | null;
  cards: {
    bookingCount: number;
    ongoingCount: number | null;
    remainingCount: number | null;
    meetingUtilization: number | null;
    previousMeetingUtilization: number | null;
    maintenanceCount: number;
  };
  floors: {
    id: string;
    name: string;
    level: number;
    utilization: number | null;
  }[];
  spaces: {
    id: string;
    floorId: string;
    name: string;
    type: SpaceType;
    utilization: number | null;
  }[];
  plan: { id: string; version: number; document: FloorPlanDocument } | null;
  upcoming: {
    id: string;
    start: string;
    end: string;
    spaceName: string;
    floorName: string;
    booker: { name: string; avatar: Avatar };
    teamName: string | null;
    attendeeCount: number;
  }[];
  maintenance: {
    id: string;
    spaceName: string;
    floorName: string;
    start: string;
    end: string;
    reason: string | null;
    status: "ongoing" | "upcoming";
  }[];
};
