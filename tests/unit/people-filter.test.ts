import { describe, expect, it } from "vitest";
import {
  carryFloorQuery,
  filterFloorByPeople,
  parsePeopleFilter,
  peopleFilterHref,
} from "@/features/bookings/people-filter";
import { floorDayFixture } from "./booking-ui-fixtures";
import type { FloorVisibleSpace } from "@/features/bookings/types";

describe("people query", () => {
  it.each([
    undefined,
    null,
    "",
    "1",
    "0",
    "-2",
    "51",
    "2.5",
    "2.0",
    " 2",
    "2 ",
    "NaN",
    "2e1",
    ["2", "3"],
  ])("ignores %j", (value) => {
    expect(parsePeopleFilter(value)).toBeNull();
  });
  it.each([
    ["2", 2],
    ["50", 50],
    ["05", 5],
  ])("reads %s", (value, expected) => {
    expect(parsePeopleFilter(value)).toBe(expected);
  });
  it("changes only people and keeps date, view, space, detail and hash", () => {
    const href =
      "/branches/a/floors/b?date=2026-10-07&view=list&space=c&detail=1&people=4#list";
    const next = peopleFilterHref(href, 5);
    expect(next).toBe(href.replace("people=4", "people=5"));
    expect(peopleFilterHref(next, null)).toBe(href.replace("&people=4", ""));
  });
  it("carries only shared view and people without overriding a destination", () => {
    const current = new URLSearchParams(
      "date=old&space=old&detail=1&view=list&people=5",
    );
    expect(
      carryFloorQuery(
        "/branches/a/floors/b?date=new&view=timeline#grid",
        current,
      ),
    ).toBe("/branches/a/floors/b?date=new&view=timeline&people=5#grid");
    expect(carryFloorQuery("/branches/a/floors/b?people=8", current)).toBe(
      "/branches/a/floors/b?people=8&view=list",
    );
  });
  it("does not turn repeated invalid people values into a valid filter during navigation", () => {
    const query = new URLSearchParams("people=4&people=5");
    const url = new URL(carryFloorQuery("/floor", query), "http://floor.local");
    expect(parsePeopleFilter(url.searchParams.getAll("people"))).toBeNull();
  });
});

function example() {
  const data = floorDayFixture();
  const room = data.spaces[0] as FloorVisibleSpace;
  data.spaces = [
    { ...room, id: "small", capacity: 4 },
    { ...room, id: "fit", capacity: 5 },
    {
      ...room,
      id: "unlimited",
      capacity: null,
      summary: { status: "busy", availableAt: null },
    },
    { ...room, id: "lounge", type: "lounge", bookable: false },
    { ...room, id: "desk", type: "desk_area", bookable: false, deskCount: 24 },
    { kind: "restricted", id: "private", type: "meeting_room" },
  ];
  data.groups = [
    { type: "meeting_room", totalCount: 4, freeCount: 2 },
    { type: "lounge", totalCount: 1, freeCount: 0 },
    { type: "desk_area", totalCount: 1, freeCount: 0 },
  ];
  return data;
}

describe("shared floor people filter", () => {
  it("keeps the original result without a filter", () => {
    const data = example();
    expect(filterFloorByPeople(data, null, null)).toEqual({
      data,
      hiddenCount: 0,
    });
    expect(filterFloorByPeople(data, null, null).data).toBe(data);
  });
  it("filters by access, booking and capacity, counts every removed row and removes empty groups", () => {
    const data = example();
    const result = filterFloorByPeople(data, 5, null);
    expect(result.data.spaces.map(({ id }) => id)).toEqual([
      "fit",
      "unlimited",
    ]);
    expect(result.hiddenCount).toBe(4);
    expect(result.data.groups).toEqual([
      { type: "meeting_room", totalCount: 2, freeCount: 1 },
    ]);
    expect(data.spaces).toHaveLength(6);
  });
  it.each(["small", "lounge", "desk", "private"])(
    "retains selected %s even when it fails the filter",
    (selected) => {
      const result = filterFloorByPeople(example(), 5, selected);
      expect(result.data.spaces.map(({ id }) => id)).toContain(selected);
      expect(result.hiddenCount).toBe(3);
    },
  );
  it("never invents a missing selected space", () => {
    expect(
      filterFloorByPeople(example(), 50, "missing").data.spaces.map(
        ({ id }) => id,
      ),
    ).toEqual(["unlimited"]);
  });
  it("does not count current availability on another date or outside operating hours", () => {
    const data = example();
    data.isToday = false;
    expect(
      filterFloorByPeople(data, 5, null).data.groups[0]?.freeCount,
    ).toBeNull();
    data.isToday = true;
    data.operatingState = {
      ...data.operatingState,
      status: "after_close",
      nextOpening: null,
    };
    expect(
      filterFloorByPeople(data, 5, null).data.groups[0]?.freeCount,
    ).toBeNull();
  });
});
