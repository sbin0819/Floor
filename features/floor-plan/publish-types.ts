import type { DeskPart } from "@/features/bookings/desk-parts";
import type { PlanIssue } from "@/lib/floor-plan/issues";
import type { FloorPlanDocument } from "@/lib/floor-plan/types";

export type PlanPublishPreview = {
  draft: { planId: string; version: number; revision: number };
  changedShapes: number;
  seats: {
    created: string[];
    renamed: { from: string; to: string }[];
    archived: string[];
  };
  issues: PlanIssue[];
  blockingBookings: {
    seatName: string;
    date: string;
    part: DeskPart | null;
    timeRange: string | null;
    bookerName: string | null;
  }[];
};
export type PlanVersion = {
  planId: string;
  version: number;
  status: "published" | "archived";
  publishedAt: string | null;
  publishedByName: string | null;
};
export type PublishFloorPlanResult = {
  planId: string;
  version: number;
  publishedAt: string;
  seats: { created: number; renamed: number; archived: number };
};
export type RestorePlanVersionResult = {
  floorId: string;
  basePlanId: string | null;
  document: FloorPlanDocument;
  draft: { planId: string; version: number; revision: number };
  savedAt: string;
};
