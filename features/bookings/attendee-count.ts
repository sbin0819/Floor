export function attendeeCountError(
  value: number | null,
  capacity: number | null,
  minimum = 1,
): string | undefined {
  if (value === null) return undefined;
  if (capacity !== null && value > capacity)
    return `정원은 ${capacity}명이에요`;
  if (!Number.isInteger(value) || value < 1 || value > 500)
    return "1명부터 500명까지 정수로 적어 주세요";
  if (value < minimum) return "참석자 수보다 적을 수 없어요";
  return undefined;
}

export function effectiveAttendeeCount(
  draft: { attendeeCount: number | null; attendeeCountTouched: boolean },
  people: number | null,
  capacity: number | null,
): number | null {
  if (draft.attendeeCountTouched) return draft.attendeeCount;
  return people !== null && people <= (capacity ?? 500) ? people : null;
}
