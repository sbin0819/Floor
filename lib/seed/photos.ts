import { z } from "zod";
import photoFile from "@/docs/spec/examples/seed-photos.json";
import { photoSchema } from "@/lib/photos/schema";
import type { SeedData } from "@/lib/seed/data";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const seedPhotoFileSchema = z.strictObject({
  note: z.string(),
  width: z.int().positive(),
  height: z.int().positive(),
  branchCovers: z.array(
    z.strictObject({ branchId: uuid, name: z.string(), ...photoSchema.shape }),
  ),
  spacePhotos: z.array(
    z.strictObject({
      spaceId: uuid,
      name: z.string(),
      photos: z.array(photoSchema).max(10),
    }),
  ),
});

export function parseSeedPhotos(
  input: unknown,
  seed: Pick<SeedData, "branches" | "spaces">,
) {
  const schema = seedPhotoFileSchema.superRefine((data, context) => {
    const branchIds = new Set(seed.branches.map(({ id }) => id));
    const spaces = new Map(seed.spaces.map((space) => [space.id, space]));
    const seenBranches = new Set<string>();
    const seenSpaces = new Set<string>();
    const issue = (path: (string | number)[], message: string) =>
      context.addIssue({ code: "custom", path, message });
    data.branchCovers.forEach(({ branchId }, index) => {
      if (!branchIds.has(branchId))
        issue(["branchCovers", index, "branchId"], "시드에 없는 지점이에요.");
      if (seenBranches.has(branchId))
        issue(["branchCovers", index, "branchId"], "같은 지점이 두 번 있어요.");
      seenBranches.add(branchId);
    });
    data.spacePhotos.forEach(({ spaceId, photos }, index) => {
      const space = spaces.get(spaceId);
      if (!space)
        issue(["spacePhotos", index, "spaceId"], "시드에 없는 공간이에요.");
      else if (space.type === "desk")
        issue(
          ["spacePhotos", index, "spaceId"],
          "좌석에는 사진을 넣지 않아요.",
        );
      if (seenSpaces.has(spaceId))
        issue(["spacePhotos", index, "spaceId"], "같은 공간이 두 번 있어요.");
      seenSpaces.add(spaceId);
      const paths = new Set<string>();
      photos.forEach(({ path }, photoIndex) => {
        if (paths.has(path))
          issue(
            ["spacePhotos", index, "photos", photoIndex, "path"],
            "같은 공간에 같은 사진이 두 번 있어요.",
          );
        paths.add(path);
      });
    });
  });
  const data = schema.parse(input);
  return {
    branchCovers: data.branchCovers.map(({ branchId, path, alt }) => ({
      branchId,
      path,
      alt,
    })),
    spacePhotos: data.spacePhotos.flatMap(({ spaceId, photos }) =>
      photos.map(({ path, alt }, sortOrder) => ({
        spaceId,
        path,
        alt,
        sortOrder,
      })),
    ),
  };
}

export type SeedPhotoData = ReturnType<typeof parseSeedPhotos>;

export function loadSeedPhotos(
  seed: Pick<SeedData, "branches" | "spaces">,
): SeedPhotoData {
  return parseSeedPhotos(photoFile, seed);
}
