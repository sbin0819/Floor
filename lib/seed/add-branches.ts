import type { DalDatabase } from "@/lib/dal";
import { insertSeedBlock, insertSeedBooking } from "@/lib/dal/seed";
import { insertSeedMeeting } from "@/lib/dal/seed-meeting";
import {
  insertSeedBranchStructure,
  readSeedScopeRows,
} from "@/lib/dal/seed-scope";
import { getOperatingDate } from "@/lib/time/open-hours";
import { zonedDateTime } from "@/lib/time/zoned";
import { loadSeedData } from "./data";
import { loadSeedBookings2, type SeedBookings2Data } from "./bookings-2";
import { insertSeedDeskSchedule, scopedDeskSchedule } from "./desk-schedule";
import { insertSeedParticipants } from "./participants";
import { insertSeedReminders } from "./reminders";
import { SeedError } from "./errors";
import { loadSeedPhotos } from "./photos";
import {
  loadSeedMeeting,
  seedMeetingCreatedAt,
  type SeedMeetingData,
} from "./meeting";
import type { SeedResult } from "./run-seed";
import {
  seedBranchCounts,
  selectSeedBranches,
  validateSeedBranchIds,
  type SeedBranchScope,
} from "./scope";

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

async function prepareAddition(
  scope: SeedBranchScope,
  db: DalDatabase,
  bookingExtras?: SeedBookings2Data,
) {
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
    const { data, photos } = selectSeedBranches(scope.data, scope.photos, [
      branch.id,
    ]);
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
    verifyRows(
      data.bookings,
      rows.bookingRows,
      exists,
      (a, b) => a.spaceId === b.spaceId,
    );
    verifyRows(
      data.spaceBlocks,
      rows.blockRows,
      exists,
      (a, b) => a.spaceId === b.spaceId,
    );
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
      bookingExtras,
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
}: {
  branchIds: readonly string[];
  db: DalDatabase;
}) {
  const data = loadSeedData();
  const photos = loadSeedPhotos(data);
  const extras = loadSeedBookings2(data);
  const meeting = loadSeedMeeting(data, extras);
  const ids = validateSeedBranchIds(branchIds, data);
  const plan = await prepareAddition(
    selectSeedBranches(data, photos, ids, extras),
    db,
    extras,
  );
  const selected = scopedDeskSchedule(plan.addition.data, extras);
  const counts = seedBranchCounts(plan.addition);
  const bookingIds = new Set(plan.addition.data.bookings.map(({ id }) => id));
  return {
    addedBranchIds: plan.addedBranchIds,
    skippedBranchIds: plan.skippedBranchIds,
    expectedCounts: {
      ...counts,
      bookings: counts.bookings + selected.bookings.length,
      spaceBlocks: counts.spaceBlocks + selected.blocks.length,
      meetingRooms: counts.bookings,
      chatMessages:
        counts.bookings +
        meeting.messages.filter(({ bookingId }) => bookingIds.has(bookingId))
          .length,
    },
  };
}

export async function addSeedBranches(
  scope: SeedBranchScope,
  db: DalDatabase,
  now: Date,
  bookingExtras?: SeedBookings2Data,
  meeting: SeedMeetingData = { messages: [] },
): Promise<SeedResult> {
  const { addition, userIds, addedBranchIds, skippedBranchIds } =
    await prepareAddition(scope, db, bookingExtras);
  const { data } = addition;
  const attendeeCounts = new Map(
    bookingExtras?.attendeeCounts.map(({ bookingId, attendeeCount }) => [
      bookingId,
      attendeeCount,
    ]),
  );
  // 존재 여부를 먼저 읽었어도 다른 실행과 경합할 수 있으므로 INSERT 충돌을 숨기지 않는다.
  await insertSeedBranchStructure(addition, userIds, db);
  const branches = new Map(data.branches.map((branch) => [branch.id, branch]));
  const floors = new Map(data.floors.map((floor) => [floor.id, floor]));
  const spaces = new Map(data.spaces.map((space) => [space.id, space]));
  const instant = (spaceId: string, offset: number, time: string) => {
    const branch = branches.get(
      floors.get(spaces.get(spaceId)!.floorId)!.branchId,
    )!;
    return zonedDateTime(
      getOperatingDate(now, branch.timezone, branch.openHours, offset),
      time,
      branch.timezone,
    );
  };
  for (const {
    startDayOffset,
    endDayOffset,
    start,
    end,
    createdByKey,
    ...block
  } of data.spaceBlocks)
    await insertSeedBlock(
      {
        ...block,
        createdBy: userIds.get(createdByKey)!,
        during: {
          start: instant(block.spaceId, startDayOffset, start),
          end: instant(block.spaceId, endDayOffset, end),
        },
      },
      db,
    );
  for (const {
    dayOffset,
    start,
    end,
    userKey,
    cancelledByKey,
    ...booking
  } of data.bookings) {
    const meetingMessages = meeting.messages.filter(
      ({ bookingId }) => bookingId === booking.id,
    );
    const createdAt = seedMeetingCreatedAt(meetingMessages, now);
    const during = {
      start: instant(booking.spaceId, dayOffset, start),
      end: instant(booking.spaceId, dayOffset, end),
    };
    await insertSeedBooking(
      {
        ...booking,
        createdAt,
        attendeeCount: attendeeCounts.get(booking.id) ?? null,
        userId: userIds.get(userKey)!,
        during,
        cancelledAt: booking.status === "cancelled" ? now : null,
        cancelledBy:
          booking.status === "cancelled" && cancelledByKey
            ? userIds.get(cancelledByKey)!
            : null,
      },
      db,
    );
    await insertSeedParticipants(
      booking.id,
      bookingExtras,
      userIds,
      createdAt,
      db,
    );
    await insertSeedMeeting(
      {
        bookingId: booking.id,
        bookerId: userIds.get(userKey)!,
        messages: meetingMessages,
        userIds,
        createdAt,
        now,
      },
      db,
    );
    await insertSeedReminders({
      booking: { ...booking, during, userId: userIds.get(userKey)! },
      data,
      extras: bookingExtras,
      userIds,
      now,
      database: db,
    });
  }
  const counts = seedBranchCounts(addition);
  const bookingIds = new Set(data.bookings.map(({ id }) => id));
  const deskResult = bookingExtras
    ? await insertSeedDeskSchedule({
        data,
        extras: bookingExtras,
        userIds,
        now,
        database: db,
      })
    : { bookings: 0, spaceBlocks: 0, skippedBookings: 0 };
  return {
    counts: {
      ...counts,
      bookings: counts.bookings + deskResult.bookings,
      spaceBlocks: counts.spaceBlocks + deskResult.spaceBlocks,
      meetingRooms: counts.bookings,
      chatMessages:
        counts.bookings +
        meeting.messages.filter(({ bookingId }) => bookingIds.has(bookingId))
          .length,
    },
    skippedBookings: deskResult.skippedBookings,
    skippedMeetingMessages: 0,
    accounts: data.users.map(({ email }) => email),
    branchScope: { addedBranchIds, skippedBranchIds },
  };
}
