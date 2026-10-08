import "server-only";

import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { DalDatabase } from "@/lib/dal/database";
import type { DeskScheduleInput } from "@/lib/dal/desks";
import { getDb } from "@/lib/db/client";
import { serializeTimeRange } from "@/lib/db/range";
import { bookings, spaceBlocks, spaces } from "@/lib/db/schema";

export async function readFloorDeskSchedule(
  { parentIds, during }: DeskScheduleInput,
  database: DalDatabase = getDb(),
) {
  const area = alias(spaces, "floor_desk_area");
  const rows = parentIds.length
    ? await database
        .select({
          desk: {
            id: spaces.id,
            name: spaces.name,
            parentId: area.id,
            bookable: spaces.bookable,
          },
          booking: {
            id: bookings.id,
            spaceId: bookings.spaceId,
            userId: bookings.userId,
            during: bookings.during,
          },
          block: {
            id: spaceBlocks.id,
            spaceId: spaceBlocks.spaceId,
            during: spaceBlocks.during,
          },
        })
        .from(spaces)
        .innerJoin(
          area,
          and(eq(area.id, spaces.parentId), eq(area.floorId, spaces.floorId)),
        )
        .leftJoin(
          bookings,
          and(
            eq(bookings.spaceId, spaces.id),
            eq(bookings.status, "confirmed"),
            sql`${bookings.during} && ${serializeTimeRange(during)}::tstzrange`,
          ),
        )
        .leftJoin(
          spaceBlocks,
          and(
            or(
              eq(spaceBlocks.spaceId, spaces.id),
              eq(spaceBlocks.spaceId, area.id),
            ),
            sql`${spaceBlocks.during} && ${serializeTimeRange(during)}::tstzrange`,
          ),
        )
        .where(
          and(
            inArray(area.id, parentIds),
            eq(area.type, "desk_area"),
            eq(area.bookable, false),
            eq(spaces.type, "desk"),
            isNull(spaces.archivedAt),
            isNull(area.archivedAt),
          ),
        )
        .orderBy(
          asc(spaces.name),
          asc(spaces.id),
          asc(bookings.id),
          asc(spaceBlocks.id),
        )
    : [];
  // 예약과 점검의 JOIN 중복을 제거해 층 조회의 기존 네 문장 예산을 유지한다.
  const desks = new Map<string, (typeof rows)[number]["desk"]>();
  const schedule = new Map<
    string,
    NonNullable<(typeof rows)[number]["booking"]>
  >();
  const blocks = new Map<string, NonNullable<(typeof rows)[number]["block"]>>();
  for (const row of rows) {
    desks.set(row.desk.id, row.desk);
    if (row.booking) schedule.set(row.booking.id, row.booking);
    if (row.block) blocks.set(row.block.id, row.block);
  }
  return {
    desks: [...desks.values()],
    bookings: [...schedule.values()],
    blocks: [...blocks.values()],
  };
}
