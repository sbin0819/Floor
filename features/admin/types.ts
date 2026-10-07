import type {
  BranchDetails,
  FloorSummary,
  SpaceType,
} from "@/features/bookings/types";
import type { AccessScope } from "@/lib/permissions/types";

export type TeamOption = { id: string; name: string };
export type AdminPermissions = { manageSpaces: boolean; editAccess: boolean };
export type AdminBranchData = {
  branch: BranchDetails;
  floors: (FloorSummary & { access: AccessScope; spaceCount: number })[];
  permissions: AdminPermissions;
};
export type AdminSpace = {
  id: string;
  floorId: string;
  name: string;
  type: Exclude<SpaceType, "desk">;
  capacity: number | null;
  bookable: boolean;
  amenities: string[];
  access: AccessScope | null;
  archivedAt: string | null;
  allowedTeams: TeamOption[];
  deskCount: number;
};
export type AdminFloorData = {
  branch: BranchDetails;
  floor: FloorSummary & { access: AccessScope; allowedTeams: TeamOption[] };
  spaces: AdminSpace[];
  permissions: AdminPermissions;
  teamSearch: {
    query: string;
    valid: boolean;
    results: { id: string; name: string; homeBranchName: string | null }[];
  };
};
