import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { z } from "zod";
import manifest from "@/docs/spec/examples/seed-plans.json";
import { loadSeedData } from "@/lib/seed/data";
import { loadSeedPlans, parseSeedPlans } from "@/lib/seed/plans";
import type { FloorPlanDocument } from "@/lib/floor-plan/types";

const seed = loadSeedData();
const documents = Object.fromEntries(
  manifest.floorPlans.map(({ documentFile }) => [
    documentFile,
    JSON.parse(
      readFileSync(`docs/spec/examples/${documentFile}`, "utf8"),
    ) as FloorPlanDocument,
  ]),
);
const missing = "00000000-0000-4000-8000-000000000001";

describe("additional seed floor plans", () => {
  it("validates ten documents and covers exactly eleven floors together with the untouched original seed", () => {
    const before = structuredClone(seed);
    const added = loadSeedPlans(seed);
    expect(added).toHaveLength(10);
    expect(
      new Set([...seed.floorPlans, ...added].map(({ floorId }) => floorId)),
    ).toEqual(new Set(seed.floors.map(({ id }) => id)));
    for (const row of added) {
      expect(Object.keys(row).sort()).toEqual([
        "createdByKey",
        "document",
        "floorId",
        "id",
        "status",
        "version",
      ]);
      expect(row.document.spaces.map(({ spaceId }) => spaceId).sort()).toEqual(
        seed.spaces
          .filter(
            ({ floorId, type }) => floorId === row.floorId && type !== "desk",
          )
          .map(({ id }) => id)
          .sort(),
      );
      expect(row.document.seats).toEqual([]);
    }
    expect(seed).toEqual(before);
    expect(loadSeedData().floorPlans).toHaveLength(1);
    added[0]!.document.bounds.w += 1;
    expect(loadSeedPlans(seed)[0]!.document.bounds).not.toEqual(
      added[0]!.document.bounds,
    );
  });
  it.each([
    [
      "missing floor document",
      (m: typeof manifest) => {
        m.floorPlans.pop();
      },
    ],
    [
      "unknown root key",
      (m: typeof manifest) => Object.assign(m, { unexpected: true }),
    ],
    [
      "unknown row key",
      (m: typeof manifest) =>
        Object.assign(m.floorPlans[0]!, { unexpected: true }),
    ],
    [
      "unknown floor",
      (m: typeof manifest) => {
        m.floorPlans[0]!.floorId = missing;
      },
    ],
    [
      "missing author",
      (m: typeof manifest) => {
        m.floorPlans[0]!.createdByKey = "missing";
      },
    ],
    [
      "missing file",
      (m: typeof manifest) => {
        m.floorPlans[0]!.documentFile = "plans/missing.plan.json";
      },
    ],
    [
      "path traversal",
      (m: typeof manifest) => {
        m.floorPlans[0]!.documentFile = "../private.json";
      },
    ],
    [
      "duplicate floor",
      (m: typeof manifest) => {
        m.floorPlans.push({ ...m.floorPlans[0]!, id: missing });
      },
    ],
    [
      "duplicate id",
      (m: typeof manifest) => {
        m.floorPlans[1]!.id = m.floorPlans[0]!.id;
      },
    ],
    [
      "original floor overlap",
      (m: typeof manifest) => {
        m.floorPlans[0]!.floorId = seed.floorPlans[0]!.floorId;
      },
    ],
    [
      "original id overlap",
      (m: typeof manifest) => {
        m.floorPlans[0]!.id = seed.floorPlans[0]!.id;
      },
    ],
  ] as const)("rejects %s before DB work", (_, mutate) => {
    const input = structuredClone(manifest);
    mutate(input);
    expect(() => parseSeedPlans(input, seed, documents)).toThrow(z.ZodError);
  });
  it.each([
    [
      "unknown space",
      (doc: FloorPlanDocument) => {
        doc.spaces[0]!.spaceId = missing;
      },
    ],
    [
      "other floor space",
      (doc: FloorPlanDocument) => {
        doc.spaces[0]!.spaceId = seed.spaces.find(
          ({ floorId }) => floorId !== manifest.floorPlans[0]!.floorId,
        )!.id;
      },
    ],
    [
      "missing shape",
      (doc: FloorPlanDocument) => {
        doc.spaces.pop();
      },
    ],
    [
      "malformed geometry",
      (doc: FloorPlanDocument) => {
        doc.spaces[0]!.polygon = [
          [0, 0],
          [1, 1],
        ];
      },
    ],
    [
      "duplicate shape",
      (doc: FloorPlanDocument) => {
        doc.spaces.push(structuredClone(doc.spaces[0]!));
      },
    ],
  ] as const)("rejects %s", (_, mutate) => {
    const input = structuredClone(documents);
    mutate(input[manifest.floorPlans[0]!.documentFile]!);
    expect(() => parseSeedPlans(manifest, seed, input)).toThrow(z.ZodError);
  });
});
