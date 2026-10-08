import type { AvailabilityInterval } from "@/features/bookings/availability";
import {
  createBookingSlots,
  currentSlotStart,
  type BookingSlot,
} from "@/features/bookings/rules";
import type { SelectableSlot } from "@/features/bookings/selection";
import type {
  FloorDayData,
  FloorVisibleSpace,
  RestrictedSpace,
  SpaceType,
} from "@/features/bookings/types";
import { localDate, SLOT_MINUTES } from "@/lib/time/zoned";
import { localTime } from "@/lib/time/zoned";

const step = SLOT_MINUTES * 60_000;
const spaceOrder: SpaceType[] = [
  "meeting_room",
  "seminar",
  "phone_booth",
  "desk_area",
  "lounge",
];

export type TimetableBlock = AvailabilityInterval & {
  offset: number;
  size: number;
  column: number;
  span: number;
  lane: number;
  lanes: number;
  ended: boolean;
};
export type TimetableRow =
  | { kind: "restricted"; space: RestrictedSpace }
  | {
      kind: "accessible";
      space: FloorVisibleSpace;
      slots: SelectableSlot[];
      blocks: TimetableBlock[];
      laneCount: number;
    };
export type TimetableGroup = {
  type: SpaceType;
  totalCount: number;
  freeCount: number | null;
  rows: TimetableRow[];
};
export type TimetableFocus =
  | { spaceId: string; target: "space" }
  | { spaceId: string; target: "slot"; start: string };

function placeBlocks(
  intervals: readonly AvailabilityInterval[],
  slots: readonly BookingSlot[],
  now: number,
): TimetableBlock[] {
  const first = slots[0];
  const last = slots.at(-1);
  if (!first || !last) return [];
  const start = Date.parse(first.start);
  const end = Date.parse(last.end);
  const blocks = intervals
    .flatMap((interval): TimetableBlock[] => {
      const begins = Math.max(start, Date.parse(interval.start));
      const finishes = Math.min(end, Date.parse(interval.end));
      if (begins >= finishes) return [];
      const offset = (begins - start) / step;
      const size = (finishes - begins) / step;
      return [
        {
          kind: interval.kind,
          start: new Date(begins).toISOString(),
          end: new Date(finishes).toISOString(),
          offset,
          size,
          column: Math.floor(offset),
          span: Math.ceil(offset + size) - Math.floor(offset),
          lane: 0,
          lanes: 1,
          ended: finishes <= now,
        },
      ];
    })
    .sort(
      (a, b) =>
        a.offset - b.offset || b.size - a.size || a.kind.localeCompare(b.kind),
    );
  let group: TimetableBlock[] = [];
  let laneEnds: number[] = [];
  let groupEnd = -Infinity;
  const finishGroup = () => {
    for (const block of group) block.lanes = laneEnds.length;
    group = [];
    laneEnds = [];
  };
  for (const block of blocks) {
    if (block.offset >= groupEnd) finishGroup();
    let lane = laneEnds.findIndex((end) => end <= block.offset);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = block.offset + block.size;
    block.lane = lane;
    group.push(block);
    groupEnd = Math.max(...laneEnds);
  }
  finishGroup();
  return blocks;
}

export function floorTimetableLayout(
  data: FloorDayData,
  displayNow = data.now,
) {
  const slots = createBookingSlots({
    date: data.date,
    timeZone: data.branch.timezone,
    openHours: data.branch.openHours,
  });
  const now = Date.parse(data.now);
  const minimum = currentSlotStart(
    new Date(data.now),
    data.branch.timezone,
  ).getTime();
  const rows: TimetableRow[] = data.spaces
    .map<TimetableRow>((space) => {
      if (space.kind === "restricted") return { kind: "restricted", space };
      if (!space.bookable)
        return {
          kind: "accessible",
          space,
          slots: (space.deskParts ?? [])
            .filter((part) => part.part !== "day")
            .map((part) => ({
              start: part.start,
              end: part.end,
              label: localTime(new Date(part.start), data.branch.timezone),
              endLabel: localTime(new Date(part.end), data.branch.timezone),
              state: part.selectable ? "free" : "past",
            })),
          blocks: [],
          laneCount: 1,
        };
      const states: SelectableSlot[] = slots.map((slot) => {
        const overlaps = space.intervals.filter(
          (interval) =>
            Date.parse(interval.start) < Date.parse(slot.end) &&
            Date.parse(interval.end) > Date.parse(slot.start),
        );
        return {
          ...slot,
          state: overlaps.some(({ kind }) => kind === "maintenance")
            ? "maintenance"
            : overlaps.length
              ? "reserved"
              : Date.parse(slot.start) < minimum
                ? "past"
                : "free",
        };
      });
      const blocks = placeBlocks(space.intervals, slots, now);
      return {
        kind: "accessible",
        space,
        slots: states,
        blocks,
        laneCount: Math.max(1, ...blocks.map(({ lanes }) => lanes)),
      };
    })
    .sort(
      (a, b) =>
        spaceOrder.indexOf(a.space.type) - spaceOrder.indexOf(b.space.type) ||
        Number(a.kind === "restricted") - Number(b.kind === "restricted") ||
        (a.kind === "accessible" ? a.space.name : "").localeCompare(
          b.kind === "accessible" ? b.space.name : "",
          "ko",
        ),
    );
  const groups: TimetableGroup[] = spaceOrder.flatMap((type) => {
    const groupRows = rows.filter(({ space }) => space.type === type);
    if (!groupRows.length) return [];
    const group = data.groups.find((group) => group.type === type);
    return [
      {
        type,
        totalCount: group?.totalCount ?? groupRows.length,
        freeCount:
          data.isToday && data.operatingState.status === "open"
            ? (group?.freeCount ?? null)
            : null,
        rows: groupRows,
      },
    ];
  });
  const start = slots[0] ? Date.parse(slots[0].start) : null;
  const end = slots.at(-1) ? Date.parse(slots.at(-1)!.end) : null;
  const nowPosition =
    localDate(new Date(displayNow), data.branch.timezone) === data.date &&
    start !== null &&
    end !== null &&
    Date.parse(displayNow) >= start &&
    Date.parse(displayNow) < end
      ? (Date.parse(displayNow) - start) / step
      : null;
  const pastColumns =
    data.isToday && start !== null
      ? Math.max(0, Math.min(slots.length, (now - start) / step))
      : 0;
  return { slots, rows, groups, nowPosition, pastColumns, start, end };
}

export function timetableFocusKey(position: TimetableFocus): string {
  return `${position.spaceId}:${position.target}:${position.target === "slot" ? position.start : ""}`;
}

export function timetableFocusTargets(
  rows: readonly TimetableRow[],
): TimetableFocus[] {
  return rows.flatMap((row): TimetableFocus[] =>
    row.kind === "restricted"
      ? []
      : [
          { spaceId: row.space.id, target: "space" },
          ...row.slots
            .filter(({ state }) => state === "free")
            .map((slot): TimetableFocus => ({
              spaceId: row.space.id,
              target: "slot",
              start: slot.start,
            })),
        ],
  );
}

export function moveTimetableFocus(
  rows: readonly TimetableRow[],
  current: TimetableFocus,
  key: string,
): TimetableFocus {
  const index = rows.findIndex(({ space }) => space.id === current.spaceId);
  const row = rows[index];
  if (!row || row.kind !== "accessible") return current;
  const free = row.slots.filter(({ state }) => state === "free");
  const fromSlot = (start: string): TimetableFocus => ({
    spaceId: row.space.id,
    target: "slot",
    start,
  });
  if (key === "Home" || key === "End") {
    const target = key === "Home" ? free[0] : free.at(-1);
    return target ? fromSlot(target.start) : current;
  }
  if (key === "ArrowLeft" || key === "ArrowRight") {
    if (current.target === "space")
      return key === "ArrowRight" && free[0]
        ? fromSlot(free[0].start)
        : current;
    const position = free.findIndex(({ start }) => start === current.start);
    if (position === -1) return current;
    if (key === "ArrowLeft" && position === 0)
      return { spaceId: row.space.id, target: "space" };
    const target = free[position + (key === "ArrowRight" ? 1 : -1)];
    return target ? fromSlot(target.start) : current;
  }
  if (key !== "ArrowUp" && key !== "ArrowDown") return current;
  const direction = key === "ArrowDown" ? 1 : -1;
  for (
    let targetIndex = index + direction;
    targetIndex >= 0 && targetIndex < rows.length;
    targetIndex += direction
  ) {
    const next = rows[targetIndex];
    if (!next || next.kind !== "accessible") continue;
    if (current.target === "space")
      return { spaceId: next.space.id, target: "space" };
    const nextFree = next.slots.filter(({ state }) => state === "free");
    const time = Date.parse(current.start);
    const target = nextFree.sort(
      (a, b) =>
        Math.abs(Date.parse(a.start) - time) -
          Math.abs(Date.parse(b.start) - time) ||
        Date.parse(a.start) - Date.parse(b.start),
    )[0];
    if (target)
      return { spaceId: next.space.id, target: "slot", start: target.start };
  }
  return current;
}
