import type { FloorPlanDocument } from "@/lib/floor-plan/types";
import type { PlanContext } from "@/lib/floor-plan/validate";
import type { AccessScope } from "@/lib/permissions/types";

export type PlanEditorSpace = PlanContext["spaces"][number] & {
  capacity: number | null;
  amenities: string[];
  futureBookingCount: number;
};
export type PlanEditorData = {
  branch: { id: string; name: string; timezone: string };
  floor: {
    id: string;
    name: string;
    access: AccessScope;
    allowedTeamIds: string[];
  };
  draft: {
    planId: string;
    version: number;
    revision: number;
    document: FloorPlanDocument;
    updatedAt: string | null;
    updatedByName: string | null;
  } | null;
  published: {
    planId: string;
    version: number;
    document: FloorPlanDocument;
  } | null;
  spaces: PlanEditorSpace[];
  canManageSpaces: boolean;
};
export type AdminPlansData = {
  branch: PlanEditorData["branch"];
  floors: {
    id: string;
    name: string;
    published: {
      planId: string;
      version: number;
      publishedAt: string | null;
    } | null;
    draft: {
      planId: string;
      version: number;
      updatedAt: string | null;
      updatedByName: string | null;
    } | null;
  }[];
};
export type SaveFloorPlanDraftResult = {
  planId: string;
  version: number;
  revision: number;
  savedAt: string;
};
