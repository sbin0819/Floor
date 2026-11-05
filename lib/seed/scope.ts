import { z } from "zod";
import type { SeedData } from "./data";
import { SeedError } from "./errors";
import type { SeedPhotoData } from "./photos";
import { selectScheduleForBranches, type ExpandedSchedule } from "./schedule";
import { selectSeedLounges, type SeedSpacesData } from "./spaces";

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

const emptySpaceChat: SeedSpacesData = {
  loungeMembers: [],
  loungeMessages: [],
  loungeReports: [],
  communities: [],
};

export function selectSeedBranches(
  data: SeedData,
  photos: SeedPhotoData,
  branchIds: readonly string[],
  schedule: ExpandedSchedule,
  spaceChat: SeedSpacesData = emptySpaceChat,
) {
  const selected = new Set(branchIds);
  const branches = data.branches.filter(({ id }) => selected.has(id));
  const floors = data.floors.filter(({ branchId }) => selected.has(branchId));
  const floorIds = new Set(floors.map(({ id }) => id));
  const spaces = data.spaces.filter(({ floorId }) => floorIds.has(floorId));
  const spaceIds = new Set(spaces.map(({ id }) => id));
  const floorPlans = data.floorPlans.filter(({ floorId }) =>
    floorIds.has(floorId),
  );
  const branchStaff = data.branchStaff.filter(({ branchId }) =>
    selected.has(branchId),
  );
  const accessGrants = data.accessGrants.filter(({ targetType, targetId }) =>
    (targetType === "floor" ? floorIds : spaceIds).has(targetId),
  );
  const scopedSchedule = selectScheduleForBranches(schedule, branchIds);
  const lounges = selectSeedLounges(spaceChat, branchIds);
  const userKeys = new Set([
    ...lounges.loungeMembers.flatMap(({ userKeys }) => userKeys),
    ...scopedSchedule.bookings.flatMap((booking) => [
      booking.userKey,
      ...booking.participantKeys,
      ...(booking.cancelledByKey ? [booking.cancelledByKey] : []),
      ...booking.messages.map(({ authorKey }) => authorKey),
    ]),
    ...scopedSchedule.blocks.map(({ createdByKey }) => createdByKey),
    ...scopedSchedule.announcements.flatMap((row) => [
      row.authorKey,
      ...row.recipientKeys,
    ]),
    ...floorPlans.map(({ createdByKey }) => createdByKey),
    ...branchStaff.map(({ userKey }) => userKey),
  ]);
  return {
    spaceChat: lounges,
    schedule: scopedSchedule,
    data: {
      branches,
      floors,
      spaces,
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

export function seedBranchCounts({
  data,
  photos,
  spaceChat,
  schedule,
}: SeedBranchScope) {
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
    bookings: schedule.bookings.length,
    spaceBlocks: schedule.blocks.length,
    announcements: schedule.announcements.length,
    spacePhotos: photos.spacePhotos.length,
    branchCovers: photos.branchCovers.length,
    chatSpaces: data.branches.length,
    communitySpaces: 0,
    spaceMembers: spaceChat.loungeMembers.reduce(
      (count, row) => count + row.userKeys.length,
      0,
    ),
  };
}
