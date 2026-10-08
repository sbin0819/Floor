import { z } from "zod";
import type { SeedData } from "./data";
import { SeedError } from "./errors";
import type { SeedPhotoData } from "./photos";
import type { SeedBookings2Data } from "./bookings-2";

export function validateSeedBranchIds(
  branchIds: readonly string[],
  data: Pick<SeedData, "branches">,
  resetPasswords = false,
): string[] {
  const result = z
    .array(z.uuid().transform((id) => id.toLowerCase()))
    .min(1)
    .safeParse(branchIds);
  if (
    !result.success ||
    resetPasswords ||
    new Set(result.data).size !== result.data.length ||
    result.data.some((id) => !data.branches.some((branch) => branch.id === id))
  )
    throw new SeedError(
      "추가할 시드 지점 ID를 중복 없이 지정해 주세요. 지점 추가와 비밀번호 재설정은 함께 할 수 없어요.",
    );
  return result.data;
}

export function selectSeedBranches(
  data: SeedData,
  photos: SeedPhotoData,
  branchIds: readonly string[],
  bookingExtras?: SeedBookings2Data,
) {
  const selected = new Set(branchIds);
  const branches = data.branches.filter(({ id }) => selected.has(id));
  const floors = data.floors.filter(({ branchId }) => selected.has(branchId));
  const floorIds = new Set(floors.map(({ id }) => id));
  const spaces = data.spaces.filter(({ floorId }) => floorIds.has(floorId));
  const spaceIds = new Set(spaces.map(({ id }) => id));
  const bookings = data.bookings.filter(({ spaceId }) => spaceIds.has(spaceId));
  const spaceBlocks = data.spaceBlocks.filter(({ spaceId }) =>
    spaceIds.has(spaceId),
  );
  const floorPlans = data.floorPlans.filter(({ floorId }) =>
    floorIds.has(floorId),
  );
  const branchStaff = data.branchStaff.filter(({ branchId }) =>
    selected.has(branchId),
  );
  const accessGrants = data.accessGrants.filter(({ targetType, targetId }) =>
    (targetType === "floor" ? floorIds : spaceIds).has(targetId),
  );
  const userKeys = new Set([
    ...(bookingExtras?.participants
      .filter(({ bookingId }) => bookings.some(({ id }) => id === bookingId))
      .flatMap(({ userKeys }) => userKeys) ?? []),
    ...(bookingExtras?.deskBookings
      .filter(({ deskId }) => spaceIds.has(deskId))
      .map(({ userKey }) => userKey) ?? []),
    ...(bookingExtras?.deskBlocks
      .filter(({ spaceId }) => spaceIds.has(spaceId))
      .map(({ createdByKey }) => createdByKey) ?? []),
    ...bookings.flatMap(({ userKey, cancelledByKey }) =>
      cancelledByKey ? [userKey, cancelledByKey] : [userKey],
    ),
    ...spaceBlocks.map(({ createdByKey }) => createdByKey),
    ...floorPlans.map(({ createdByKey }) => createdByKey),
    ...branchStaff.map(({ userKey }) => userKey),
  ]);
  return {
    data: {
      branches,
      floors,
      spaces,
      bookings,
      spaceBlocks,
      floorPlans,
      branchStaff,
      accessGrants,
      users: data.users.filter(({ key }) => userKeys.has(key)),
      // 팀은 지점 소유 데이터가 아니다. 주 이용 지점으로 묶어 덮어쓰지 않는다.
      teams: [],
      teamMembers: [],
    } satisfies SeedData,
    photos: {
      branchCovers: photos.branchCovers.filter(({ branchId }) =>
        selected.has(branchId),
      ),
      spacePhotos: photos.spacePhotos.filter(({ spaceId }) =>
        spaceIds.has(spaceId),
      ),
    },
  };
}

export type SeedBranchScope = ReturnType<typeof selectSeedBranches>;

export function seedBranchCounts({ data, photos }: SeedBranchScope) {
  return {
    users: 0,
    branches: data.branches.length,
    floors: data.floors.length,
    spaces: data.spaces.length,
    teams: 0,
    teamMembers: 0,
    branchStaff: data.branchStaff.length,
    accessGrants: data.accessGrants.length,
    floorPlans: data.floorPlans.length,
    bookings: data.bookings.length,
    spaceBlocks: data.spaceBlocks.length,
    spacePhotos: photos.spacePhotos.length,
    branchCovers: photos.branchCovers.length,
  };
}
