import type {
  AnnouncementsData,
  AnnouncementAudiencePreview,
} from "@/features/admin/announcement-types";
import {
  announcementTargetKey,
  type AnnouncementPreviewRequest,
} from "@/features/admin/announcement-navigation";

export const announcementBranchId = "10000000-0000-4000-8000-000000000001";
export const announcementFloorId = "20000000-0000-4000-8000-000000000001";
export const announcementSpaceId = "30000000-0000-4000-8000-000000000001";
export function announcementsFixture(
  changes: Partial<AnnouncementsData> = {},
): AnnouncementsData {
  return {
    branch: {
      id: announcementBranchId,
      name: "강남점",
      timezone: "Asia/Seoul",
    },
    now: "2026-10-14T00:00:00.000Z",
    today: "2026-10-14",
    maxDate: "2026-11-13",
    lounge: { available: true, reason: null, memberCount: 128 },
    floors: [
      {
        id: announcementFloorId,
        name: "7F",
        spaces: [
          { id: announcementSpaceId, name: "회의실 B", type: "meeting_room" },
        ],
      },
    ],
    rows: [
      {
        id: "50000000-0000-4000-8000-000000000001",
        title: "7층 회의실 모니터 교체 안내",
        createdAt: "2026-10-13T00:12:00.000Z",
        lounge: true,
        audience: true,
        recipientCount: 18,
      },
    ],
    ...changes,
  };
}
export function announcementRequest(
  lounge = true,
  audience = true,
): AnnouncementPreviewRequest {
  const input = {
    branchId: announcementBranchId,
    lounge,
    audience: audience
      ? { date: "2026-10-14", floorId: announcementFloorId, spaceId: null }
      : null,
  };
  return {
    input,
    inputKey: announcementTargetKey(input),
    nonce: "40000000-0000-4000-8000-000000000001",
  };
}
export function announcementPreviewFixture(
  count = 23,
): AnnouncementAudiencePreview {
  return {
    branchId: announcementBranchId,
    lounge: announcementsFixture().lounge,
    recipientCount: count,
  };
}
