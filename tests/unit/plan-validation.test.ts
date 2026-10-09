import { describe, expect, it } from "vitest";
import { validatePlan, type PlanContext } from "@/lib/floor-plan/validate";
import type { FloorPlanDocument, PlanPoint } from "@/lib/floor-plan/types";
import { loadSeedData } from "@/lib/seed/data";
import { loadSeedPlans } from "@/lib/seed/seed-plans";
import { floorPlanSchema } from "@/lib/floor-plan/schema";
import { createStressDocument } from "@/lib/floor-plan/render/stress-document";

const floorId = "floor";
const id = "00000000-0000-4000-8000-000000000001";
const square = (x = 0): PlanPoint[] => [
  [x, 0],
  [x + 1000, 0],
  [x + 1000, 1000],
  [x, 1000],
];
const space = (
  overrides: Partial<PlanContext["spaces"][number]> = {},
): PlanContext["spaces"][number] => ({
  id,
  floorId,
  parentId: null,
  type: "meeting_room",
  name: "회의실 A",
  bookable: true,
  archived: false,
  access: null,
  allowedTeamIds: [],
  ...overrides,
});
const context = (overrides: Partial<PlanContext> = {}): PlanContext => ({
  floorId,
  floorAccess: "everyone",
  floorAllowedTeamIds: [],
  spaces: [space()],
  ...overrides,
});
const document = (): FloorPlanDocument => ({
  schema: 1,
  unit: "mm",
  bounds: { w: 10000, h: 10000 },
  walls: [],
  openings: [],
  seats: [],
  fixtures: [],
  spaces: [
    { id: "a", spaceId: id, polygon: square(), label: { at: [500, 500] } },
  ],
});

describe("seed plan publication validation", () => {
  const seed = loadSeedData();
  const plans = [...seed.floorPlans, ...loadSeedPlans(seed)];
  it("covers all eleven distinct seed floors", () => {
    expect(plans).toHaveLength(11);
    expect(new Set(plans.map(({ floorId }) => floorId)).size).toBe(11);
  });
  it.each(plans)("has no blocking issues in $floorId", (plan) => {
    const floor = seed.floors.find(({ id }) => id === plan.floorId)!;
    const grants = (type: "floor" | "space", id: string) =>
      seed.accessGrants
        .filter(
          ({ targetType, targetId }) => targetType === type && targetId === id,
        )
        .map(({ teamId }) => teamId);
    expect(
      validatePlan(floorPlanSchema.parse(plan.document), {
        floorId: floor.id,
        floorAccess: floor.access,
        floorAllowedTeamIds: grants("floor", floor.id),
        spaces: seed.spaces
          .filter(({ floorId }) => floorId === floor.id)
          .map((row) => ({
            ...row,
            archived: false,
            allowedTeamIds: grants("space", row.id),
          })),
      }),
    ).toEqual([]);
  });
});

describe("validatePlan", () => {
  it("accepts a complete plan without mutating inputs", () => {
    const doc = document();
    const ctx = context();
    const before = structuredClone({ doc, ctx });
    expect(validatePlan(doc, ctx)).toEqual([]);
    expect({ doc, ctx }).toEqual(before);
  });
  it.each([
    ["SPACE_UNKNOWN", []],
    ["SPACE_OTHER_FLOOR", [space({ floorId: "other" })]],
    ["SPACE_ARCHIVED", [space({ archived: true })]],
    ["SPACE_IS_DESK", [space({ type: "desk" })]],
  ] as const)("reports %s for invalid references", (code, spaces) => {
    expect(validatePlan(document(), context({ spaces }))).toContainEqual(
      expect.objectContaining({ code, shapeId: "a" }),
    );
    expect(
      validatePlan(document(), context()).some((issue) => issue.code === code),
    ).toBe(false);
  });
  it("requires unbookable lounges but not archived, foreign-floor or desk shapes", () => {
    const doc = document();
    doc.spaces = [];
    const rows = [
      space({ type: "lounge", bookable: false }),
      space({ id: "b", archived: true }),
      space({ id: "c", floorId: "other" }),
      space({ id: "d", type: "desk" }),
    ];
    expect(validatePlan(doc, context({ spaces: rows }))).toEqual([
      {
        code: "SHAPE_MISSING",
        message: "회의실 A: 연결된 공간 도형이 없어요.",
      },
    ]);
  });
  it.each(["spaces", "fixtures"] as const)(
    "validates simple polygons and minimum area in %s",
    (kind) => {
      const doc = document();
      if (kind === "fixtures")
        doc.fixtures.push({
          id: "f",
          kind: "core",
          polygon: square(2000),
          label: "코어",
        });
      const shape = doc[kind][0]!;
      const shapeId = shape.id;
      expect(validatePlan(doc, context())).toEqual([]);
      shape.polygon = [
        [0, 0],
        [1000, 1000],
        [0, 1000],
        [1000, 0],
      ];
      expect(validatePlan(doc, context())).toContainEqual(
        expect.objectContaining({ code: "POLYGON_SELF_INTERSECT", shapeId }),
      );
      shape.polygon = [
        [0, 0],
        [999, 0],
        [999, 500],
        [0, 500],
      ];
      expect(validatePlan(doc, context())).toContainEqual(
        expect.objectContaining({ code: "POLYGON_TOO_SMALL", shapeId }),
      );
      shape.polygon = [
        [0, 0],
        [1000, 0],
        [1000, 500],
        [0, 500],
      ];
      expect(
        validatePlan(doc, context()).some(
          (issue) => issue.code === "POLYGON_TOO_SMALL",
        ),
      ).toBe(false);
    },
  );
  it.each(
    (
      [
        [0, 500],
        [0, 0],
        [1500, 500],
      ] satisfies PlanPoint[]
    ).map((point) => ({ point })),
  )("rejects exterior or boundary label $point", ({ point }) => {
    const doc = document();
    doc.spaces[0]!.label.at = point;
    expect(validatePlan(doc, context())).toContainEqual(
      expect.objectContaining({ code: "LABEL_OUTSIDE", shapeId: "a" }),
    );
  });
  it("reports each overlapping pair once on the later shape, including fixtures but not fixture pairs", () => {
    const doc = document();
    doc.spaces.push({
      id: "b",
      spaceId: "b",
      polygon: square(),
      label: { at: [500, 500] },
    });
    doc.fixtures.push(
      { id: "f1", kind: "core", polygon: square() },
      { id: "f2", kind: "stairs", polygon: square() },
    );
    const result = validatePlan(
      doc,
      context({ spaces: [space(), space({ id: "b", name: "회의실 B" })] }),
    );
    expect(result.map(({ code, shapeId }) => ({ code, shapeId }))).toEqual([
      { code: "SPACE_OVERLAP", shapeId: "b" },
      { code: "SPACE_OVERLAP", shapeId: "f1" },
      { code: "SPACE_OVERLAP", shapeId: "f1" },
      { code: "SPACE_OVERLAP", shapeId: "f2" },
      { code: "SPACE_OVERLAP", shapeId: "f2" },
    ]);
    doc.spaces[1]!.polygon = square(1000);
    doc.spaces[1]!.label.at = [1500, 500];
    doc.fixtures = [];
    expect(
      validatePlan(doc, context({ spaces: [space(), space({ id: "b" })] })),
    ).toEqual([]);
  });
  it("checks empty floor and space grants and names the space", () => {
    const ctx = context({
      floorAccess: "teams",
      spaces: [space({ access: "teams" })],
    });
    expect(validatePlan(document(), ctx)).toEqual([
      {
        code: "ACCESS_TEAMS_EMPTY",
        message: "층의 이용 대상이 '지정한 팀'인데 허용 팀이 없어요.",
      },
      {
        code: "ACCESS_TEAMS_EMPTY",
        shapeId: "a",
        message: "회의실 A: 이용 대상이 '지정한 팀'인데 허용 팀이 없어요.",
      },
    ]);
    ctx.floorAllowedTeamIds = ["team"];
    ctx.spaces = [space({ access: "teams", allowedTeamIds: ["team"] })];
    expect(validatePlan(document(), ctx)).toEqual([]);
  });
  it.each(["everyone", "teams"] as const)(
    "blocks %s access wider than a teams floor",
    (access) => {
      const ctx = context({
        floorAccess: "teams",
        floorAllowedTeamIds: ["a"],
        spaces: [space({ access, allowedTeamIds: ["b"] })],
      });
      expect(validatePlan(document(), ctx)).toContainEqual(
        expect.objectContaining({
          code: "ACCESS_WIDER_THAN_FLOOR",
          shapeId: "a",
        }),
      );
      for (const floorAccess of ["everyone", "closed"] as const)
        expect(validatePlan(document(), { ...ctx, floorAccess })).toEqual([]);
    },
  );
  it.each([null, "closed"] as const)(
    "allows inherited or narrower %s access",
    (access) => {
      expect(
        validatePlan(
          document(),
          context({
            floorAccess: "teams",
            floorAllowedTeamIds: ["a"],
            spaces: [space({ access })],
          }),
        ),
      ).toEqual([]);
    },
  );
  it("does not compare foreign or archived access settings with this floor", () => {
    const result = validatePlan(
      document(),
      context({
        floorAccess: "teams",
        floorAllowedTeamIds: ["a"],
        spaces: [space({ floorId: "other", access: "everyone" })],
      }),
    );
    expect(result.map(({ code }) => code)).toEqual(["SPACE_OTHER_FLOOR"]);
  });
  it("compares UUID references without case sensitivity", () => {
    const doc = document();
    doc.spaces[0]!.spaceId = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
    expect(
      validatePlan(
        doc,
        context({
          spaces: [space({ id: doc.spaces[0]!.spaceId.toLowerCase() })],
        }),
      ),
    ).toEqual([]);
  });
  it("validates a 2,000-seat and 300-space document within 200ms", () => {
    const doc = floorPlanSchema.parse(createStressDocument());
    const ctx = context({
      spaces: [
        ...doc.spaces.map(({ spaceId }, index) =>
          space({
            id: spaceId,
            name: `공간 ${index}`,
            type: "desk_area",
            bookable: false,
          }),
        ),
        ...doc.seats.map(({ spaceId }, index) =>
          space({
            id: spaceId,
            name: `좌석 ${index}`,
            type: "desk",
            parentId: doc.spaces[index % 300]!.spaceId,
          }),
        ),
      ],
    });
    const before = performance.now();
    expect(validatePlan(doc, ctx)).toEqual([]);
    expect(performance.now() - before).toBeLessThan(200);
    expect(doc.seats).toHaveLength(2000);
  });
});
