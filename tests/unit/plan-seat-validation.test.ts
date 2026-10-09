import { describe, expect, it } from "vitest";
import { floorPlanSchema, seatLabelSchema } from "@/lib/floor-plan/schema";
import {
  hydrateSeatLabels,
  seatAreaOf,
  seatDisplayName,
} from "@/lib/floor-plan/seats";
import {
  isBlockingPlanIssue,
  type PlanIssueCode,
} from "@/lib/floor-plan/issues";
import {
  rotatedRectangleBounds,
  rotatedRectanglesOverlap,
} from "@/lib/floor-plan/geometry";
import { validatePlan, type PlanContext } from "@/lib/floor-plan/validate";
import type { FloorPlanDocument, PlanSeat } from "@/lib/floor-plan/types";

const uuid = (n: number) =>
  `aaaaaaaa-aaaa-4aaa-8aaa-${n.toString(16).padStart(12, "0")}`;
const floorId = uuid(1);
const areaId = uuid(2);
function row(
  overrides: Partial<PlanContext["spaces"][number]> = {},
): PlanContext["spaces"][number] {
  return {
    id: areaId,
    floorId,
    parentId: null,
    name: "오픈 데스크",
    type: "desk_area",
    archived: false,
    bookable: false,
    access: null,
    allowedTeamIds: [],
    ...overrides,
  };
}
function seat(index = 0, overrides: Partial<PlanSeat> = {}): PlanSeat {
  return {
    id: `seat-${index}`,
    spaceId: uuid(index + 100),
    at: [1000 + index * 1500, 1000],
    size: [1400, 700],
    rotation: 0,
    ...overrides,
  };
}
function setup() {
  const document: FloorPlanDocument = {
    schema: 1,
    unit: "mm",
    bounds: { w: 20000, h: 20000 },
    walls: [],
    openings: [],
    fixtures: [],
    spaces: [
      {
        id: "area",
        spaceId: areaId,
        polygon: [
          [0, 0],
          [10000, 0],
          [10000, 10000],
          [0, 10000],
        ],
        label: { at: [5000, 5000] },
      },
    ],
    seats: [seat()],
  };
  const context: PlanContext = {
    floorId,
    floorAccess: "everyone",
    floorAllowedTeamIds: [],
    spaces: [
      row(),
      row({
        id: uuid(100),
        parentId: areaId,
        type: "desk",
        name: "A-01",
        bookable: true,
      }),
    ],
  };
  return { document, context };
}
const codeList = (document: FloorPlanDocument, context: PlanContext) =>
  validatePlan(document, context).map((issue) => issue.code);

describe("seat label schema and hydration", () => {
  it.each(["A", "가".repeat(20), "  A-01  "])(
    "accepts and trims %s",
    (label) => {
      const { document } = setup();
      document.seats[0]!.label = label;
      expect(floorPlanSchema.parse(document).seats[0]!.label).toBe(
        label.trim(),
      );
      expect(seatLabelSchema.parse(label)).toBe(label.trim());
    },
  );
  it.each(["", "   ", "가".repeat(21), "A\0B", "\0A", "A\0"])(
    "rejects invalid label %#",
    (label) => {
      const { document } = setup();
      document.seats[0]!.label = label;
      expect(floorPlanSchema.safeParse(document).success).toBe(false);
    },
  );
  it("keeps legacy labels optional without changing schema version or size/angle limits", () => {
    const { document } = setup();
    document.seats[0]!.size = [Number.MAX_SAFE_INTEGER, 1];
    document.seats[0]!.rotation = -721;
    expect(floorPlanSchema.parse(document)).toEqual(document);
    expect("label" in floorPlanSchema.parse(document).seats[0]!).toBe(false);
  });
  it("uses explicit label before the database name, or null for a new unnamed seat", () => {
    expect(seatDisplayName(seat(0, { label: "B-01" }), { name: "A-01" })).toBe(
      "B-01",
    );
    expect(seatDisplayName(seat(), { name: "A-01" })).toBe("A-01");
    expect(seatDisplayName(seat())).toBeNull();
  });
  it("hydrates only missing valid labels without mutating source or unrelated arrays", () => {
    const { document, context } = setup();
    document.seats[0]!.spaceId = document.seats[0]!.spaceId.toUpperCase();
    const before = structuredClone(document);
    const hydrated = hydrateSeatLabels(document, context.spaces);
    expect(hydrated.seats[0]!.label).toBe("A-01");
    expect(hydrated.spaces).toBe(document.spaces);
    expect(document).toEqual(before);
    expect(hydrateSeatLabels(hydrated, context.spaces)).toBe(hydrated);
  });
  it.each(["x".repeat(21), "x".repeat(40), "bad\0name", "  "])(
    "leaves an incompatible DB name intact as fallback %#",
    (name) => {
      const { document, context } = setup();
      const rows = context.spaces.map((value) =>
        value.type === "desk" ? { ...value, name } : value,
      );
      expect(hydrateSeatLabels(document, rows)).toBe(document);
      expect(seatDisplayName(document.seats[0]!, rows[1])).toBe(name);
    },
  );
  it("preserves explicit labels and unknown IDs", () => {
    const { document, context } = setup();
    document.seats = [seat(0, { label: "B-01" }), seat(1)];
    expect(hydrateSeatLabels(document, context.spaces)).toBe(document);
  });
});

describe("seat publication validation", () => {
  it("accepts existing names and new labels without changing input", () => {
    const { document, context } = setup();
    document.seats.push(seat(1, { label: "A-02" }));
    const before = structuredClone({ document, context });
    expect(validatePlan(document, context)).toEqual([]);
    expect({ document, context }).toEqual(before);
  });
  it.each([
    [0, 1000],
    [10000, 1000],
    [11000, 1000],
    [0, 0],
  ] as const)("rejects exterior/boundary seat center %j", (x, y) => {
    const { document, context } = setup();
    document.seats[0]!.at = [x, y];
    expect(codeList(document, context)).toContain("SEAT_OUTSIDE_AREA");
    expect(seatAreaOf(document.seats[0]!, document, context)).toBeNull();
  });
  it("tests the center only, not the footprint or parent capacity", () => {
    const { document, context } = setup();
    document.seats[0]!.size = [30000, 30000];
    expect(validatePlan(document, context)).toEqual([]);
    expect(seatAreaOf(document.seats[0]!, document, context)?.id).toBe(areaId);
  });
  it("rejects a center contained by two areas", () => {
    const { document, context } = setup();
    document.spaces.push({
      ...document.spaces[0]!,
      id: "other-area",
      spaceId: uuid(3),
    });
    context.spaces = [
      ...context.spaces,
      row({ id: uuid(3), name: "다른 구역" }),
    ];
    expect(codeList(document, context)).toContain("SEAT_OUTSIDE_AREA");
  });
  it.each([
    { archived: true },
    { floorId: uuid(999) },
    { type: "meeting_room" as const },
  ])("does not use an invalid desk area %#", (change) => {
    const { document, context } = setup();
    context.spaces = context.spaces.map((value) =>
      value.id === areaId ? { ...value, ...change } : value,
    );
    expect(codeList(document, context)).toContain("SEAT_OUTSIDE_AREA");
  });
  it("does not resolve self-intersecting area polygons", () => {
    const { document, context } = setup();
    document.spaces[0]!.polygon = [
      [0, 0],
      [10000, 10000],
      [0, 10000],
      [10000, 0],
    ];
    expect(seatAreaOf(document.seats[0]!, document, context)).toBeNull();
  });
  it("requires a name only when no DB row exists", () => {
    const { document, context } = setup();
    expect(codeList(document, context)).not.toContain("SEAT_LABEL_MISSING");
    document.seats.push(seat(1));
    expect(validatePlan(document, context)).toContainEqual(
      expect.objectContaining({
        code: "SEAT_LABEL_MISSING",
        shapeId: "seat-1",
      }),
    );
    document.seats[1]!.label = "A-02";
    expect(validatePlan(document, context)).toEqual([]);
  });
  it.each([{ type: "meeting_room" as const }, { floorId: uuid(999) }])(
    "rejects a non-desk or foreign desk %#",
    (change) => {
      const { document, context } = setup();
      context.spaces = context.spaces.map((value) =>
        value.type === "desk" ? { ...value, ...change } : value,
      );
      expect(codeList(document, context)).toContain("SEAT_NOT_DESK");
      expect(codeList(document, context)).not.toContain("SEAT_LABEL_MISSING");
    },
  );
  it("blocks archived seats rather than reviving them", () => {
    const { document, context } = setup();
    context.spaces = context.spaces.map((value) =>
      value.type === "desk" ? { ...value, archived: true } : value,
    );
    expect(codeList(document, context)).toContain("SEAT_ARCHIVED");
  });
  it("compares final seat names without case sensitivity", () => {
    const { document, context } = setup();
    document.seats.push(seat(1, { label: "a-01" }));
    expect(
      codeList(document, context).filter(
        (code) => code === "SEAT_LABEL_DUPLICATE",
      ),
    ).toHaveLength(2);
    document.seats[1]!.label = "A-02";
    expect(validatePlan(document, context)).toEqual([]);
  });
  it("compares non-desk active names such as 라운지, but ignores archived and other-floor names", () => {
    const { document, context } = setup();
    document.seats[0]!.label = "라운지";
    const lounge = row({ id: uuid(3), type: "lounge", name: "라운지" });
    context.spaces = [...context.spaces, lounge];
    expect(codeList(document, context)).toContain("SEAT_LABEL_DUPLICATE");
    for (const change of [{ archived: true }, { floorId: uuid(999) }]) {
      expect(
        codeList(document, {
          ...context,
          spaces: [...context.spaces.slice(0, 2), { ...lounge, ...change }],
        }),
      ).not.toContain("SEAT_LABEL_DUPLICATE");
    }
  });
  it("allows name swaps, deleted name reuse, and renaming A-01 plus creating new A-01", () => {
    const { document, context } = setup();
    context.spaces = [
      ...context.spaces,
      row({ id: uuid(101), parentId: areaId, type: "desk", name: "A-02" }),
    ];
    document.seats = [seat(0, { label: "A-02" }), seat(1, { label: "A-01" })];
    expect(validatePlan(document, context)).toEqual([]);
    document.seats = [seat(2, { label: "A-01" })];
    expect(validatePlan(document, context)).toEqual([]);
    document.seats = [seat(0, { label: "A-30" }), seat(2, { label: "A-01" })];
    expect(validatePlan(document, context)).toEqual([]);
  });
  it("matches UUID references case-insensitively", () => {
    const { document, context } = setup();
    document.seats[0]!.spaceId = document.seats[0]!.spaceId.toUpperCase();
    document.spaces[0]!.spaceId = areaId.toUpperCase();
    expect(validatePlan(document, context)).toEqual([]);
  });
  it("reports one warning when the last active desk leaves its area", () => {
    const { document, context } = setup();
    document.seats = [];
    const issues = validatePlan(document, context);
    expect(issues).toEqual([
      {
        code: "SPACE_NO_SEATS",
        shapeId: "area",
        message: expect.stringContaining("오픈 데스크"),
      },
    ]);
    expect(issues.some(isBlockingPlanIssue)).toBe(false);
    context.spaces = context.spaces.filter((value) => value.type !== "desk");
    expect(validatePlan(document, context)).toEqual([]);
  });
  it.each([
    "SEAT_OUTSIDE_AREA",
    "SEAT_OVERLAP",
    "SEAT_LABEL_MISSING",
    "SEAT_LABEL_DUPLICATE",
    "SEAT_ARCHIVED",
    "SEAT_NOT_DESK",
    "AREA_HAS_BOOKINGS",
    "SEAT_REMOVED_WITH_BOOKINGS",
  ] satisfies PlanIssueCode[])("blocks %s", (code) => {
    expect(isBlockingPlanIssue({ code, message: "검사" })).toBe(true);
  });
  it("detects rotated overlap but accepts touching seats", () => {
    const { document, context } = setup();
    document.seats.push(seat(1, { at: [2399, 1000], label: "A-02" }));
    expect(
      codeList(document, context).filter((code) => code === "SEAT_OVERLAP"),
    ).toHaveLength(2);
    document.seats[1]!.at = [2400, 1000];
    expect(validatePlan(document, context)).toEqual([]);
    document.seats[1]!.at = [1800, 1000];
    document.seats[1]!.rotation = 90;
    expect(codeList(document, context)).toContain("SEAT_OVERLAP");
  });
  it("bounds dense 2,000-seat issues and time without skipping independent checks", () => {
    const { document, context } = setup();
    document.seats = Array.from({ length: 2000 }, (_, index) =>
      seat(index, { at: [1000, 1000], label: `S-${index}` }),
    );
    document.seats[1999] = seat(1999, { at: [1000, 1000] });
    const before = performance.now();
    const issues = validatePlan(document, context);
    const elapsed = performance.now() - before;
    expect(issues.filter(({ code }) => code === "SEAT_OVERLAP")).toHaveLength(
      2000,
    );
    expect(
      issues.filter(({ code }) => code === "SEAT_LABEL_MISSING"),
    ).toHaveLength(1);
    expect(issues).toHaveLength(2001);
    expect(elapsed).toBeLessThan(200);
  });
});

describe("stable seat SAT at schema-accepted extreme sizes", () => {
  it.each([0, 90, 180, 270, -90, 450, 17, 107, 197, 287])(
    "does not collapse a narrow edge beside a huge one at %i degrees",
    (rotation) => {
      const a = seat(0, {
        at: [5000, 5000],
        size: [Number.MAX_SAFE_INTEGER, 1],
        rotation,
      });
      const b = { ...a, at: [5000, 5010] as [number, number] };
      expect(rotatedRectanglesOverlap(a, a)).toBe(true);
      expect(rotatedRectanglesOverlap(a, b)).toBe(
        rotation % 180 === 90 || rotation === -90,
      );
      expect(
        Object.values(rotatedRectangleBounds(a)).every(Number.isFinite),
      ).toBe(true);
    },
  );
  it("handles odd dimensions and cardinal edge contact exactly", () => {
    const a = seat(0, { at: [1000, 1000], size: [3, 1], rotation: 90 });
    const b = { ...a, at: [1001, 1000] as [number, number] };
    expect(rotatedRectanglesOverlap(a, b)).toBe(false);
    expect(rotatedRectanglesOverlap(a, { ...b, at: [1000, 1002] })).toBe(true);
  });
});
