import type { AdminFloorData, AdminSpace } from "./types";

export type AdminSpacePhoto = {
  id: string;
  path: string;
  alt: string;
  sortOrder: number;
};
export type AdminSpaceDetailData = Omit<AdminFloorData, "spaces"> & {
  space: AdminSpace;
  photos: AdminSpacePhoto[];
  filesEnabled: boolean;
};
export type AdminSpaceDetailOptions = {
  tab?: "info" | "access" | "photos";
  team?: unknown;
};
