import { describe, expect, it } from "vitest";
import { diffSeats } from "@/lib/floor-plan/seat-diff";
import { floorPlanSchema } from "@/lib/floor-plan/schema";
import { loadSeedData } from "@/lib/seed/data";
import type { FloorPlanDocument } from "@/lib/floor-plan/types";
import { validatePlan, type PlanContext } from "@/lib/floor-plan/validate";

const uuid = (n: number) =>
  `abcdefab-abcd-4abc-8abc-${n.toString(16).padStart(12, "0")}`;
const floorId = uuid(1),
  areaA = uuid(2),
  areaB = uuid(3),
  deskId = uuid(4);
const row = (
  overrides: Partial<PlanContext["spaces"][number]> = {},
): PlanContext["spaces"][number] => ({
  id: areaA,
  floorId,
  parentId: null,
  type: "desk_area",
  name: "구역 A",
  archived: false,
  bookable: false,
  access: null,
  allowedTeamIds: [],
  ...overrides,
});
function setup() {
  const document: FloorPlanDocument = {
    schema: 1,
    unit: "mm",
    bounds: { w: 20000, h: 10000 },
    walls: [],
    openings: [],
    fixtures: [],
    spaces: [
      {
        id: "area-a",
        spaceId: areaA,
        polygon: [
          [0, 0],
          [10000, 0],
          [10000, 10000],
          [0, 10000],
        ],
        label: { at: [5000, 5000] },
      },
      {
        id: "area-b",
        spaceId: areaB,
        polygon: [
          [10000, 0],
          [20000, 0],
          [20000, 10000],
          [10000, 10000],
        ],
        label: { at: [15000, 5000] },
      },
    ],
    seats: [
      {
        id: "seat",
        spaceId: deskId,
        at: [1000, 1000],
        size: [1400, 700],
        rotation: 0,
      },
    ],
  };
  const context: PlanContext = {
    floorId,
    floorAccess: "everyone",
    floorAllowedTeamIds: [],
    spaces: [
      row(),
      row({ id: areaB, name: "구역 B", bookable: true }),
      row({
        id: deskId,
        parentId: areaA,
        type: "desk",
        name: "A-01",
        bookable: true,
      }),
    ],
  };
  return { document, context };
}

describe("diffSeats", () => {
  it("keeps an unchanged published seat as a no-op including a missing label", () => {
    const { document, context } = setup();
    const before = structuredClone({ document, context });
    expect(diffSeats(document, context)).toEqual({
      created: [],
      updated: [],
      archived: [],
      firstSeatAreaIds: [],
      occupiedAreaIds: [areaA],
    });
    expect({ document, context }).toEqual(before);
  });
  it("creates an unknown ID and marks the new area's first seat", () => {
    const { document, context } = setup();
    document.seats.push({
      ...document.seats[0]!,
      id: "new",
      spaceId: uuid(5).toUpperCase(),
      at: [11000, 1000],
      label: "B-01",
    });
    expect(diffSeats(document, context)).toEqual({
      created: [{ id: uuid(5), shapeId: "new", name: "B-01", parentId: areaB }],
      updated: [],
      archived: [],
      firstSeatAreaIds: [areaB],
      occupiedAreaIds: [areaA, areaB],
    });
  });
  it("reports a rename separately from its previous value", () => {
    const { document, context } = setup();
    document.seats[0]!.label = "A-30";
    expect(diffSeats(document, context)?.updated).toEqual([
      {
        id: deskId,
        name: "A-30",
        parentId: areaA,
        previousName: "A-01",
        previousParentId: areaA,
      },
    ]);
  });
  it("reports a parent-only move without counting it as renamed", () => {
    const { document, context } = setup();
    document.seats[0]!.at = [11000, 1000];
    const result = diffSeats(document, context)!;
    expect(result.updated).toEqual([
      {
        id: deskId,
        name: "A-01",
        parentId: areaB,
        previousName: "A-01",
        previousParentId: areaA,
      },
    ]);
    expect(
      result.updated.filter((seat) => seat.name !== seat.previousName),
    ).toHaveLength(0);
    expect(result.firstSeatAreaIds).toEqual([areaB]);
    expect(result.occupiedAreaIds).toEqual([areaB]);
  });
  it("archives only this floor's active omitted desks", () => {
    const { document, context } = setup();
    document.seats = [];
    context.spaces = [
      ...context.spaces,
      row({ id: uuid(9), type: "desk", parentId: areaA, archived: true }),
      row({ id: uuid(10), type: "desk", floorId: uuid(99) }),
    ];
    expect(diffSeats(document, context)).toEqual({
      created: [],
      updated: [],
      archived: [{ id: deskId, name: "A-01", parentId: areaA }],
      firstSeatAreaIds: [],
      occupiedAreaIds: [],
    });
  });
  it.each([
    { type: "meeting_room" as const },
    { floorId: uuid(99) },
    { archived: true },
  ])("rejects a referenced invalid desk %#", (change) => {
    const { document, context } = setup();
    context.spaces = context.spaces.map((value) =>
      value.id === deskId ? { ...value, ...change } : value,
    );
    expect(diffSeats(document, context)).toBeNull();
  });
  it("rejects a new unnamed seat, ambiguous area, missing area, and duplicate ID", () => {
    const { document, context } = setup();
    const next = structuredClone(document);
    next.seats[0]!.spaceId = uuid(999);
    expect(diffSeats(next, context)).toBeNull();
    next.seats[0]!.label = "신규";
    next.seats[0]!.at = [10000, 1000];
    expect(diffSeats(next, context)).toBeNull();
    next.seats[0]!.at = [1000, 1000];
    next.spaces[1]!.polygon = next.spaces[0]!.polygon;
    expect(diffSeats(next, context)).toBeNull();
    document.seats.push({ ...document.seats[0]!, id: "duplicate" });
    expect(diffSeats(document, context)).toBeNull();
  });
  it("uses case-insensitive UUID matching without changing existing IDs", () => {
    const { document, context } = setup();
    document.seats[0]!.spaceId = deskId.toUpperCase();
    document.spaces[0]!.spaceId = areaA.toUpperCase();
    context.spaces = context.spaces.map((value) =>
      value.id === deskId ? { ...value, parentId: areaA.toUpperCase() } : value,
    );
    expect(diffSeats(document, context)?.updated).toEqual([]);
    expect(diffSeats(document, context)?.archived).toEqual([]);
  });
  it("counts only active child desks for first seats, while including every occupied area", () => {
    const { document, context } = setup();
    context.spaces = context.spaces.map((value) =>
      value.id === areaA ? { ...value, bookable: true } : value,
    );
    const result = diffSeats(document, context)!;
    expect(result.firstSeatAreaIds).toEqual([]);
    expect(result.occupiedAreaIds).toEqual([areaA]);
    context.spaces = [
      ...context.spaces,
      row({ id: uuid(8), parentId: areaB, type: "desk", archived: true }),
    ];
    document.seats.push({
      ...document.seats[0]!,
      id: "new",
      spaceId: uuid(9),
      at: [11000, 1000],
      label: "B-01",
    });
    expect(diffSeats(document, context)?.firstSeatAreaIds).toEqual([areaB]);
  });
  it("produces the same pure patches for the three unique-name handoffs", () => {
    const { document, context } = setup();
    context.spaces = [
      ...context.spaces,
      row({ id: uuid(5), type: "desk", parentId: areaA, name: "A-02" }),
    ];
    document.seats.push({
      ...document.seats[0]!,
      id: "second",
      spaceId: uuid(5),
      at: [3000, 1000],
      label: "A-01",
    });
    document.seats[0]!.label = "A-02";
    expect(validatePlan(document, context)).toEqual([]);
    expect(
      diffSeats(document, context)?.updated.map(({ name, previousName }) => [
        previousName,
        name,
      ]),
    ).toEqual([
      ["A-01", "A-02"],
      ["A-02", "A-01"],
    ]);
    document.seats = [
      { ...document.seats[0]!, id: "new", spaceId: uuid(6), label: "A-01" },
    ];
    expect(validatePlan(document, context)).toEqual([]);
    expect(diffSeats(document, context)?.archived).toHaveLength(2);
    expect(diffSeats(document, context)?.created[0]?.name).toBe("A-01");
    document.seats.push({
      ...document.seats[0]!,
      id: "old",
      spaceId: deskId,
      at: [3000, 1000],
      label: "A-30",
    });
    expect(validatePlan(document, context)).toEqual([]);
    expect(diffSeats(document, context)?.updated[0]?.name).toBe("A-30");
    expect(diffSeats(document, context)?.created[0]?.name).toBe("A-01");
  });
  it("does not add non-patch database fields or enforce area capacity", () => {
    const { document, context } = setup();
    document.seats.push({
      ...document.seats[0]!,
      id: "new",
      spaceId: uuid(5),
      at: [3000, 1000],
      label: "A-02",
    });
    const data = {
      ...context,
      spaces: context.spaces.map((space) => ({
        ...space,
        capacity: 1,
        amenities: ["monitor"],
        bookingRules: { unknown: true },
      })),
    };
    expect(diffSeats(document, data)?.created).toEqual([
      { id: uuid(5), shapeId: "new", name: "A-02", parentId: areaA },
    ]);
    expect(diffSeats(document, data)?.updated).toEqual([]);
  });
  it("keeps all 24 existing Gangnam 7F seats unchanged", () => {
    const seed = loadSeedData();
    const plan = seed.floorPlans.find(
      (plan) => plan.document.seats.length === 24,
    )!;
    const context: PlanContext = {
      floorId: plan.floorId,
      floorAccess: "everyone",
      floorAllowedTeamIds: [],
      spaces: seed.spaces
        .filter((space) => space.floorId === plan.floorId)
        .map((space) => ({ ...space, archived: false, allowedTeamIds: [] })),
    };
    const result = diffSeats(floorPlanSchema.parse(plan.document), context)!;
    expect(result.created).toEqual([]);
    expect(result.updated).toEqual([]);
    expect(result.archived).toEqual([]);
    expect(result.firstSeatAreaIds).toEqual([]);
    expect(result.occupiedAreaIds).toHaveLength(1);
  });
});
