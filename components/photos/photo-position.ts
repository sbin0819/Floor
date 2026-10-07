export function photoIndexAtOffset(
  offset: number,
  viewportWidth: number,
  count: number,
): number {
  if (
    count < 1 ||
    viewportWidth <= 0 ||
    !Number.isFinite(offset) ||
    !Number.isFinite(viewportWidth)
  )
    return 0;
  return Math.max(0, Math.min(count - 1, Math.round(offset / viewportWidth)));
}
