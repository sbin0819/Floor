import type {
  BranchDetails,
  FloorSummary,
  SpaceType,
} from "@/features/bookings/types";
import type { AccessScope } from "@/lib/permissions/types";
import type { OperatingState } from "@/features/bookings/operating-state";

export type OperatorBranchCard = {
  id: string;
  name: string;
  address: string | null;
  floorCount: number;
  spaceCount: number;
  operatingState: OperatingState;
};
export type OperatorBranchCardsData = {
  now: string;
  branches: OperatorBranchCard[];
};

export type TeamOption = { id: string; name: string };
export type AdminPermissions = { manageSpaces: boolean; editAccess: boolean };
export type AdminBranchData = {
  branch: Omit<BranchDetails, "cover">;
  floors: (Omit<FloorSummary, "plan"> & {
    access: AccessScope;
    spaceCount: number;
  })[];
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
  branch: Omit<BranchDetails, "cover">;
  floor: Omit<FloorSummary, "plan"> & {
    access: AccessScope;
    allowedTeams: TeamOption[];
  };
  spaces: AdminSpace[];
  permissions: AdminPermissions;
  teamSearch: {
    query: string;
    valid: boolean;
    results: { id: string; name: string; homeBranchName: string | null }[];
  };
};
