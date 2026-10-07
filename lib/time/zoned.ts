export const SLOT_MINUTES = 30;

export const dayKeys = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
] as const;
export type DayKey = (typeof dayKeys)[number];

const formatters = new Map<string, Intl.DateTimeFormat>();
const hourMilliseconds = 60 * 60 * 1_000;

function formatter(timeZone: string): Intl.DateTimeFormat {
  let value = formatters.get(timeZone);
  if (!value) {
    value = new Intl.DateTimeFormat("en-US-u-ca-iso8601-nu-latn", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, value);
  }
  return value;
}

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone || /^[+-]/.test(timeZone)) return false;
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

function dateParts(instant: Date, timeZone: string) {
  if (!Number.isFinite(instant.getTime()))
    throw new RangeError("Invalid instant.");
  const parts = formatter(timeZone).formatToParts(instant);
  function part(type: Intl.DateTimeFormatPartTypes): number {
    const value = parts.find((entry) => entry.type === type)?.value;
    if (!value) throw new RangeError("Missing local date component.");
    return Number(value);
  }
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
    second: part("second"),
  };
}

function utcDate(year: number, month: number, day: number): Date {
  const value = new Date(0);
  value.setUTCFullYear(year, month - 1, day);
  value.setUTCHours(0, 0, 0, 0);
  return value;
}

function parseDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new RangeError("Expected a YYYY-MM-DD date.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const result = utcDate(year, month, day);
  if (year < 1 || result.toISOString().slice(0, 10) !== value)
    throw new RangeError("Invalid calendar date.");
  return result;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

export function localDate(instant: Date, timeZone: string): string {
  const { year, month, day } = dateParts(instant, timeZone);
  return `${String(year).padStart(4, "0")}-${twoDigits(month)}-${twoDigits(day)}`;
}

export function localTime(instant: Date, timeZone: string): string {
  const { hour, minute } = dateParts(instant, timeZone);
  return `${twoDigits(hour)}:${twoDigits(minute)}`;
}

export function weekday(date: string): DayKey {
  const key = dayKeys[(parseDate(date).getUTCDay() + 6) % 7];
  if (!key) throw new RangeError("Invalid weekday.");
  return key;
}

export function addDays(date: string, days: number): string {
  if (!Number.isSafeInteger(days))
    throw new RangeError("Days must be an integer.");
  const value = parseDate(date);
  value.setUTCDate(value.getUTCDate() + days);
  if (!Number.isFinite(value.getTime()))
    throw new RangeError("Date is out of range.");
  const result = value.toISOString().slice(0, 10);
  parseDate(result);
  return result;
}

export function timeToMinutes(time: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) throw new RangeError("Expected an HH:mm time.");
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 24 || minutes > 59 || (hours === 24 && minutes !== 0))
    throw new RangeError("Invalid clock time.");
  return hours * 60 + minutes;
}

function offsetAt(timestamp: number, timeZone: string): number {
  const { year, month, day, hour, minute, second } = dateParts(
    new Date(timestamp),
    timeZone,
  );
  const wall = utcDate(year, month, day);
  wall.setUTCHours(hour, minute, second, 0);
  return wall.getTime() - Math.floor(timestamp / 1_000) * 1_000;
}

function transitionAfter(
  start: number,
  end: number,
  offset: number,
  timeZone: string,
) {
  let lower = start;
  let upper = end;
  while (upper - lower > 1_000) {
    const middle = Math.floor((lower + upper) / 2_000) * 1_000;
    if (offsetAt(middle, timeZone) === offset) lower = middle;
    else upper = middle;
  }
  return upper;
}

export function zonedDateTime(
  date: string,
  time: string,
  timeZone: string,
): Date {
  if (!isValidTimeZone(timeZone))
    throw new RangeError("Invalid IANA time zone.");
  const wall = parseDate(date).getTime() + timeToMinutes(time) * 60_000;
  const samples = Array.from({ length: 17 }, (_, index) => {
    const timestamp = wall + (index - 8) * 6 * hourMilliseconds;
    return { timestamp, offset: offsetAt(timestamp, timeZone) };
  });
  const offsets = new Set(samples.map((sample) => sample.offset));
  const candidates = [...offsets]
    .map((offset) => wall - offset)
    .filter((timestamp) => timestamp + offsetAt(timestamp, timeZone) === wall);
  if (candidates.length > 0) return new Date(Math.min(...candidates));

  // 없는 현지 시각은 오프셋만 밀지 않고, 건너뛴 구간 직후의 첫 시각으로 맞춘다.
  for (let index = 1; index < samples.length; index += 1) {
    const before = samples[index - 1];
    const after = samples[index];
    if (!before || !after || after.offset <= before.offset) continue;
    const transition = transitionAfter(
      before.timestamp,
      after.timestamp,
      before.offset,
      timeZone,
    );
    if (wall >= transition + before.offset && wall < transition + after.offset)
      return new Date(transition);
  }
  throw new RangeError("Unable to resolve local date and time.");
}
