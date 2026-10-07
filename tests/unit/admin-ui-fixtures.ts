import type {
  AdminBranchData,
  AdminFloorData,
  AdminSpace,
} from "@/features/admin/types";
export const adminIds = {
  branch: "10000000-0000-4000-8000-000000000001",
  floor: "20000000-0000-4000-8000-000000000001",
  space: "30000000-0000-4000-8000-000000000001",
  team: "40000000-0000-4000-8000-000000000001",
};
export function adminSpaceFixture(): AdminSpace {
  return {
    id: adminIds.space,
    floorId: adminIds.floor,
    name: "회의실 A",
    type: "meeting_room",
    capacity: 6,
    bookable: true,
    amenities: ["monitor"],
    access: null,
    archivedAt: null,
    allowedTeams: [],
    deskCount: 0,
  };
}
export function adminFloorFixture(): AdminFloorData {
  return {
    branch: {
      id: adminIds.branch,
      name: "가상 강남점",
      address: "가상 거리",
      timezone: "Asia/Seoul",
      openHours: {},
    },
    floor: {
      id: adminIds.floor,
      name: "7F",
      level: 7,
      sortOrder: 1,
      access: "everyone",
      allowedTeams: [],
    },
    spaces: [adminSpaceFixture()],
    permissions: { manageSpaces: true, editAccess: true },
    teamSearch: { query: "", valid: false, results: [] },
  };
}
export function adminBranchFixture(): AdminBranchData {
  const data = adminFloorFixture();
  return {
    branch: data.branch,
    floors: [{ ...data.floor, spaceCount: 1 }],
    permissions: data.permissions,
  };
}
