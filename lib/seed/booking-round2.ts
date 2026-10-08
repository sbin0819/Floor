import { z } from "zod";
import { createDeskParts } from "@/features/bookings/desk-parts";
import { canBookAs } from "@/features/bookings/access";
import {
  buildReminderNotifications,
  notificationBookingSnapshot,
} from "@/features/notifications/builders";
import { getSpaceForAccess, type DalDatabase } from "@/lib/dal";
import { insertBookingParticipants } from "@/lib/dal/booking-participants";
import { hasUserDeskBookingOverlap } from "@/lib/dal/desks";
import { insertNotifications } from "@/lib/dal/notifications";
import {
  hasSeedBookingOverlap,
  insertSeedBlock,
  insertSeedBooking,
} from "@/lib/dal/seed";
import {
  fillRound2AttendeeCount,
  hasRound2BlockOverlap,
  lockRound2SeedRows,
  readRound2SeedState,
  type Round2SeedReferences,
  type Round2SeedState,
} from "@/lib/dal/seed-round2";
import {
  hashBookingRound2Value,
  parseBookingRound2Receipt,
  type BookingRound2Receipt,
} from "./booking-round2-receipt";
import type { SeedBookings2Data } from "./bookings-2";
import type { SeedData } from "./data";
import type { SeedResult } from "./run-seed";
import { SeedError } from "./errors";
import { loadPermissionContext } from "@/lib/permissions/context";
import { getOperatingDate } from "@/lib/time/open-hours";
import { zonedDateTime } from "@/lib/time/zoned";

export type BookingRound2Options = {
  hostHash: string;
  receipt: BookingRound2Receipt | null;
};

const hostHashSchema = z.string().regex(/^[a-f0-9]{64}$/u);

export function validateBookingRound2Options(options: BookingRound2Options) {
  if (!hostHashSchema.safeParse(options.hostHash).success)
    throw new SeedError("예약 2차 대상 호스트 확인 값이 올바르지 않아요.");
  if (options.receipt !== null) {
    try {
      const receipt = parseBookingRound2Receipt(options.receipt);
      if (receipt.hostHash === options.hostHash) return receipt;
    } catch {
      // 기록 원문에는 운영 정보를 추가하지 않고 고정 안내만 전달한다.
    }
    throw new SeedError("예약 2차 완료 기록이 올바르지 않거나 대상이 달라요.");
  }
  return null;
}

function stop(message: string): never {
  throw new SeedError(`예약 2차: ${message} 자동으로 복구하지 않았어요.`);
}

function seedReferences(data: SeedData, extras: SeedBookings2Data) {
  const usedSpaces = new Set([
    ...data.bookings.map(({ spaceId }) => spaceId),
    ...extras.deskBookings.map(({ deskId }) => deskId),
    ...extras.deskBlocks.map(({ spaceId }) => spaceId),
  ]);
  for (const space of data.spaces)
    if (usedSpaces.has(space.id) && space.parentId)
      usedSpaces.add(space.parentId);
  const spaceRows = data.spaces.filter(({ id }) => usedSpaces.has(id));
  const floorRows = data.floors.filter(({ id }) =>
    spaceRows.some(({ floorId }) => floorId === id),
  );
  const userKeys = new Set([
    ...data.bookings.map(({ userKey }) => userKey),
    ...extras.deskBookings.map(({ userKey }) => userKey),
    ...extras.deskBlocks.map(({ createdByKey }) => createdByKey),
    ...extras.participants.flatMap(({ userKeys }) => userKeys),
  ]);
  const accounts = data.users.filter(({ key }) => userKeys.has(key));
  const references: Round2SeedReferences = {
    bookingIds: [
      ...data.bookings.map(({ id }) => id),
      ...extras.deskBookings.map(({ id }) => id),
      ...extras.deskBlocks.map(({ id }) => id),
    ],
    blockIds: [...extras.deskBookings, ...extras.deskBlocks].map(
      ({ id }) => id,
    ),
    spaceIds: spaceRows.map(({ id }) => id),
    floorIds: floorRows.map(({ id }) => id),
    branchIds: [...new Set(floorRows.map(({ branchId }) => branchId))],
    userEmails: accounts.map(({ email }) => email),
    teamIds: [
      ...new Set(
        [...data.bookings, ...extras.deskBookings].flatMap(({ teamId }) =>
          teamId ? [teamId] : [],
        ),
      ),
    ],
  };
  const manifestHash = hashBookingRound2Value({
    version: 1,
    counts: extras.attendeeCounts.map(({ bookingId, attendeeCount }) => ({
      bookingId,
      attendeeCount,
    })),
    participants: extras.participants.map(({ bookingId, userKeys }) => ({
      bookingId,
      userKeys,
    })),
    desks: extras.deskBookings,
    blocks: extras.deskBlocks,
    bookings: data.bookings.map(({ id, spaceId, userKey, teamId }) => ({
      id,
      spaceId,
      userKey,
      teamId,
    })),
    spaces: spaceRows.map(({ id, floorId, parentId, type }) => ({
      id,
      floorId,
      parentId,
      type,
    })),
    floors: floorRows.map(({ id, branchId }) => ({ id, branchId })),
    accounts: accounts.map(({ key, email }) => ({ key, email })),
  });
  return { references, accounts, spaceRows, floorRows, manifestHash };
}

type References = ReturnType<typeof seedReferences>;

function verifyReferences(
  data: SeedData,
  references: References,
  state: Round2SeedState,
  requireVerified: boolean,
) {
  const userIds = new Map<string, string>();
  for (const account of references.accounts) {
    const user = state.userRows.find(({ email }) => email === account.email);
    if (!user || (requireVerified && !user.emailVerified))
      stop("필요한 기존 인증 완료 계정을 확인할 수 없어요.");
    userIds.set(account.key, user.id);
  }
  for (const expected of references.spaceRows) {
    const row = state.spaceRows.find(({ id }) => id === expected.id);
    if (
      !row ||
      row.floorId !== expected.floorId ||
      row.parentId !== expected.parentId ||
      row.type !== expected.type
    )
      stop("공간이나 좌석의 부모 관계가 일치하지 않아요.");
  }
  for (const expected of references.floorRows) {
    const row = state.floorRows.find(({ id }) => id === expected.id);
    if (!row || row.branchId !== expected.branchId)
      stop("층의 지점 관계가 일치하지 않아요.");
  }
  if (
    state.branchRows.length !== references.references.branchIds.length ||
    state.teamRows.length !== references.references.teamIds.length
  )
    stop("필요한 기존 지점이나 팀이 없어요.");
  for (const expected of data.bookings) {
    const row = state.bookingRows.find(({ id }) => id === expected.id);
    if (
      !row ||
      row.spaceId !== expected.spaceId ||
      row.teamId !== expected.teamId ||
      row.userId !== userIds.get(expected.userKey)
    )
      stop("기존 시드 예약의 식별자나 소유 관계가 일치하지 않아요.");
  }
  return userIds;
}

function bundleHash(
  data: SeedData,
  extras: SeedBookings2Data,
  state: Round2SeedState,
) {
  const sorted = <T extends { id: string }>(rows: T[]) =>
    rows.sort((a, b) => a.id.localeCompare(b.id));
  const baseIds = new Set(data.bookings.map(({ id }) => id));
  const deskIds = new Set(extras.deskBookings.map(({ id }) => id));
  const blockIds = new Set(extras.deskBlocks.map(({ id }) => id));
  return hashBookingRound2Value({
    // 시간 예약은 이후 합법적으로 수정할 수 있어 날짜·제목·인원은 완료 증거에서 제외한다.
    timeBookings: sorted(
      state.bookingRows
        .filter(({ id }) => baseIds.has(id))
        .map(({ id, spaceId, userId, teamId }) => ({
          id,
          spaceId,
          userId,
          teamId,
        })),
    ),
    deskBookings: sorted(
      state.bookingRows
        .filter(({ id }) => deskIds.has(id))
        .map(({ id, spaceId, userId, teamId, during, createdAt }) => ({
          id,
          spaceId,
          userId,
          teamId,
          during,
          createdAt,
        })),
    ),
    blocks: sorted(
      state.blockRows
        .filter(({ id }) => blockIds.has(id))
        .map(({ id, spaceId, createdBy, during, createdAt }) => ({
          id,
          spaceId,
          createdBy,
          during,
          createdAt,
        })),
    ),
    spaces: sorted(
      state.spaceRows.map(({ id, floorId, parentId, type }) => ({
        id,
        floorId,
        parentId,
        type,
      })),
    ),
    floors: sorted(
      state.floorRows.map(({ id, branchId }) => ({ id, branchId })),
    ),
    users: state.userRows.map(({ id }) => id).sort(),
  });
}

function assertPristine(extras: SeedBookings2Data, state: Round2SeedState) {
  const additions = new Set(
    [...extras.deskBookings, ...extras.deskBlocks].map(({ id }) => id),
  );
  const participantBookings = new Set(
    extras.participants.map(({ bookingId }) => bookingId),
  );
  if (
    state.bookingRows.some(({ id }) => additions.has(id)) ||
    state.blockRows.length ||
    state.participantRows.some(({ bookingId }) =>
      participantBookings.has(bookingId),
    ) ||
    state.reminderRows.length ||
    extras.attendeeCounts.some(
      ({ bookingId }) =>
        state.bookingRows.find(({ id }) => id === bookingId)?.attendeeCount !==
        null,
    )
  )
    stop("완료 기록 없이 이미 적용된 값 또는 일부 추가 데이터가 있어요.");
  for (const entry of extras.attendeeCounts) {
    const booking = state.bookingRows.find(({ id }) => id === entry.bookingId)!;
    const space = state.spaceRows.find(({ id }) => id === booking.spaceId)!;
    if (space.capacity !== null && entry.attendeeCount > space.capacity)
      stop("기존 공간의 정원과 사용 인원이 맞지 않아요.");
  }
  for (const entry of extras.participants) {
    const booking = state.bookingRows.find(({ id }) => id === entry.bookingId)!;
    const space = state.spaceRows.find(({ id }) => id === booking.spaceId)!;
    if (
      booking.status !== "confirmed" ||
      (space.capacity !== null && entry.userKeys.length + 1 > space.capacity)
    )
      stop("참석자를 추가할 기존 예약의 상태나 정원이 달라요.");
  }
}

function prepareDeskSchedule(
  extras: SeedBookings2Data,
  state: Round2SeedState,
  userIds: ReadonlyMap<string, string>,
  now: Date,
) {
  const branchFor = (id: string) => {
    const space = state.spaceRows.find((row) => row.id === id)!;
    const parent = state.spaceRows.find((row) => row.id === space.parentId);
    if (
      space.type !== "desk" ||
      !space.bookable ||
      space.archivedAt ||
      !parent ||
      parent.type !== "desk_area" ||
      parent.bookable ||
      parent.archivedAt
    )
      stop("좌석이나 데스크 구역의 이용 설정이 달라요.");
    const floor = state.floorRows.find(({ id }) => id === space.floorId)!;
    return state.branchRows.find(({ id }) => id === floor.branchId)!;
  };
  const bookings = extras.deskBookings.map((row) => {
    const branch = branchFor(row.deskId);
    const part = createDeskParts({
      date: getOperatingDate(
        now,
        branch.timezone,
        branch.openHours,
        row.dayOffset,
      ),
      timeZone: branch.timezone,
      openHours: branch.openHours,
    }).find(({ part }) => part === row.part);
    if (!part) stop("좌석 예약 구간이 현재 운영 시간에 없어요.");
    return {
      id: row.id,
      spaceId: row.deskId,
      userId: userIds.get(row.userKey)!,
      teamId: row.teamId,
      status: "confirmed" as const,
      during: { start: new Date(part.start), end: new Date(part.end) },
      title: null,
      attendeeCount: null,
      createdAt: now,
    };
  });
  const blocks = extras.deskBlocks.map((row) => {
    const branch = branchFor(row.spaceId);
    const instant = (offset: number, time: string) =>
      zonedDateTime(
        getOperatingDate(now, branch.timezone, branch.openHours, offset),
        time,
        branch.timezone,
      );
    return {
      id: row.id,
      spaceId: row.spaceId,
      createdBy: userIds.get(row.createdByKey)!,
      during: {
        start: instant(row.startDayOffset, row.start),
        end: instant(row.endDayOffset, row.end),
      },
      reason: row.reason,
      createdAt: now,
    };
  });
  return { bookings, blocks };
}

export async function applyBookingRound2(
  input: BookingRound2Options & {
    data: SeedData;
    extras: SeedBookings2Data;
    now: Date;
  },
  db: DalDatabase,
): Promise<SeedResult> {
  const { data, extras, now, hostHash } = input;
  const receipt = validateBookingRound2Options(input);
  const source = seedReferences(data, extras);
  if (
    receipt &&
    (receipt.manifestHash !== source.manifestHash ||
      new Date(receipt.appliedAt) > now)
  )
    stop("완료 기록의 시드 정의 또는 적용 시각이 일치하지 않아요.");
  let state = await readRound2SeedState(source.references, db);
  let userIds = verifyReferences(data, source, state, receipt === null);
  if (receipt) {
    if (
      state.bookingRows.length !==
        data.bookings.length + extras.deskBookings.length ||
      state.blockRows.length !== extras.deskBlocks.length ||
      bundleHash(data, extras, state) !== receipt.bundleHash
    )
      stop("완료 기록과 기존 추가 데이터의 불변 값이 일치하지 않아요.");
    return {
      counts: {},
      skippedBookings: 0,
      accounts: [],
      bookingRound2: { applied: false, receipt },
    };
  }
  assertPristine(extras, state);
  const deskOwners = new Set(
    extras.deskBookings.map(({ userKey }) => userIds.get(userKey)!),
  );
  const lockedUserIds = new Set([
    ...userIds.values(),
    ...state.participantRows.map(({ userId }) => userId),
  ]);
  if (
    !(await lockRound2SeedRows(
      {
        floorIds: source.references.floorIds,
        spaceIds: [...source.spaceRows]
          .sort(
            (a, b) =>
              Number(Boolean(a.parentId)) - Number(Boolean(b.parentId)) ||
              a.id.localeCompare(b.id),
          )
          .map(({ id }) => id),
        users: [...lockedUserIds].map((userId) => ({
          userId,
          strength: deskOwners.has(userId) ? "update" : "key share",
        })),
        teamIds: source.references.teamIds,
        bookingIds: data.bookings.map(({ id }) => id),
      },
      db,
    ))
  )
    stop("필요한 기존 행을 잠글 수 없어요.");
  state = await readRound2SeedState(source.references, db);
  userIds = verifyReferences(data, source, state, true);
  assertPristine(extras, state);
  if (
    [...userIds.values()].some((id) => !lockedUserIds.has(id)) ||
    state.participantRows.some(({ userId }) => !lockedUserIds.has(userId))
  )
    stop("확인 중 기존 참석자 목록이 바뀌었어요.");
  const schedule = prepareDeskSchedule(extras, state, userIds, now);
  const areaIds = [
    ...new Set(
      schedule.bookings.map(
        ({ spaceId }) =>
          state.spaceRows.find(({ id }) => id === spaceId)!.parentId!,
      ),
    ),
  ];
  const areas = new Map(
    await Promise.all(
      areaIds.map(async (id) => [id, await getSpaceForAccess(id, db)] as const),
    ),
  );
  const accessKeys = new Map(
    schedule.bookings.map((booking) => {
      const areaId = state.spaceRows.find(
        ({ id }) => id === booking.spaceId,
      )!.parentId!;
      const area = areas.get(areaId);
      if (!area) stop("좌석 구역의 접근 설정을 확인할 수 없어요.");
      return [
        `${booking.userId}/${area.floor.branchId}`,
        { userId: booking.userId, branchId: area.floor.branchId },
      ] as const;
    }),
  );
  const contexts = new Map(
    await Promise.all(
      [...accessKeys].map(async ([key, value]) => {
        const user = state.userRows.find(({ id }) => id === value.userId)!;
        return [
          key,
          await loadPermissionContext(
            { userId: user.id, email: user.email, name: "" },
            value.branchId,
            db,
          ),
        ] as const;
      }),
    ),
  );
  for (const row of schedule.bookings) {
    const parentId = state.spaceRows.find(
      ({ id }) => id === row.spaceId,
    )!.parentId!;
    const area = areas.get(parentId)!;
    if (
      !canBookAs(
        contexts.get(`${row.userId}/${area.floor.branchId}`)!,
        area,
        row.teamId,
      )
    )
      stop("좌석 예약의 현재 이용 대상이나 팀 소속이 맞지 않아요.");
    if (
      schedule.bookings.some(
        (other) =>
          other.id !== row.id &&
          (other.spaceId === row.spaceId || other.userId === row.userId) &&
          other.during.start < row.during.end &&
          row.during.start < other.during.end,
      )
    )
      stop("새 좌석 묶음 안에서 같은 좌석이나 사용자 일정이 겹쳐요.");
    if (
      (await hasSeedBookingOverlap(row.spaceId, row.during, db)) ||
      (await hasUserDeskBookingOverlap(row.userId, row.during, db)) ||
      (await hasRound2BlockOverlap([row.spaceId, parentId], row.during, db)) ||
      schedule.blocks.some(
        (block) =>
          block.spaceId === row.spaceId &&
          block.during.start < row.during.end &&
          row.during.start < block.during.end,
      )
    )
      stop("좌석 또는 사용자의 기존 일정과 새 예약이 겹쳐요.");
  }
  for (const row of schedule.blocks)
    if (
      (await hasSeedBookingOverlap(row.spaceId, row.during, db)) ||
      (await hasRound2BlockOverlap(
        [
          row.spaceId,
          state.spaceRows.find(({ id }) => id === row.spaceId)!.parentId!,
        ],
        row.during,
        db,
      ))
    )
      stop("새 좌석 점검이 기존 일정과 겹쳐요.");
  for (const row of extras.attendeeCounts)
    if (!(await fillRound2AttendeeCount(row.bookingId, row.attendeeCount, db)))
      stop("적용 중 기존 사용 인원이 변경됐어요.");
  for (const row of extras.participants)
    await insertBookingParticipants(
      row.bookingId,
      row.userKeys.map((key) => userIds.get(key)!),
      db,
    );
  for (const row of schedule.bookings) await insertSeedBooking(row, db);
  for (const row of schedule.blocks) await insertSeedBlock(row, db);
  const reminders = data.bookings.flatMap(({ id }) => {
    const booking = state.bookingRows.find((row) => row.id === id)!;
    if (booking.status !== "confirmed") return [];
    const space = state.spaceRows.find(({ id }) => id === booking.spaceId)!;
    const floor = state.floorRows.find(({ id }) => id === space.floorId)!;
    const branch = state.branchRows.find(({ id }) => id === floor.branchId)!;
    const recipients = [
      booking.userId,
      ...state.participantRows
        .filter(({ bookingId }) => bookingId === id)
        .map(({ userId }) => userId),
      ...(
        extras.participants.find(({ bookingId }) => bookingId === id)
          ?.userKeys ?? []
      ).map((key) => userIds.get(key)!),
    ];
    return buildReminderNotifications(
      notificationBookingSnapshot({ booking, space, floor, branch }),
      recipients,
      now,
    );
  });
  await insertNotifications(reminders, db);
  const complete = await readRound2SeedState(source.references, db);
  const nextReceipt: BookingRound2Receipt = {
    version: 1,
    mode: "booking-round2",
    hostHash,
    manifestHash: source.manifestHash,
    appliedAt: now.toISOString(),
    bundleHash: bundleHash(data, extras, complete),
  };
  return {
    counts: {
      attendeeCounts: extras.attendeeCounts.length,
      bookingParticipants: extras.participants.reduce(
        (sum, row) => sum + row.userKeys.length,
        0,
      ),
      bookings: schedule.bookings.length,
      spaceBlocks: schedule.blocks.length,
      notifications: reminders.length,
    },
    skippedBookings: 0,
    accounts: [],
    bookingRound2: { applied: true, receipt: nextReceipt },
  };
}
