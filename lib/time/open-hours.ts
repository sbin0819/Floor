import { z } from "zod";
import {
  addDays,
  dayKeys,
  localDate,
  SLOT_MINUTES,
  timeToMinutes,
  weekday,
} from "@/lib/time/zoned";
import type { DayKey } from "@/lib/time/zoned";

export { dayKeys };
export type { DayKey };

export type DayOpenHours = { open: string; close: string };
export type OpenHours = Partial<Record<DayKey, DayOpenHours | null>>;

const slotTimeSchema = z.string().refine((value) => {
  try {
    return timeToMinutes(value) % SLOT_MINUTES === 0;
  } catch {
    return false;
  }
}, "시각은 30분 단위로 입력해 주세요");

export const dayOpenHoursSchema = z
  .strictObject({
    open: slotTimeSchema,
    close: slotTimeSchema,
  })
  .refine(({ open, close }) => open < close, {
    path: ["close"],
    message: "종료 시각은 시작 시각보다 늦어야 해요",
  });

export const openHoursSchema = z.strictObject({
  mon: dayOpenHoursSchema.nullable().optional(),
  tue: dayOpenHoursSchema.nullable().optional(),
  wed: dayOpenHoursSchema.nullable().optional(),
  thu: dayOpenHoursSchema.nullable().optional(),
  fri: dayOpenHoursSchema.nullable().optional(),
  sat: dayOpenHoursSchema.nullable().optional(),
  sun: dayOpenHoursSchema.nullable().optional(),
});

export function getOpenHours(
  value: unknown,
  date: string,
): DayOpenHours | null {
  const day = weekday(date);
  const parsed = openHoursSchema.safeParse(value);
  const hours = parsed.success ? parsed.data[day] : undefined;
  return hours === null
    ? null
    : { ...(hours ?? { open: "09:00", close: "22:00" }) };
}

function nearestOperatingDate(
  date: string,
  openHours: unknown,
  step: 1 | -1,
): string {
  let current = date;
  let closedDays = 0;
  while (getOpenHours(openHours, current) === null) {
    closedDays += 1;
    if (closedDays >= dayKeys.length)
      throw new RangeError("The branch has no operating days.");
    current = addDays(current, step);
  }
  return current;
}

// 기준일은 지점 시간대의 오늘이고, 오늘이 쉬는 날이면 다음 운영일이다.
// 오프셋은 기준일에서 쉬는 날을 건너뛰고 센 운영일 수이며, 음수면 거슬러 간다.
export function getOperatingDate(
  now: Date,
  timeZone: string,
  openHours: unknown,
  dayOffset = 0,
): string {
  if (!Number.isSafeInteger(dayOffset))
    throw new RangeError("Operating day offset must be an integer.");
  let date = nearestOperatingDate(localDate(now, timeZone), openHours, 1);
  const step = dayOffset < 0 ? -1 : 1;
  for (let remaining = Math.abs(dayOffset); remaining > 0; remaining -= 1)
    date = nearestOperatingDate(addDays(date, step), openHours, step);
  return date;
}
