import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import photoFile from "@/docs/spec/examples/seed-photos.json";
import { loadSeedData } from "@/lib/seed/data";
import { loadSeedPhotos, parseSeedPhotos } from "@/lib/seed/photos";

const seed = loadSeedData();
const missingId = "00000000-0000-4000-8000-000000000001";
function first<T>(rows: T[]): T {
  const value = rows[0];
  if (value === undefined) throw new Error("Missing photo fixture.");
  return value;
}
type PhotoFile = typeof photoFile;

describe("independent seed photo source", () => {
  it("loads 41 ordered photos for 21 spaces and two branch covers without display-only metadata", () => {
    const data = loadSeedPhotos(seed);
    expect(data.branchCovers).toHaveLength(2);
    expect(data.spacePhotos).toHaveLength(41);
    expect(new Set(data.spacePhotos.map(({ spaceId }) => spaceId)).size).toBe(
      21,
    );
    expect(data).not.toHaveProperty("width");
    expect(data).not.toHaveProperty("height");
    expect(data).not.toHaveProperty("note");
    for (const cover of data.branchCovers)
      expect(Object.keys(cover).sort()).toEqual(["alt", "branchId", "path"]);
    for (const photo of data.spacePhotos)
      expect(Object.keys(photo).sort()).toEqual([
        "alt",
        "path",
        "sortOrder",
        "spaceId",
      ]);
    for (const group of photoFile.spacePhotos)
      expect(
        data.spacePhotos.filter(({ spaceId }) => spaceId === group.spaceId),
      ).toEqual(
        group.photos.map((photo, sortOrder) => ({
          ...photo,
          sortOrder,
          spaceId: group.spaceId,
        })),
      );
  });

  it("references all and only the 29 existing local photo assets", () => {
    const data = loadSeedPhotos(seed);
    const paths = [
      ...new Set(
        [...data.branchCovers, ...data.spacePhotos].map(({ path }) => path),
      ),
    ].sort();
    const files = readdirSync(resolve("public/seed/photos"))
      .map((file) => `/seed/photos/${file}`)
      .sort();
    expect(paths).toHaveLength(29);
    expect(files).toEqual(paths);
    for (const path of paths)
      expect(existsSync(resolve("public", `.${path}`))).toBe(true);
  });

  it("keeps review room, S-1 booth and all desks without photos", () => {
    const photos = loadSeedPhotos(seed);
    const withoutPhotos = seed.spaces.filter(
      ({ name, type }) =>
        name === "리뷰룸" || name === "폰부스 S-1" || type === "desk",
    );
    expect(withoutPhotos.some(({ name }) => name === "리뷰룸")).toBe(true);
    expect(withoutPhotos.some(({ name }) => name === "폰부스 S-1")).toBe(true);
    for (const space of withoutPhotos)
      expect(
        photos.spacePhotos.some(({ spaceId }) => spaceId === space.id),
      ).toBe(false);
  });

  it("accepts no photos or covers and does not mutate the source file or original seed contract", () => {
    const input = structuredClone(photoFile);
    const before = structuredClone(input);
    const data = parseSeedPhotos(input, seed);
    first(data.spacePhotos).alt = "다른 설명";
    expect(input).toEqual(before);
    expect(loadSeedData()).not.toHaveProperty("spacePhotos");
    expect(
      parseSeedPhotos({ ...input, spacePhotos: [], branchCovers: [] }, seed),
    ).toEqual({ spacePhotos: [], branchCovers: [] });
  });

  const invalidCases: {
    name: string;
    change: (input: PhotoFile) => void;
    path: (string | number)[];
  }[] = [
    {
      name: "unknown root metadata",
      change: (input) => Object.assign(input, { unknown: true }),
      path: [],
    },
    {
      name: "unknown branch property",
      change: (input) =>
        Object.assign(first(input.branchCovers), { unknown: true }),
      path: ["branchCovers", 0],
    },
    {
      name: "unknown space property",
      change: (input) =>
        Object.assign(first(input.spacePhotos), { unknown: true }),
      path: ["spacePhotos", 0],
    },
    {
      name: "unknown nested photo property",
      change: (input) =>
        Object.assign(first(first(input.spacePhotos).photos), {
          unknown: true,
        }),
      path: ["spacePhotos", 0, "photos", 0],
    },
    {
      name: "unknown branch reference",
      change: (input) => {
        first(input.branchCovers).branchId = missingId;
      },
      path: ["branchCovers", 0, "branchId"],
    },
    {
      name: "unknown space reference",
      change: (input) => {
        first(input.spacePhotos).spaceId = missingId;
      },
      path: ["spacePhotos", 0, "spaceId"],
    },
    {
      name: "desk photo reference",
      change: (input) => {
        first(input.spacePhotos).spaceId = seed.spaces.find(
          ({ type }) => type === "desk",
        )!.id;
      },
      path: ["spacePhotos", 0, "spaceId"],
    },
    {
      name: "eleven photos",
      change: (input) => {
        first(input.spacePhotos).photos = Array.from(
          { length: 11 },
          (_, index) => ({ path: `/seed/photos/a-${index}.webp`, alt: "사진" }),
        );
      },
      path: ["spacePhotos", 0, "photos"],
    },
    {
      name: "duplicate path in one space",
      change: (input) => {
        first(input.spacePhotos).photos.push({
          ...first(first(input.spacePhotos).photos),
        });
      },
      path: ["spacePhotos", 0, "photos", 2, "path"],
    },
    {
      name: "duplicate space group",
      change: (input) => {
        input.spacePhotos.push(structuredClone(first(input.spacePhotos)));
      },
      path: ["spacePhotos", 21, "spaceId"],
    },
    {
      name: "duplicate branch cover",
      change: (input) => {
        input.branchCovers.push({ ...first(input.branchCovers) });
      },
      path: ["branchCovers", 2, "branchId"],
    },
    {
      name: "remote photo",
      change: (input) => {
        first(first(input.spacePhotos).photos).path =
          "https://example.com/a.webp";
      },
      path: ["spacePhotos", 0, "photos", 0, "path"],
    },
    {
      name: "empty alt text",
      change: (input) => {
        first(first(input.spacePhotos).photos).alt = "";
      },
      path: ["spacePhotos", 0, "photos", 0, "alt"],
    },
    {
      name: "invalid metadata dimensions",
      change: (input) => {
        input.width = 0;
      },
      path: ["width"],
    },
  ];
  it.each(invalidCases)(
    "rejects $name at its source path",
    ({ change, path }) => {
      const input = structuredClone(photoFile);
      change(input);
      try {
        parseSeedPhotos(input, seed);
        expect.fail("Invalid photo seed must be rejected.");
      } catch (error) {
        expect(error).toBeInstanceOf(z.ZodError);
        if (!(error instanceof z.ZodError)) throw error;
        expect(error.issues.map(({ path }) => path)).toContainEqual(path);
      }
    },
  );
});
