import type { FloorPlanDocument } from "@/lib/floor-plan/types";

export function arrangeDesks(
  desks: readonly { id: string; name: string }[],
  positions: FloorPlanDocument["seats"],
): { id: string; name: string; row: number; column: number }[] {
  const byId = new Map(positions.map((seat) => [seat.spaceId, seat]));
  const placed = desks
    .flatMap((desk) => {
      const position = byId.get(desk.id);
      return position ? [{ ...desk, position }] : [];
    })
    .sort(
      (a, b) =>
        a.position.at[1] - b.position.at[1] ||
        a.position.at[0] - b.position.at[0] ||
        a.id.localeCompare(b.id),
    );
  const rows: (typeof placed)[] = [];
  for (const desk of placed) {
    const current = rows.at(-1);
    const first = current?.[0];
    if (
      first &&
      desk.position.at[1] - first.position.at[1] <= first.position.size[1] / 2
    ) {
      current!.push(desk);
    } else rows.push([desk]);
  }
  const result = rows.flatMap((row, rowIndex) =>
    row
      .sort(
        (a, b) =>
          a.position.at[0] - b.position.at[0] || a.id.localeCompare(b.id),
      )
      .map(({ id, name }, column) => ({ id, name, row: rowIndex, column })),
  );
  const unplaced = desks
    .filter(({ id }) => !byId.has(id))
    .toSorted(
      (a, b) =>
        a.name.localeCompare(b.name, "ko", { numeric: true }) ||
        a.id.localeCompare(b.id),
    );
  for (const [index, { id, name }] of unplaced.entries()) {
    result.push({
      id,
      name,
      row: rows.length + Math.floor(index / 6),
      column: index % 6,
    });
  }
  return result;
}
