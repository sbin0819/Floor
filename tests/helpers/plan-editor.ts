import type { PlanEditorData } from "@/features/floor-plan/editor-types";
import type { FloorPlanDocument } from "@/lib/floor-plan/types";

export const planEditorIds = {
  branch: "a8000000-0000-4000-8000-000000000001",
  floor: "a8000000-0000-4000-8000-000000000002",
  spaceA: "a8000000-0000-4000-8000-000000000003",
  spaceB: "a8000000-0000-4000-8000-000000000004",
  spaceC: "a8000000-0000-4000-8000-000000000005",
  plan: "a8000000-0000-4000-8000-000000000006",
} as const;

export function planEditorDocument(): FloorPlanDocument {
  return {
    schema: 1,
    unit: "mm",
    bounds: { w: 20_000, h: 14_000 },
    walls: [],
    openings: [],
    seats: [],
    spaces: [
      {
        id: "space-a",
        spaceId: planEditorIds.spaceA,
        polygon: [
          [1000, 1000],
          [5000, 1000],
          [5000, 4000],
          [1000, 4000],
        ],
        label: { at: [3000, 2500] },
      },
      {
        id: "space-b",
        spaceId: planEditorIds.spaceB,
        polygon: [
          [8000, 5000],
          [11000, 5000],
          [11000, 9000],
          [8000, 9000],
        ],
        label: { at: [9500, 7000] },
      },
    ],
    fixtures: [
      {
        id: "fixture-core",
        kind: "core",
        label: "코어",
        polygon: [
          [15000, 1000],
          [17000, 1000],
          [17000, 4000],
          [15000, 4000],
        ],
      },
    ],
  };
}

export function planEditorFixture(): PlanEditorData {
  return {
    branch: {
      id: planEditorIds.branch,
      name: "가상 강남점",
      timezone: "Asia/Seoul",
    },
    floor: {
      id: planEditorIds.floor,
      name: "6F",
      access: "everyone",
      allowedTeamIds: [],
    },
    draft: null,
    published: {
      planId: planEditorIds.plan,
      version: 1,
      document: planEditorDocument(),
    },
    spaces: [
      {
        id: planEditorIds.spaceA,
        floorId: planEditorIds.floor,
        parentId: null,
        type: "meeting_room",
        name: "회의실 6A",
        bookable: true,
        archived: false,
        access: null,
        allowedTeamIds: [],
        capacity: 8,
        amenities: ["monitor", "whiteboard"],
        futureBookingCount: 0,
      },
      {
        id: planEditorIds.spaceB,
        floorId: planEditorIds.floor,
        parentId: null,
        type: "seminar",
        name: "세미나실",
        bookable: true,
        archived: false,
        access: "everyone",
        allowedTeamIds: [],
        capacity: 16,
        amenities: ["projector"],
        futureBookingCount: 0,
      },
    ],
    canManageSpaces: true,
    adminFilesEnabled: false,
  };
}
