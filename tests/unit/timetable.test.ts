import { describe, expect, it } from "vitest";
import {
  floorTimetableLayout,
  moveTimetableFocus,
  timetableFocusTargets,
  type TimetableFocus,
} from "@/features/bookings/timetable";
import type { FloorVisibleSpace } from "@/features/bookings/types";
import { at, timetableFixture } from "./timetable-fixtures";

function rowWithIntervals(intervals: FloorVisibleSpace["intervals"]) {
  const data = timetableFixture();
  const space = data.spaces.find(
    (space): space is FloorVisibleSpace => space.kind === "accessible",
  )!;
  data.spaces = [{ ...space, intervals }];
  return { data, layout: floorTimetableLayout(data) };
}
describe("floor timetable layout", () => {
  it("uses ordered groups and accessible names before restricted rows", () => {
    const layout = floorTimetableLayout(timetableFixture());
    expect(layout.rows.map(({ space }) => space.id)).toEqual([
      "a",
      "b",
      "hidden",
      "desk",
      "lounge",
    ]);
    expect(layout.groups.map(({ type }) => type)).toEqual([
      "meeting_room",
      "desk_area",
      "lounge",
    ]);
    expect(layout.slots).toHaveLength(10);
    expect(layout.slots[0]?.label).toBe("09:00");
    expect(layout.slots.at(-1)?.endLabel).toBe("14:00");
  });
  it("marks past, blocked and current half-hour slots without detailed booking data", () => {
    const row = floorTimetableLayout(timetableFixture()).rows[0]!;
    expect(row.kind).toBe("accessible");
    if (row.kind !== "accessible") throw Error("fixture");
    expect(row.slots.map(({ state }) => state)).toEqual([
      "past",
      "past",
      "free",
      "free",
      "reserved",
      "reserved",
      "free",
      "free",
      "free",
      "free",
    ]);
    expect(
      row.slots.every(
        (slot) =>
          !Object.hasOwn(slot, "booking") && !Object.hasOwn(slot, "block"),
      ),
    ).toBe(true);
  });
  it("clips intervals crossing operating boundaries and omits wholly outside intervals", () => {
    const { layout } = rowWithIntervals([
      { start: at(8), end: at(9, 30), kind: "other" },
      { start: at(13, 30), end: at(15), kind: "mine" },
      { start: at(15), end: at(16), kind: "maintenance" },
    ]);
    const row = layout.rows[0]!;
    if (row.kind !== "accessible") throw Error("fixture");
    expect(row.blocks).toMatchObject([
      {
        start: at(9),
        end: at(9, 30),
        offset: 0,
        size: 1,
        column: 0,
        span: 1,
        ended: true,
      },
      {
        start: at(13, 30),
        end: at(14),
        offset: 9,
        size: 1,
        column: 9,
        span: 1,
        ended: false,
      },
    ]);
  });
  it("keeps overlapping maintenance and reservations in separate lanes", () => {
    const { layout } = rowWithIntervals([
      { start: at(11), end: at(12), kind: "mine" },
      { start: at(11, 15), end: at(12, 15), kind: "maintenance" },
      { start: at(12, 15), end: at(13), kind: "other" },
    ]);
    const row = layout.rows[0]!;
    if (row.kind !== "accessible") throw Error("fixture");
    expect(row.laneCount).toBe(2);
    expect(row.blocks).toMatchObject([
      { kind: "mine", lane: 0, lanes: 2 },
      {
        kind: "maintenance",
        offset: 4.5,
        size: 2,
        column: 4,
        span: 3,
        lane: 1,
        lanes: 2,
      },
      { kind: "other", lane: 0, lanes: 1 },
    ]);
    expect(row.slots[4]?.state).toBe("maintenance");
  });
  it("uses the shorter Saturday operating hours", () => {
    const data = timetableFixture();
    data.date = "2026-10-10";
    data.isToday = false;
    data.branch.openHours.sat = { open: "10:00", close: "12:00" };
    expect(floorTimetableLayout(data).slots.map(({ label }) => label)).toEqual([
      "10:00",
      "10:30",
      "11:00",
      "11:30",
    ]);
  });
  it("does not draw today's clock or past cover on a future date", () => {
    const data = timetableFixture();
    data.date = "2026-10-14";
    data.isToday = false;
    const layout = floorTimetableLayout(data);
    expect(layout.nowPosition).toBeNull();
    expect(layout.pastColumns).toBe(0);
    expect(layout.groups.every(({ freeCount }) => freeCount === null)).toBe(
      true,
    );
    const row = layout.rows[0]!;
    if (row.kind !== "accessible") throw Error("fixture");
    expect(row.slots.every(({ state }) => state === "free")).toBe(true);
  });
  it("clamps today's past cover and has no free slots after closing", () => {
    const data = timetableFixture();
    data.now = at(18);
    data.operatingState = {
      ...data.operatingState,
      status: "after_close",
      nextOpening: null,
    };
    const layout = floorTimetableLayout(data);
    expect(layout.pastColumns).toBe(10);
    expect(layout.nowPosition).toBeNull();
    expect(layout.groups[0]?.freeCount).toBeNull();
    expect(
      layout.rows
        .flatMap((row) => (row.kind === "accessible" ? row.slots : []))
        .some(({ state }) => state === "free"),
    ).toBe(false);
  });
  it("positions the server clock fractionally and starts no earlier than the current slot", () => {
    const layout = floorTimetableLayout(timetableFixture());
    expect(layout.nowPosition).toBeCloseTo(2 + 1 / 3);
    expect(layout.pastColumns).toBeCloseTo(2 + 1 / 3);
  });
  it("does not add slots, blocks or metadata to restricted or nonbookable rows", () => {
    const layout = floorTimetableLayout(timetableFixture());
    expect(layout.rows[2]).toEqual({
      kind: "restricted",
      space: { kind: "restricted", id: "hidden", type: "meeting_room" },
    });
    expect(layout.rows[3]).toMatchObject({ slots: [], blocks: [] });
  });
  it.each([
    ["2026-03-08", 6, ["00:00", "00:30", "01:00", "01:30", "03:00", "03:30"]],
    [
      "2026-11-01",
      10,
      [
        "00:00",
        "00:30",
        "01:00",
        "01:30",
        "01:00",
        "01:30",
        "02:00",
        "02:30",
        "03:00",
        "03:30",
      ],
    ],
  ])("uses timestamp columns over DST %s", (date, count, labels) => {
    const data = timetableFixture();
    data.date = date;
    data.branch.timezone = "America/Los_Angeles";
    data.branch.openHours = { sun: { open: "00:00", close: "04:00" } };
    const layout = floorTimetableLayout(data);
    expect(layout.slots).toHaveLength(count);
    expect(layout.slots.map(({ label }) => label)).toEqual(labels);
    expect(new Set(layout.slots.map(({ start }) => start)).size).toBe(count);
  });
});
describe("timetable roving focus", () => {
  const rows = () => floorTimetableLayout(timetableFixture()).rows;
  const slot = (spaceId: string, hour: number, minute = 0): TimetableFocus => ({
    spaceId,
    target: "slot",
    start: at(hour, minute),
  });
  it("targets only accessible links and free slots", () => {
    const targets = timetableFocusTargets(rows());
    expect(
      targets
        .filter(({ target }) => target === "space")
        .map(({ spaceId }) => spaceId),
    ).toEqual(["a", "b", "desk", "lounge"]);
    expect(targets.some(({ spaceId }) => spaceId === "hidden")).toBe(false);
    expect(
      targets.filter(
        ({ spaceId, target }) => spaceId === "desk" && target === "slot",
      ),
    ).toEqual([]);
  });
  it("moves left/right over occupied cells and connects first free slot to the space link", () => {
    const data = rows();
    expect(moveTimetableFocus(data, slot("a", 10, 30), "ArrowRight")).toEqual(
      slot("a", 12),
    );
    expect(moveTimetableFocus(data, slot("a", 10), "ArrowLeft")).toEqual({
      spaceId: "a",
      target: "space",
    });
    expect(
      moveTimetableFocus(data, { spaceId: "a", target: "space" }, "ArrowRight"),
    ).toEqual(slot("a", 10));
    expect(moveTimetableFocus(data, slot("a", 13, 30), "ArrowRight")).toEqual(
      slot("a", 13, 30),
    );
  });
  it("moves Home and End to the first/last free slot", () => {
    expect(moveTimetableFocus(rows(), slot("a", 12), "Home")).toEqual(
      slot("a", 10),
    );
    expect(moveTimetableFocus(rows(), slot("a", 12), "End")).toEqual(
      slot("a", 13, 30),
    );
  });
  it("moves vertically to the same time or closest earlier-on-tie free time", () => {
    expect(moveTimetableFocus(rows(), slot("a", 12), "ArrowDown")).toEqual(
      slot("b", 12),
    );
    const data = timetableFixture();
    const space = data.spaces[0]!;
    if (space.kind !== "accessible") throw Error("fixture");
    space.intervals = [{ start: at(10, 30), end: at(11), kind: "other" }];
    expect(
      moveTimetableFocus(
        floorTimetableLayout(data).rows,
        slot("a", 10, 30),
        "ArrowDown",
      ),
    ).toEqual(slot("b", 10));
  });
  it("skips restricted, nonbookable and full rows from a free cell", () => {
    const data = timetableFixture();
    const base = data.spaces[0]!;
    if (base.kind !== "accessible") throw Error("fixture");
    data.spaces.push({
      ...base,
      id: "last",
      name: "마지막 폰부스",
      type: "phone_booth",
      intervals: [],
    });
    base.intervals = [{ start: at(9), end: at(14), kind: "other" }];
    expect(
      moveTimetableFocus(
        floorTimetableLayout(data).rows,
        slot("a", 12),
        "ArrowDown",
      ),
    ).toEqual(slot("last", 12));
    expect(moveTimetableFocus(rows(), slot("b", 12), "ArrowDown")).toEqual(
      slot("b", 12),
    );
  });
  it("moves space links past restricted rows, including nonbookable rows", () => {
    expect(
      moveTimetableFocus(
        rows(),
        { spaceId: "b", target: "space" },
        "ArrowDown",
      ),
    ).toEqual({ spaceId: "desk", target: "space" });
    expect(
      moveTimetableFocus(rows(), { spaceId: "a", target: "space" }, "ArrowUp"),
    ).toEqual({ spaceId: "a", target: "space" });
  });
});
