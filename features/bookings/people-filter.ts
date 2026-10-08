import type { FloorDayData } from "./types";

export function parsePeopleFilter(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const people = Number(value);
  return Number.isInteger(people) && people >= 2 && people <= 50
    ? people
    : null;
}

export function carryFloorQuery(
  href: string,
  search: { toString(): string },
): string {
  const target = new URL(href, "http://floor.local");
  const current = new URLSearchParams(search.toString());
  for (const key of ["view", "people"]) {
    if (target.searchParams.has(key)) continue;
    for (const value of current.getAll(key))
      target.searchParams.append(key, value);
  }
  return `${target.pathname}${target.search}${target.hash}`;
}

export function peopleFilterHref(href: string, people: number | null): string {
  const target = new URL(href, "http://floor.local");
  if (people === null) target.searchParams.delete("people");
  else target.searchParams.set("people", String(people));
  return `${target.pathname}${target.search}${target.hash}`;
}

export function filterFloorByPeople(
  data: FloorDayData,
  people: number | null,
  selectedSpaceId: string | null,
): { data: FloorDayData; hiddenCount: number } {
  if (people === null) return { data, hiddenCount: 0 };
  const spaces = data.spaces.filter(
    (space) =>
      space.id === selectedSpaceId ||
      (space.kind === "accessible" &&
        space.bookable &&
        space.deskCount === 0 &&
        (space.capacity === null || space.capacity >= people)),
  );
  const groups = data.groups.flatMap(({ type }) => {
    const rows = spaces.filter((space) => space.type === type);
    return rows.length
      ? [
          {
            type,
            totalCount: rows.length,
            freeCount:
              data.isToday && data.operatingState.status === "open"
                ? rows.filter(
                    (space) =>
                      space.kind === "accessible" &&
                      space.bookable &&
                      space.summary?.status === "free",
                  ).length
                : null,
          },
        ]
      : [];
  });
  return {
    data: { ...data, spaces, groups },
    hiddenCount: data.spaces.length - spaces.length,
  };
}
