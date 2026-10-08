import { createDeskParts } from "@/features/bookings/desk-parts";
import type { DalDatabase } from "@/lib/dal";
import { hasUserDeskBookingOverlap } from "@/lib/dal/desks";
import {
  hasSeedBookingOverlap,
  insertSeedBlock,
  insertSeedBooking,
} from "@/lib/dal/seed";
import type { SeedBookings2Data } from "@/lib/seed/bookings-2";
import type { SeedData } from "@/lib/seed/data";
import { SeedError } from "@/lib/seed/errors";
import { getOperatingDate } from "@/lib/time/open-hours";
import { zonedDateTime } from "@/lib/time/zoned";

export function scopedDeskSchedule(data: SeedData, extras: SeedBookings2Data) {
  const ids = new Set(data.spaces.map(({ id }) => id));
  return {
    bookings: extras.deskBookings.filter(({ deskId }) => ids.has(deskId)),
    blocks: extras.deskBlocks.filter(({ spaceId }) => ids.has(spaceId)),
  };
}

export async function insertSeedDeskSchedule({
  data,
  extras,
  userIds,
  now,
  database,
}: {
  data: SeedData;
  extras: SeedBookings2Data;
  userIds: ReadonlyMap<string, string>;
  now: Date;
  database: DalDatabase;
}) {
  const selected = scopedDeskSchedule(data, extras);
  const spaces = new Map(data.spaces.map((row) => [row.id, row]));
  const floors = new Map(data.floors.map((row) => [row.id, row]));
  const branches = new Map(data.branches.map((row) => [row.id, row]));
  const branchFor = (id: string) =>
    branches.get(floors.get(spaces.get(id)!.floorId)!.branchId)!;
  const userId = (key: string) => {
    const id = userIds.get(key);
    if (!id) throw new SeedError("좌석 시드가 참조하는 계정이 없어요.");
    return id;
  };
  for (const block of selected.blocks) {
    const branch = branchFor(block.spaceId);
    const instant = (offset: number, time: string) =>
      zonedDateTime(
        getOperatingDate(now, branch.timezone, branch.openHours, offset),
        time,
        branch.timezone,
      );
    await insertSeedBlock(
      {
        id: block.id,
        spaceId: block.spaceId,
        during: {
          start: instant(block.startDayOffset, block.start),
          end: instant(block.endDayOffset, block.end),
        },
        reason: block.reason,
        createdBy: userId(block.createdByKey),
        createdAt: now,
      },
      database,
    );
  }
  let skippedBookings = 0;
  for (const booking of selected.bookings) {
    const branch = branchFor(booking.deskId);
    const date = getOperatingDate(
      now,
      branch.timezone,
      branch.openHours,
      booking.dayOffset,
    );
    const part = createDeskParts({
      date,
      timeZone: branch.timezone,
      openHours: branch.openHours,
    }).find(({ part }) => part === booking.part);
    if (!part)
      throw new SeedError("좌석 시드의 이용 구간이 운영 시간 안에 없어요.");
    const during = { start: new Date(part.start), end: new Date(part.end) };
    const ownerId = userId(booking.userKey);
    if (
      (await hasSeedBookingOverlap(booking.deskId, during, database)) ||
      (await hasUserDeskBookingOverlap(ownerId, during, database))
    ) {
      skippedBookings++;
      continue;
    }
    await insertSeedBooking(
      {
        id: booking.id,
        spaceId: booking.deskId,
        userId: ownerId,
        teamId: booking.teamId,
        during,
        status: "confirmed",
        title: null,
        attendeeCount: null,
        createdAt: now,
      },
      database,
    );
  }
  return {
    bookings: selected.bookings.length - skippedBookings,
    spaceBlocks: selected.blocks.length,
    skippedBookings,
  };
}
