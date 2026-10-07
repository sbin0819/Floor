import { z } from "zod";

export function requestedSpaceId(value: unknown): string | null {
  const parsed = z.uuid().safeParse(value);
  return parsed.success ? parsed.data.toLowerCase() : null;
}

export function floorSelectionKey(
  branchId: string,
  floorId: string,
  date: unknown,
  space: unknown,
): string {
  return JSON.stringify([
    branchId.toLowerCase(),
    floorId.toLowerCase(),
    date ?? null,
    requestedSpaceId(space),
  ]);
}

export function searchValue(
  search: { getAll(name: string): string[] },
  name: string,
): string | string[] | undefined {
  const values = search.getAll(name);
  return values.length > 1 ? values : values[0];
}
