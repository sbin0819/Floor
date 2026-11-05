import type { DalDatabase } from "@/lib/dal";
import { syncSeedChatSpaces } from "@/lib/dal/seed-chat-spaces";
import {
  insertSeedBranchStructure,
  readSeedScopeRows,
} from "@/lib/dal/seed-scope";
import { applySeedSchedule } from "./apply-schedule";
import { loadSeedData } from "./data";
import { SeedError } from "./errors";
import { loadSeedPhotos } from "./photos";
import { loungeMembersByBranch, type SeedResult } from "./run-seed";
import { expandSeedSchedule, loadSeedSchedule } from "./schedule";
import {
  seedBranchCounts,
  selectSeedBranches,
  validateSeedBranchIds,
  type SeedBranchScope,
} from "./scope";
import { loadSeedSpaces } from "./spaces";

function verifyRows<E extends { id: string }, A extends { id: string }>(
  expected: readonly E[],
  actual: readonly A[],
  exists: boolean,
  matches: (expected: E, actual: A) => boolean,
) {
  const byId = new Map(actual.map((row) => [row.id, row]));
  for (const row of expected) {
    const found = byId.get(row.id);
    if (exists ? !found || !matches(row, found) : found !== undefined)
      throw new SeedError(
        "시드 지점의 고정 ID가 충돌하거나 일부 데이터가 없어요. 기존 데이터는 바꾸지 않았어요.",
      );
  }
}

async function prepareAddition(scope: SeedBranchScope, db: DalDatabase) {
  const rows = await readSeedScopeRows(scope, db);
  const userIds = new Map<string, string>();
  for (const account of scope.data.users) {
    const user = rows.userRows.find(({ email }) => email === account.email);
    if (!user?.emailVerified)
      throw new SeedError(
        "지점 추가에 필요한 인증 완료 시드 계정이 없어요. 계정은 생성하거나 변경하지 않았어요.",
      );
    userIds.set(account.key, user.id);
  }
  if (rows.teamIds.some((id) => !rows.teamRows.some((team) => team.id === id)))
    throw new SeedError(
      "지점 추가에 필요한 기존 팀이 없어요. 팀은 생성하거나 변경하지 않았어요.",
    );
  const addedBranchIds: string[] = [];
  const skippedBranchIds: string[] = [];
  for (const branch of scope.data.branches) {
    const existingBranch = rows.branchRows.find(({ id }) => id === branch.id);
    const exists = existingBranch !== undefined;
    const { data, photos, schedule } = selectSeedBranches(
      scope.data,
      scope.photos,
      [branch.id],
      scope.schedule,
    );
    if (
      !exists &&
      rows.branchRows.some(
        (row) => row.name.toLowerCase() === branch.name.toLowerCase(),
      )
    )
      throw new SeedError(
        "추가할 시드 지점의 이름을 다른 ID가 사용하고 있어요. 기존 지점은 바꾸지 않았어요.",
      );
    verifyRows(
      data.floors,
      rows.floorRows,
      exists,
      (a, b) => a.branchId === b.branchId,
    );
    verifyRows(
      data.spaces,
      rows.spaceRows,
      exists,
      (a, b) => a.floorId === b.floorId && a.parentId === b.parentId,
    );
    // 이미 있는 지점의 예약·점검은 날짜가 달라도 그대로 둔다. 새 지점의 id는 아직 없어야 한다.
    if (!exists) {
      verifyRows(schedule.bookings, rows.bookingRows, false, () => true);
      verifyRows(schedule.blocks, rows.blockRows, false, () => true);
    }
    verifyRows(
      data.floorPlans,
      rows.planRows,
      exists,
      (a, b) => a.floorId === b.floorId,
    );
    verifyRows(
      data.accessGrants,
      rows.grantRows,
      exists,
      (a, b) =>
        a.targetType === b.targetType &&
        a.targetId === b.targetId &&
        a.teamId === b.teamId,
    );
    if (
      exists &&
      data.branchStaff.some(
        ({ branchId, userKey }) =>
          !rows.staffRows.some(
            (row) =>
              row.branchId === branchId && row.userId === userIds.get(userKey),
          ),
      )
    )
      throw new SeedError(
        "기존 시드 지점의 운영자 소속이 없어요. 자동으로 복구하지 않았어요.",
      );
    if (!exists && data.floorPlans.length)
      throw new SeedError(
        "새 평면도를 포함한 지점은 추가 전용 시드를 지원하지 않아요. 전체 시드로 자동 전환하지 않았어요.",
      );
    if (
      exists &&
      ((photos.branchCovers.length > 0 && !existingBranch.hasCover) ||
        photos.spacePhotos.some(
          (photo) =>
            !rows.photoRows.some(
              (row) =>
                row.spaceId === photo.spaceId &&
                row.sortOrder === photo.sortOrder,
            ),
        ))
    )
      throw new SeedError(
        "기존 시드 지점의 대표 사진이나 사진 순서가 빠져 있어요. 자동으로 복구하지 않았어요.",
      );
    (exists ? skippedBranchIds : addedBranchIds).push(branch.id);
  }
  return {
    addition: selectSeedBranches(
      scope.data,
      scope.photos,
      addedBranchIds,
      scope.schedule,
      scope.spaceChat,
    ),
    userIds,
    addedBranchIds,
    skippedBranchIds,
  };
}

/** 실제 적용 전에도 재사용하는 읽기 전용 검사다. 적용 함수는 트랜잭션 안에서 다시 검사한다. */
export async function preflightSeedBranches({
  branchIds,
  db,
  now,
}: {
  branchIds: readonly string[];
  db: DalDatabase;
  now: Date;
}) {
  const data = loadSeedData();
  const photos = loadSeedPhotos(data);
  const spaceChat = loadSeedSpaces(data);
  const schedule = expandSeedSchedule(loadSeedSchedule(data), data, now);
  const ids = validateSeedBranchIds(branchIds, data);
  const plan = await prepareAddition(
    selectSeedBranches(data, photos, ids, schedule, spaceChat),
    db,
  );
  const counts = seedBranchCounts(plan.addition);
  const timeBookings = plan.addition.schedule.bookings.filter(
    (booking) => !booking.isDesk,
  );
  return {
    addedBranchIds: plan.addedBranchIds,
    skippedBranchIds: plan.skippedBranchIds,
    expectedCounts: {
      ...counts,
      meetingRooms: timeBookings.length,
      chatMessages:
        timeBookings.reduce(
          (count, booking) =>
            count +
            1 +
            booking.messages.length +
            (booking.status === "cancelled" ? 1 : 0),
          0,
        ) +
        plan.addition.spaceChat.loungeMessages.length +
        plan.addition.schedule.announcements.length,
    },
  };
}

export async function addSeedBranches(
  scope: SeedBranchScope,
  db: DalDatabase,
  now: Date,
): Promise<SeedResult> {
  const { addition, userIds, addedBranchIds, skippedBranchIds } =
    await prepareAddition(scope, db);
  const { data } = addition;
  // 존재 여부를 먼저 읽었어도 다른 실행과 경합할 수 있으므로 INSERT 충돌을 숨기지 않는다.
  await insertSeedBranchStructure(addition, userIds, db);
  const spaceChatCounts = await syncSeedChatSpaces(
    addition.spaceChat,
    addedBranchIds,
    userIds,
    now,
    db,
    { newLoungesOnly: true },
  );
  const applied = await applySeedSchedule(
    {
      schedule: addition.schedule,
      data,
      userIds,
      now,
      loungeMemberKeys: loungeMembersByBranch(addition.spaceChat),
    },
    db,
  );
  const counts = seedBranchCounts(addition);
  return {
    counts: {
      ...counts,
      bookings: applied.bookings,
      spaceBlocks: applied.spaceBlocks,
      announcements: applied.announcements,
      notifications: applied.notifications,
      meetingRooms: applied.meetingRooms,
      chatMessages: spaceChatCounts.chatMessages + applied.chatMessages,
    },
    skippedBookings: applied.skippedBookings,
    accounts: data.users.map(({ email }) => email),
    branchScope: { addedBranchIds, skippedBranchIds },
  };
}
