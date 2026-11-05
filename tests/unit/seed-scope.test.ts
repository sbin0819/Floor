import { describe, expect, it, vi } from "vitest";
import { loadSeedData } from "@/lib/seed/data";
import { loadSeedPhotos } from "@/lib/seed/photos";
import { expandSeedSchedule, loadSeedSchedule } from "@/lib/seed/schedule";
import { loadSeedSpaces } from "@/lib/seed/spaces";
import { runSeed } from "@/lib/seed/run-seed";
import {
  seedBranchCounts,
  selectSeedBranches,
  validateSeedBranchIds,
} from "@/lib/seed/scope";

const data = loadSeedData();
const photos = loadSeedPhotos(data);
const now = new Date("2026-11-05T05:00:00Z");
const schedule = expandSeedSchedule(loadSeedSchedule(data), data, now);
const branch = data.branches.find(({ name }) => name === "여의도점")!;

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
          now,
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
        now,
        resetPasswords: true,
        branchIds: [branch.id],
      }),
    ).rejects.toThrow("비밀번호 재설정");
    expect(transaction).not.toHaveBeenCalled();
  });

  it("projects structure, photos and only that branch's schedule without global team writes", () => {
    const before = structuredClone({ data, photos });
    const selected = selectSeedBranches(data, photos, [branch.id], schedule);
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
    expect(selected.schedule.bookings.length).toBeGreaterThan(0);
    expect(
      selected.schedule.bookings.every(
        (booking) =>
          booking.branchId === branch.id && spaceIds.has(booking.spaceId),
      ),
    ).toBe(true);
    expect(
      selected.schedule.blocks.every((block) => spaceIds.has(block.spaceId)),
    ).toBe(true);
    expect(selected.schedule.announcements).toEqual([]);
    expect(selected.schedule.bookingIds).toEqual(
      selected.schedule.bookings.map(({ id }) => id),
    );
    // 계정은 그 지점의 일정·운영자가 가리키는 사람만 포함한다.
    const referenced = new Set([
      "admin",
      ...selected.schedule.bookings.flatMap((booking) => [
        booking.userKey,
        ...booking.participantKeys,
      ]),
    ]);
    expect(new Set(selected.data.users.map(({ key }) => key))).toEqual(
      referenced,
    );
    expect(selected.data.teams).toEqual([]);
    expect(selected.data.teamMembers).toEqual([]);
    expect(seedBranchCounts(selected)).toMatchObject({
      branches: 1,
      users: 0,
      teams: 0,
      teamMembers: 0,
      bookings: selected.schedule.bookings.length,
      spaceBlocks: selected.schedule.blocks.length,
      announcements: 0,
    });
    expect({ data, photos }).toEqual(before);
  });

  it("includes lounge-only account references but excludes every community from a branch scope", () => {
    const spaceChat = loadSeedSpaces(data);
    const scopedChat = {
      ...spaceChat,
      loungeMembers: [{ branchId: branch.id, userKeys: ["both"] }],
      loungeMessages: [
        {
          branchId: branch.id,
          authorKey: "both",
          body: "새 라운지",
          minutesAgo: 1,
        },
      ],
      loungeReports: [],
    };
    const selected = selectSeedBranches(
      data,
      photos,
      [branch.id],
      schedule,
      scopedChat,
    );
    expect(selected.data.users.map(({ key }) => key)).toContain("both");
    expect(selected.spaceChat).toEqual({ ...scopedChat, communities: [] });
    expect(seedBranchCounts(selected)).toMatchObject({
      chatSpaces: 1,
      communitySpaces: 0,
      spaceMembers: 1,
    });
  });
});
