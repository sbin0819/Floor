import { describe, expect, it, vi } from "vitest";
import { loadSeedData } from "@/lib/seed/data";
import { loadSeedPhotos } from "@/lib/seed/photos";
import { runSeed } from "@/lib/seed/run-seed";
import {
  seedBranchCounts,
  selectSeedBranches,
  validateSeedBranchIds,
} from "@/lib/seed/scope";

const data = loadSeedData();
const photos = loadSeedPhotos(data);
const branch = data.branches.find(({ name }) => name === "성수점")!;

describe("additive seed scope", () => {
  it("normalizes UUID casing without mutating the caller", () => {
    const input = [branch.id.toUpperCase()];
    expect(validateSeedBranchIds(input, data)).toEqual([branch.id]);
    expect(input).toEqual([branch.id.toUpperCase()]);
  });

  it.each(
    [
      [],
      ["not-a-uuid"],
      [""],
      [crypto.randomUUID()],
      [branch.id, branch.id],
      [branch.id, branch.id.toUpperCase()],
    ].map((branchIds) => ({ branchIds })),
  )(
    "rejects invalid or unknown scope before opening a transaction: $branchIds",
    async ({ branchIds: ids }) => {
      const transaction = vi
        .fn()
        .mockRejectedValue(new Error("Must not connect"));
      await expect(
        runSeed({
          db: { transaction },
          now: new Date("2026-10-07T03:00:00Z"),
          resetPasswords: false,
          branchIds: ids,
        }),
      ).rejects.toThrow("지점 ID");
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it("rejects scoped password reset before opening a transaction", async () => {
    const transaction = vi
      .fn()
      .mockRejectedValue(new Error("Must not connect"));
    await expect(
      runSeed({
        db: { transaction },
        now: new Date("2026-10-07T03:00:00Z"),
        resetPasswords: true,
        branchIds: [branch.id],
      }),
    ).rejects.toThrow("비밀번호 재설정");
    expect(transaction).not.toHaveBeenCalled();
  });

  it("projects both IDs and photo rows after complete source validation, without global team writes", () => {
    const before = structuredClone({ data, photos });
    const selected = selectSeedBranches(data, photos, [branch.id]);
    expect(selected.data.branches).toEqual([branch]);
    expect(
      selected.data.floors.every(({ branchId }) => branchId === branch.id),
    ).toBe(true);
    const floorIds = new Set(selected.data.floors.map(({ id }) => id));
    expect(
      selected.data.spaces.every(({ floorId }) => floorIds.has(floorId)),
    ).toBe(true);
    const spaceIds = new Set(selected.data.spaces.map(({ id }) => id));
    expect(
      selected.photos.spacePhotos.every(({ spaceId }) => spaceIds.has(spaceId)),
    ).toBe(true);
    expect(
      selected.photos.branchCovers.map(({ branchId }) => branchId),
    ).toEqual([branch.id]);
    expect(selected.data.users.map(({ key }) => key)).toEqual(["admin"]);
    expect(selected.data.teams).toEqual([]);
    expect(selected.data.teamMembers).toEqual([]);
    expect(seedBranchCounts(selected)).toMatchObject({
      branches: 1,
      users: 0,
      teams: 0,
      teamMembers: 0,
    });
    expect({ data, photos }).toEqual(before);
  });
});
