import type { AvailabilityKind } from "@/features/bookings/availability";
import { getOperatingWindow } from "@/features/bookings/operating-state";
import type {
  FloorDayData,
  FloorVisibleSpace,
  RestrictedSpace,
} from "@/features/bookings/types";
import type { PlanShapeState, PlanStates } from "@/lib/floor-plan/render/types";
import { localTime } from "@/lib/time/zoned";

type PlanSpace = FloorVisibleSpace | RestrictedSpace;
type PlanDay = Pick<FloorDayData, "date"> &
  Pick<FloorDayData["branch"], "timezone" | "openHours">;
type Interval = { start: number; end: number; kind: AvailabilityKind };

function mergedIntervals(space: FloorVisibleSpace): Interval[] {
  // 조회의 잘린 구간만 사용하고 같은 종류의 맞닿은 구간만 잇는다.
  return (["maintenance", "mine", "other"] as const).flatMap((kind) => {
    const merged: Interval[] = [];
    const rows = space.intervals
      .filter((row) => row.kind === kind)
      .map((row) => ({
        ...row,
        start: Date.parse(row.start),
        end: Date.parse(row.end),
      }))
      .sort((a, b) => a.start - b.start || a.end - b.end);
    for (const row of rows) {
      const last = merged.at(-1);
      if (last && row.start <= last.end) last.end = Math.max(last.end, row.end);
      else merged.push(row);
    }
    return merged;
  });
}

function spaceState(space: PlanSpace, at: Date, day: PlanDay): PlanShapeState {
  if (space.kind === "restricted")
    return { kind: "restricted", name: "전용 공간", label: "다른 팀 전용" };
  const window = getOperatingWindow(day.date, day.timezone, day.openHours);
  const neutral = (label: string): PlanShapeState => ({
    kind: "neutral",
    name: space.name,
    label,
  });
  if (!space.bookable && space.deskCount === 0)
    return neutral("예약 없이 쓰는 곳");
  if (!window) return neutral("쉬는 날이에요");
  const current = at.getTime();
  const close = Date.parse(window.end);
  if (current < Date.parse(window.start) || current >= close)
    return neutral("운영 시간이 아니에요");
  if (!space.bookable) {
    const part = space.deskParts?.find(
      (row) =>
        Date.parse(row.start) <= current && current < Date.parse(row.end),
    );
    return {
      ...neutral(
        part ? `빈 자리 ${part.freeCount}석` : `좌석 ${space.deskCount}석`,
      ),
      deskArea: true,
    };
  }

  const intervals = mergedIntervals(space);
  const active = intervals.find(
    (row) => row.start <= current && current < row.end,
  );
  const capacity = space.capacity === null ? "" : `${space.capacity}인 · `;
  const time = (instant: number) => localTime(new Date(instant), day.timezone);
  if (active) {
    if (active.kind === "maintenance")
      return {
        kind: "maintenance",
        name: space.name,
        label: `점검 중 · ${active.end === close ? "운영 종료" : time(active.end)}까지`,
      };
    if (active.kind === "mine")
      return {
        kind: "mine",
        name: space.name,
        label: `내 예약 · ${time(active.end)}까지`,
      };
    return {
      kind: "booked",
      name: space.name,
      label: `${capacity}${time(active.end)}까지 예약됨`,
    };
  }
  const next = intervals.reduce(
    (end, row) => (row.start > current ? Math.min(end, row.start) : end),
    close,
  );
  return {
    kind: "free",
    name: space.name,
    label: `${capacity}${next === close ? "운영 종료" : time(next)}까지 비어 있음`,
  };
}

export function planStatusText(
  space: PlanSpace,
  at: Date,
  day: PlanDay,
): string {
  return spaceState(space, at, day).label ?? "";
}

export function planTooltipText(
  state: PlanShapeState,
  capacity?: number | null,
): { title: string; description: string } {
  if (state.kind === "restricted")
    return { title: "전용 공간", description: "다른 팀 전용이에요" };
  return {
    title: `${state.name}${capacity == null ? "" : ` · ${capacity}인`}`,
    description: state.label ?? "",
  };
}

export function planStatesAt(data: FloorDayData, at: Date): PlanStates {
  const day: PlanDay = { date: data.date, ...data.branch };
  return new Map(
    data.spaces.map((space) => [
      space.id.toLowerCase(),
      spaceState(space, at, day),
    ]),
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
