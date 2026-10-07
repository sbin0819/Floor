import { describe, expect, it } from "vitest";

import examplePlan from "@/docs/spec/examples/gangnam-7f.plan.json";
import exampleSpaces from "@/docs/spec/examples/gangnam-7f.spaces.json";
import { floorPlanSchema } from "@/lib/floor-plan/schema";
import type { FloorPlanDocument } from "@/lib/floor-plan/types";

function plan(): FloorPlanDocument {
  return floorPlanSchema.parse(examplePlan);
}

function first<T>(values: T[]): T {
  const value = values[0];
  if (value === undefined)
    throw new Error("The example collection must not be empty.");
  return value;
}

type InvalidCase = {
  name: string;
  change: (document: FloorPlanDocument) => void;
  path: (string | number)[];
};

const requiredFailures: InvalidCase[] = [
  {
    name: "out-of-bounds point",
    change: (document) => {
      first(document.walls).points[0] = [document.bounds.w + 1, 0];
    },
    path: ["walls", 0, "points", 0],
  },
  {
    name: "duplicate shape id across collections",
    change: (document) => {
      first(document.seats).id = first(document.walls).id;
    },
    path: ["seats", 0, "id"],
  },
  {
    name: "polygon with only two vertices",
    change: (document) => {
      first(document.spaces).polygon = [
        [0, 0],
        [1, 1],
      ];
    },
    path: ["spaces", 0, "polygon"],
  },
  {
    name: "opening referring to a missing wall",
    change: (document) => {
      first(document.openings).wallId = "missing-wall";
    },
    path: ["openings", 0, "wallId"],
  },
];

describe("floorPlanSchema examples", () => {
  it("accepts the full example document without changing it", () => {
    expect(floorPlanSchema.parse(examplePlan)).toEqual(examplePlan);
  });

  it("maps every space and seat to an existing row, and every seat to a desk", () => {
    const document = plan();
    const rows = new Map(
      exampleSpaces.spaces.map((space) => [space.id, space]),
    );
    for (const shape of [...document.spaces, ...document.seats]) {
      const row = rows.get(shape.spaceId);
      expect(row, `Missing space ${shape.spaceId}`).toBeDefined();
      expect(row?.floorId).toBe(exampleSpaces.floor.id);
    }
    for (const seat of document.seats) {
      expect(rows.get(seat.spaceId)?.type).toBe("desk");
    }
  });

  it.each(requiredFailures)(
    "rejects $name at the offending path",
    ({ change, path }) => {
      const document = plan();
      change(document);
      const result = floorPlanSchema.safeParse(document);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.map((issue) => issue.path)).toContainEqual(
          path,
        );
      }
    },
  );
});

describe("floorPlanSchema bounds and identity", () => {
  it.each<InvalidCase>([
    {
      name: "negative wall point",
      change: (document) => {
        first(document.walls).points[0] = [-1, 0];
      },
      path: ["walls", 0, "points", 0],
    },
    {
      name: "space polygon point",
      change: (document) => {
        first(document.spaces).polygon[0] = [0, document.bounds.h + 1];
      },
      path: ["spaces", 0, "polygon", 0],
    },
    {
      name: "space label",
      change: (document) => {
        first(document.spaces).label.at = [0, -1];
      },
      path: ["spaces", 0, "label", "at"],
    },
    {
      name: "seat center",
      change: (document) => {
        first(document.seats).at = [document.bounds.w + 1, 0];
      },
      path: ["seats", 0, "at"],
    },
    {
      name: "fixture polygon",
      change: (document) => {
        first(document.fixtures).polygon[0] = [-1, 0];
      },
      path: ["fixtures", 0, "polygon", 0],
    },
    {
      name: "duplicate space reference",
      change: (document) => {
        document.spaces.push({
          ...first(document.spaces),
          id: "new-space-shape",
        });
      },
      path: ["spaces", examplePlan.spaces.length, "spaceId"],
    },
    {
      name: "duplicate seat reference",
      change: (document) => {
        document.seats.push({ ...first(document.seats), id: "new-seat-shape" });
      },
      path: ["seats", examplePlan.seats.length, "spaceId"],
    },
  ])("rejects $name", ({ change, path }) => {
    const document = plan();
    change(document);
    const result = floorPlanSchema.safeParse(document);
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues.map((issue) => issue.path)).toContainEqual(
        path,
      );
  });

  it("accepts points on the boundary and checks only a seat center, not its footprint", () => {
    const document = plan();
    first(document.seats).at = [document.bounds.w, document.bounds.h];
    first(document.seats).size = [document.bounds.w * 2, document.bounds.h * 2];
    expect(floorPlanSchema.safeParse(document).success).toBe(true);
  });

  it.each(["spaces", "seats"] as const)(
    "rejects duplicate UUID identities with different casing in %s",
    (collection) => {
      const document = plan();
      const spaceId = "a7b81c23-0d2e-4f56-89ab-cdef01234567";
      const [firstShape, secondShape] = document[collection];
      if (!firstShape || !secondShape)
        throw new Error("The example collection must have two shapes.");
      firstShape.spaceId = spaceId;
      secondShape.spaceId = spaceId.toUpperCase();

      const result = floorPlanSchema.safeParse(document);
      expect(result.success).toBe(false);
      if (!result.success)
        expect(result.error.issues.map((issue) => issue.path)).toContainEqual([
          collection,
          1,
          "spaceId",
        ]);
    },
  );

  it.each(["spaces", "seats"] as const)(
    "preserves original UUID casing in a valid %s document",
    (collection) => {
      const document = plan();
      const spaceId = "A7B81C23-0D2E-4F56-89AB-CDEF01234567";
      const firstShape = document[collection][0];
      if (!firstShape)
        throw new Error("The example collection must not be empty.");
      firstShape.spaceId = spaceId;

      const parsed = floorPlanSchema.parse(document);
      expect(parsed).toEqual(document);
      expect(parsed[collection][0]?.spaceId).toBe(spaceId);
    },
  );

  it("accepts required empty arrays and an omitted background", () => {
    expect(
      floorPlanSchema.safeParse({
        schema: 1,
        unit: "mm",
        bounds: { w: 1, h: 1 },
        walls: [],
        openings: [],
        spaces: [],
        seats: [],
        fixtures: [],
      }).success,
    ).toBe(true);
  });
});

describe("floorPlanSchema structural validation", () => {
  const invalidValues: {
    name: string;
    change: (document: FloorPlanDocument) => unknown;
  }[] = [
    {
      name: "noninteger coordinate",
      change: (document) => {
        first(document.walls).points[0] = [0.5, 0];
        return document;
      },
    },
    {
      name: "noninteger bounds",
      change: (document) => {
        document.bounds.w = 1.5;
        return document;
      },
    },
    {
      name: "zero bounds",
      change: (document) => {
        document.bounds.h = 0;
        return document;
      },
    },
    {
      name: "noninteger thickness",
      change: (document) => {
        first(document.walls).thickness = 1.5;
        return document;
      },
    },
    {
      name: "zero thickness",
      change: (document) => {
        first(document.walls).thickness = 0;
        return document;
      },
    },
    {
      name: "noninteger opening width",
      change: (document) => {
        first(document.openings).width = 1.5;
        return document;
      },
    },
    {
      name: "negative opening width",
      change: (document) => {
        first(document.openings).width = -1;
        return document;
      },
    },
    {
      name: "zero seat width",
      change: (document) => {
        first(document.seats).size[0] = 0;
        return document;
      },
    },
    {
      name: "noninteger seat size",
      change: (document) => {
        first(document.seats).size[1] = 1.5;
        return document;
      },
    },
    {
      name: "noninteger rotation",
      change: (document) => {
        first(document.seats).rotation = 1.5;
        return document;
      },
    },
    {
      name: "wall with one point",
      change: (document) => {
        first(document.walls).points = [[0, 0]];
        return document;
      },
    },
    {
      name: "fixture with two vertices",
      change: (document) => {
        first(document.fixtures).polygon = [
          [0, 0],
          [1, 1],
        ];
        return document;
      },
    },
    {
      name: "empty shape id",
      change: (document) => {
        first(document.walls).id = "";
        return document;
      },
    },
    {
      name: "invalid space UUID",
      change: (document) => {
        first(document.spaces).spaceId = "not-a-uuid";
        return document;
      },
    },
    {
      name: "invalid seat UUID",
      change: (document) => {
        first(document.seats).spaceId = "not-a-uuid";
        return document;
      },
    },
    {
      name: "opening position below zero",
      change: (document) => {
        first(document.openings).at = -0.1;
        return document;
      },
    },
    {
      name: "opening position above one",
      change: (document) => {
        first(document.openings).at = 1.1;
        return document;
      },
    },
    {
      name: "opacity below zero",
      change: (document) => ({
        ...document,
        background: { transform: [1, 0, 0, 1, 0, 0], opacity: -0.1 },
      }),
    },
    {
      name: "opacity above one",
      change: (document) => ({
        ...document,
        background: { transform: [1, 0, 0, 1, 0, 0], opacity: 1.1 },
      }),
    },
    {
      name: "transform with five values",
      change: (document) => ({
        ...document,
        background: { transform: [1, 0, 0, 1, 0], opacity: 0.5 },
      }),
    },
    {
      name: "unsupported schema version",
      change: (document) => ({ ...document, schema: 2 }),
    },
    {
      name: "unsupported unit",
      change: (document) => ({ ...document, unit: "cm" }),
    },
    {
      name: "missing required array",
      change: (document) => ({ ...document, walls: undefined }),
    },
    {
      name: "missing space label",
      change: (document) => ({
        ...document,
        spaces: [{ ...first(document.spaces), label: undefined }],
      }),
    },
  ];

  it.each(invalidValues)("rejects $name", ({ change }) => {
    expect(floorPlanSchema.safeParse(change(plan())).success).toBe(false);
  });

  it.each([0, 1])(
    "accepts the inclusive opening/opacity endpoint %s",
    (value) => {
      const document = plan();
      first(document.openings).at = value;
      document.background = { transform: [1, 0, 0, 1, 0, 0], opacity: value };
      expect(floorPlanSchema.safeParse(document).success).toBe(true);
    },
  );

  it.each([
    {
      name: "document",
      addUnknown: (document: FloorPlanDocument) => ({
        ...document,
        unexpected: true,
      }),
    },
    {
      name: "bounds",
      addUnknown: (document: FloorPlanDocument) => ({
        ...document,
        bounds: { ...document.bounds, unexpected: true },
      }),
    },
    {
      name: "wall",
      addUnknown: (document: FloorPlanDocument) => ({
        ...document,
        walls: [{ ...first(document.walls), unexpected: true }],
      }),
    },
    {
      name: "opening",
      addUnknown: (document: FloorPlanDocument) => ({
        ...document,
        openings: [{ ...first(document.openings), unexpected: true }],
      }),
    },
    {
      name: "space",
      addUnknown: (document: FloorPlanDocument) => ({
        ...document,
        spaces: [{ ...first(document.spaces), unexpected: true }],
      }),
    },
    {
      name: "space label",
      addUnknown: (document: FloorPlanDocument) => ({
        ...document,
        spaces: [
          {
            ...first(document.spaces),
            label: { at: [0, 0], unexpected: true },
          },
        ],
      }),
    },
    {
      name: "seat",
      addUnknown: (document: FloorPlanDocument) => ({
        ...document,
        seats: [{ ...first(document.seats), unexpected: true }],
      }),
    },
    {
      name: "fixture",
      addUnknown: (document: FloorPlanDocument) => ({
        ...document,
        fixtures: [{ ...first(document.fixtures), unexpected: true }],
      }),
    },
    {
      name: "background",
      addUnknown: (document: FloorPlanDocument) => ({
        ...document,
        background: {
          transform: [1, 0, 0, 1, 0, 0],
          opacity: 0.5,
          storageKey: "not-in-document",
        },
      }),
    },
  ])("rejects an unknown key in $name", ({ addUnknown }) => {
    const result = floorPlanSchema.safeParse(addUnknown(plan()));
    expect(result.success).toBe(false);
    if (!result.success)
      expect(
        result.error.issues.some((issue) => issue.code === "unrecognized_keys"),
      ).toBe(true);
  });
});
