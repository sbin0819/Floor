import { getOpenHours } from "@/lib/time/open-hours";
import { zonedDateTime } from "@/lib/time/zoned";

export const DESK_SPLIT = "13:00";
export const deskPartLabels = { am: "오전", pm: "오후", day: "종일" } as const;
export type DeskPart = keyof typeof deskPartLabels;
export type DeskPartRange = { part: DeskPart; start: string; end: string };

export function createDeskParts({
  date,
  timeZone,
  openHours,
}: {
  date: string;
  timeZone: string;
  openHours: unknown;
}): DeskPartRange[] {
  const hours = getOpenHours(openHours, date);
  if (!hours) return [];
  const instant = (time: string) =>
    zonedDateTime(date, time, timeZone).toISOString();
  const parts: DeskPartRange[] = [];
  if (hours.open < DESK_SPLIT)
    parts.push({
      part: "am",
      start: instant(hours.open),
      end: instant(hours.close < DESK_SPLIT ? hours.close : DESK_SPLIT),
    });
  if (hours.close > DESK_SPLIT)
    parts.push({
      part: "pm",
      start: instant(hours.open > DESK_SPLIT ? hours.open : DESK_SPLIT),
      end: instant(hours.close),
    });
  if (parts.length === 2)
    parts.push({
      part: "day",
      start: instant(hours.open),
      end: instant(hours.close),
    });
  return parts.filter(({ start, end }) => start < end);
}

export function isDeskPartSelectable(
  part: DeskPart,
  parts: readonly DeskPartRange[],
  now: Date,
): boolean {
  const range = parts.find((range) => range.part === part);
  const cutoff =
    part === "day"
      ? parts.find((range) => range.part === "am")?.end
      : range?.end;
  return Boolean(range && cutoff && now.getTime() < new Date(cutoff).getTime());
}

export function classifyDeskPart(
  during: { start: Date | string; end: Date | string },
  parts: readonly DeskPartRange[],
): DeskPart | null {
  return (
    parts.find(
      ({ start, end }) =>
        new Date(start).getTime() === new Date(during.start).getTime() &&
        new Date(end).getTime() === new Date(during.end).getTime(),
    )?.part ?? null
  );
}
