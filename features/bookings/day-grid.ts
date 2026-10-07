import { currentSlotStart } from "@/features/bookings/rules";
import type { SelectableSlot } from "@/features/bookings/selection";
import type { DayBooking, SpaceDayData } from "@/features/bookings/types";
import { localDate, SLOT_MINUTES } from "@/lib/time/zoned";

type GridBlock =
  | { kind: "booking"; item: DayBooking }
  | { kind: "maintenance"; item: SpaceDayData["blocks"][number] };
export type DayGridBlock = GridBlock & {
  offset: number;
  size: number;
  lane: number;
  lanes: number;
};
const slotMilliseconds = SLOT_MINUTES * 60_000;

export function dayGridLayout({
  slots,
  bookings,
  blocks,
  now,
  date,
  timeZone,
  showPast,
}: {
  slots: SelectableSlot[];
  bookings: DayBooking[];
  blocks: SpaceDayData["blocks"];
  now: string;
  date: string;
  timeZone: string;
  showPast: boolean;
}) {
  const instant = new Date(now);
  const isToday = localDate(instant, timeZone) === date;
  const cutoff = currentSlotStart(instant, timeZone).getTime();
  const hiddenSlots = isToday
    ? slots.filter((slot) => Date.parse(slot.end) <= cutoff)
    : [];
  const visibleSlots = showPast ? slots : slots.slice(hiddenSlots.length);
  const first = visibleSlots[0];
  const last = visibleSlots.at(-1);
  const start = first ? Date.parse(first.start) : 0;
  const end = last ? Date.parse(last.end) : 0;
  const position = (value: string) =>
    (Date.parse(value) - start) / slotMilliseconds;
  const hiddenStart = hiddenSlots[0]?.start;
  const hiddenEnd = hiddenSlots.at(-1)?.end;
  const hiddenBookingCount =
    hiddenStart && hiddenEnd
      ? bookings.filter(
          (booking) =>
            Date.parse(booking.start) < Date.parse(hiddenEnd) &&
            Date.parse(booking.end) > Date.parse(hiddenStart),
        ).length
      : 0;
  const intervals: GridBlock[] = [
    ...bookings.map((item) => ({ kind: "booking" as const, item })),
    ...blocks.map((item) => ({ kind: "maintenance" as const, item })),
  ];
  const placed: DayGridBlock[] = intervals
    .filter(
      ({ item }) =>
        Date.parse(item.start) < end && Date.parse(item.end) > start,
    )
    .sort(
      (a, b) =>
        Date.parse(a.item.start) - Date.parse(b.item.start) ||
        Date.parse(b.item.end) - Date.parse(a.item.end) ||
        a.item.id.localeCompare(b.item.id),
    )
    .map((block) => {
      const offset = Math.max(0, position(block.item.start));
      return {
        ...block,
        offset,
        size: Math.min(visibleSlots.length, position(block.item.end)) - offset,
        lane: 0,
        lanes: 1,
      };
    });
  // 서로 이어서 겹치는 구간끼리만 열을 나눠 취소할 예약을 점검 뒤에 숨기지 않는다.
  let group: DayGridBlock[] = [];
  let laneEnds: number[] = [];
  let groupEnd = -Infinity;
  const finishGroup = () => {
    for (const block of group) block.lanes = laneEnds.length;
    group = [];
    laneEnds = [];
  };
  for (const block of placed) {
    if (block.offset >= groupEnd) finishGroup();
    let lane = laneEnds.findIndex((finish) => finish <= block.offset);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = block.offset + block.size;
    block.lane = lane;
    group.push(block);
    groupEnd = Math.max(...laneEnds);
  }
  finishGroup();
  const currentPosition =
    isToday && instant.getTime() >= start && instant.getTime() < end
      ? (instant.getTime() - start) / slotMilliseconds
      : null;
  return {
    slots: visibleSlots,
    blocks: placed,
    hiddenSlots,
    hiddenBookingCount,
    currentPosition,
    position,
  };
}
