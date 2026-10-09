import { getAvailabilitySummary } from "@/features/bookings/availability";
import { formatAvailabilityUntil } from "@/features/bookings/format";
import {
  getOperatingState,
  getOperatingWindow,
} from "@/features/bookings/operating-state";
import { getFloorSpaceStatusLine } from "@/features/bookings/space-status-line";
import type { FloorDayData } from "@/features/bookings/types";
import type { PlanShapeState, PlanStates } from "@/lib/floor-plan/render/types";

export function planStatesAt(data: FloorDayData, at: Date): PlanStates {
  const window = getOperatingWindow(
    data.date,
    data.branch.timezone,
    data.branch.openHours,
  );
  return new Map(
    data.spaces.map((space): [string, PlanShapeState] => {
      if (space.kind === "restricted")
        return [
          space.id.toLowerCase(),
          { kind: "restricted", name: "전용 공간", label: "다른 팀 전용" },
        ];
      if (!window)
        return [
          space.id.toLowerCase(),
          { kind: "neutral", name: space.name, label: "쉬는 날이에요" },
        ];
      if (!space.bookable) {
        const part = space.deskParts?.find(
          (part) =>
            Date.parse(part.start) <= at.getTime() &&
            at.getTime() < Date.parse(part.end),
        );
        return [
          space.id.toLowerCase(),
          {
            kind: "neutral",
            name: space.name,
            deskArea: space.deskCount > 0,
            label:
              space.deskCount > 0
                ? part
                  ? `빈 자리 ${part.freeCount}석`
                  : `좌석 ${space.deskCount}석`
                : "예약 없이 이용해요",
          },
        ];
      }
      const intervals = space.planIntervals ?? space.intervals;
      let summary = getAvailabilitySummary({
        window,
        now: at,
        userId: "self",
        teamIds: [],
        bookings: intervals
          .filter((row) => row.kind !== "maintenance")
          .map((row) => ({
            start: new Date(row.start),
            end: new Date(row.end),
            userId: row.kind === "mine" ? "self" : "other",
            teamId: null,
          })),
        blocks: intervals
          .filter((row) => row.kind === "maintenance")
          .map((row) => ({
            start: new Date(row.start),
            end: new Date(row.end),
          })),
      });
      const mine = intervals.find(
        (row) =>
          row.kind === "mine" &&
          Date.parse(row.start) <= at.getTime() &&
          at.getTime() < Date.parse(row.end),
      );
      if (mine && summary.status === "busy")
        summary = { status: "mine", until: mine.end };
      const line = getFloorSpaceStatusLine(
        {
          ...data,
          isToday: true,
          operatingState: getOperatingState(
            at,
            data.branch.timezone,
            data.branch.openHours,
          ),
        },
        { ...space, summary },
      );
      const occupied = intervals.find(
        (row) =>
          row.kind === "other" &&
          Date.parse(row.start) <= at.getTime() &&
          at.getTime() < Date.parse(row.end),
      );
      const label =
        line.kind === "busy" && occupied
          ? `${formatAvailabilityUntil(occupied.end, data.date, data.branch.timezone)} 예약됨`
          : line.label;
      return [
        space.id.toLowerCase(),
        {
          kind:
            line.kind === "busy"
              ? "booked"
              : line.kind === "none"
                ? "neutral"
                : line.kind,
          name: space.name,
          label: `${space.capacity ? `${space.capacity}인 · ` : ""}${label}`,
        },
      ];
    }),
  );
}

export function planSummary(data: FloorDayData, states: PlanStates) {
  const counts = { free: 0, booked: 0, maintenance: 0 };
  for (const space of data.spaces) {
    if (space.kind !== "accessible" || !space.bookable) continue;
    const kind = states.get(space.id.toLowerCase())?.kind;
    if (kind === "free") counts.free += 1;
    if (kind === "booked" || kind === "mine") counts.booked += 1;
    if (kind === "maintenance") counts.maintenance += 1;
  }
  return `빈 공간 ${counts.free} · 예약됨 ${counts.booked} · 점검 ${counts.maintenance}`;
}
