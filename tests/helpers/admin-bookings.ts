import type {
  AdminBookingRow,
  AdminBookingsData,
} from "@/features/admin/booking-types";

export const adminBookingBranchId = "b0000000-0000-4000-8000-000000000001";
export const adminBookingFloorId = "f0000000-0000-4000-8000-000000000007";
export function adminBookingFixture(
  change: Partial<AdminBookingRow> = {},
): AdminBookingRow {
  return {
    id: "a0000000-0000-4000-8000-000000000001",
    start: "2026-10-14T03:00:00.000Z",
    end: "2026-10-14T04:00:00.000Z",
    floorName: "7F",
    spaceName: "회의실 C",
    spaceType: "meeting_room",
    areaName: null,
    deskPart: null,
    bookerName: "박지훈",
    avatar: { color: "blue", photoUrl: null },
    teamName: "디자인팀",
    title: "제품 기획 회의",
    attendeeCount: 4,
    participantCount: 2,
    status: "confirmed",
    cancelledByOwner: false,
    cancelKind: null,
    cancelReason: null,
    canCancel: true,
    ...change,
  };
}
export function adminBookingsFixture(
  change: Partial<AdminBookingsData> = {},
): AdminBookingsData {
  return {
    branch: {
      id: adminBookingBranchId,
      name: "강남점",
      timezone: "Asia/Seoul",
    },
    floors: [{ id: adminBookingFloorId, name: "7F" }],
    filters: {
      date: "2026-10-14",
      days: 1,
      status: "confirmed",
      q: "",
      page: 1,
    },
    now: "2026-10-14T02:30:00.000Z",
    total: 1,
    rows: [adminBookingFixture()],
    ...change,
  };
}
