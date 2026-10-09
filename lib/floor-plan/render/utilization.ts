/** 서버가 계산한 비율을 화면과 캔버스에서 같은 정수 백분율로 보여준다. */
export function utilizationPercent(
  value: number | null | undefined,
): number | null {
  return value === null || value === undefined || !Number.isFinite(value)
    ? null
    : Math.round(Math.min(1, Math.max(0, value)) * 100);
}

export function utilizationBand(value: number): 0 | 1 | 2 | 3 {
  const percent = utilizationPercent(value) ?? 0;
  return percent < 25 ? 0 : percent < 50 ? 1 : percent < 75 ? 2 : 3;
}

export function utilizationLabel(value: number | null | undefined): string {
  const percent = utilizationPercent(value);
  return percent === null ? "이용률 없음" : `이용률 ${percent}%`;
}
