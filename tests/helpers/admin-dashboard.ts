import planFile from "@/docs/spec/examples/gangnam-7f.plan.json";
import spaceFile from "@/docs/spec/examples/gangnam-7f.spaces.json";
import { floorPlanSchema } from "@/lib/floor-plan/schema";
import type { AdminDashboardData } from "@/features/admin/dashboard-types";

export function adminDashboardFixture(
  change: Partial<AdminDashboardData> = {},
): AdminDashboardData {
  const rates: Record<string, number | null> = {
    "회의실 A": 0.91,
    "회의실 B": 0.74,
    "회의실 C": 0.46,
    "회의실 D": null,
    "폰부스 1": 0.88,
    "폰부스 2": 0.7,
    "오픈 데스크": 0.63,
    세미나룸: 0.5,
    라운지: null,
  };
  return {
    branch: { ...spaceFile.branch, timezone: "Asia/Seoul", utilization: 0.68 },
    now: "2026-10-14T02:30:00.000Z",
    date: "2026-10-14",
    range: "day",
    floorId: null,
    period: {
      start: "2026-10-14",
      end: "2026-10-15",
      previousStart: "2026-10-07",
      previousEnd: "2026-10-08",
    },
    isToday: true,
    cards: {
      bookingCount: 42,
      ongoingCount: 5,
      remainingCount: 19,
      meetingUtilization: 0.68,
      previousMeetingUtilization: 0.62,
      maintenanceCount: 1,
    },
    floors: [
      { id: spaceFile.floor.id, name: "7F", level: 7, utilization: 0.68 },
      {
        id: "f0000000-0000-4000-8000-000000000008",
        name: "8F",
        level: 8,
        utilization: null,
      },
    ],
    spaces: spaceFile.spaces
      .filter(({ type }) => type !== "desk")
      .map((space) => ({
        id: space.id,
        floorId: spaceFile.floor.id,
        name: space.name,
        type: space.type as AdminDashboardData["spaces"][number]["type"],
        utilization: rates[space.name] ?? null,
      })),
    plan: null,
    upcoming: ["회의실 B", "폰부스 1", "세미나룸", "회의실 C"].map(
      (spaceName, index) => ({
        id: `b0000000-0000-4000-8000-00000000000${index}`,
        start: `2026-10-14T${index < 2 ? "03" : "04"}:${index % 2 ? "30" : "00"}:00.000Z`,
        end: "2026-10-14T05:00:00.000Z",
        spaceName,
        floorName: "7F",
        booker: {
          name: ["박지훈", "이서연", "최민준", "정유나"][index]!,
          avatar: { color: "blue", photoUrl: null },
        },
        teamName: index === 0 ? "디자인팀" : null,
        attendeeCount: [4, 1, 18, 3][index]!,
      }),
    ),
    maintenance: [
      {
        id: "m1",
        spaceName: "회의실 D",
        floorName: "7F",
        start: "2026-10-14T00:00:00.000Z",
        end: "2026-10-15T03:00:00.000Z",
        reason: "모니터 교체",
        status: "ongoing",
      },
    ],
    ...change,
  };
}
export const adminDashboardPlan = {
  id: "a0000000-0000-4000-8000-000000000001",
  version: 1,
  document: floorPlanSchema.parse(planFile),
};
