import type {
  MaintenanceListData,
  MaintenancePreview,
} from "@/features/admin/maintenance-types";
import {
  maintenancePreviewKey,
  type MaintenanceRequest,
} from "@/features/admin/maintenance-navigation";

export const maintenanceBranchId = "b0000000-0000-4000-8000-000000000001";
export const maintenanceSpaceId = "b0000000-0000-4000-8000-000000000002";
export const maintenanceBlockId = "b0000000-0000-4000-8000-000000000003";
export function maintenanceFixture(
  overrides: Partial<MaintenanceListData> = {},
): MaintenanceListData {
  return {
    branch: { id: maintenanceBranchId, name: "강남점", timezone: "Asia/Seoul" },
    now: "2026-10-14T03:00:00.000Z",
    tab: "active",
    activeCount: 2,
    spaces: [
      {
        id: maintenanceSpaceId,
        name: "회의실 C",
        floorId: "b0000000-0000-4000-8000-000000000004",
        floorName: "7F",
        type: "meeting_room",
      },
      {
        id: "b0000000-0000-4000-8000-000000000005",
        name: "오픈 데스크 A-12",
        floorId: "b0000000-0000-4000-8000-000000000004",
        floorName: "7F",
        type: "desk",
      },
    ],
    rows: [
      {
        id: maintenanceBlockId,
        space: {
          id: maintenanceSpaceId,
          name: "회의실 C",
          floorName: "7F",
          type: "meeting_room",
        },
        start: "2026-10-14T02:00:00.000Z",
        end: "2026-10-15T03:00:00.000Z",
        reason: "모니터 교체",
        state: "ongoing",
        createdByName: "김도윤",
      },
      {
        id: "b0000000-0000-4000-8000-000000000006",
        space: {
          id: "b0000000-0000-4000-8000-000000000005",
          name: "오픈 데스크 A-12",
          floorName: "7F",
          type: "desk",
        },
        start: "2026-10-15T03:00:00.000Z",
        end: "2026-10-15T04:00:00.000Z",
        reason: "의자 교체",
        state: "upcoming",
        createdByName: "김도윤",
      },
    ],
    ...overrides,
  };
}
export function maintenanceRequest(nonce = "first"): MaintenanceRequest {
  const input = {
    spaceId: maintenanceSpaceId,
    start: { kind: "now" as const },
    end: "2026-10-14T05:00:00.000Z",
  };
  return { input, inputKey: maintenancePreviewKey(input), nonce };
}
export function maintenancePreviewFixture(count = 1): MaintenancePreview {
  return {
    branchId: maintenanceBranchId,
    window: {
      start: "2026-10-14T03:00:00.000Z",
      end: "2026-10-14T05:00:00.000Z",
    },
    bookings: Array.from({ length: count }, (_, index) => ({
      id: `c0000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      start: "2026-10-14T04:00:00.000Z",
      end: "2026-10-14T05:00:00.000Z",
      bookerName: ["박지훈", "이서연", "최민준"][index % 3]!,
      teamName: index % 2 === 0 ? "디자인팀" : null,
      attendeeCount: index + 2,
    })),
  };
}
