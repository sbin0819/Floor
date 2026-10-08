import "server-only";

import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { DalDatabase } from "@/lib/dal/database";
import { getDb } from "@/lib/db/client";
import { serializeTimeRange, type TimeRange } from "@/lib/db/range";
import {
  accessGrants,
  bookings,
  floorPlans,
  floors,
  spaceBlocks,
  spaces,
  teams,
  users,
} from "@/lib/db/schema";
import type { FloorPlanDocument } from "@/lib/floor-plan/types";

export async function getDeskForAccess(
  deskId: string,
  database: DalDatabase = getDb(),
) {
  const area = alias(spaces, "desk_area");
  const floorGrants = alias(accessGrants, "desk_floor_grants");
  const areaGrants = alias(accessGrants, "desk_area_grants");
  const rows = await database
    .select({
      desk: spaces,
      area,
      floor: floors,
      floorTeamId: floorGrants.teamId,
      areaTeamId: areaGrants.teamId,
    })
    .from(spaces)
    .innerJoin(
      area,
      and(eq(area.id, spaces.parentId), eq(area.floorId, spaces.floorId)),
    )
    .innerJoin(floors, eq(floors.id, area.floorId))
    .leftJoin(
      floorGrants,
      and(
        eq(floorGrants.targetType, "floor"),
        eq(floorGrants.targetId, floors.id),
      ),
    )
    .leftJoin(
      areaGrants,
      and(eq(areaGrants.targetType, "space"), eq(areaGrants.targetId, area.id)),
    )
    .where(
      and(
        eq(spaces.id, deskId),
        eq(spaces.type, "desk"),
        eq(area.type, "desk_area"),
        eq(area.bookable, false),
        isNull(spaces.archivedAt),
        isNull(area.archivedAt),
      ),
    );
  const first = rows[0];
  if (!first) return null;
  return {
    desk: first.desk,
    area: {
      ...first.area,
      allowedTeamIds: [
        ...new Set(
          rows.flatMap(({ areaTeamId }) => (areaTeamId ? [areaTeamId] : [])),
        ),
      ],
      floor: {
        ...first.floor,
        allowedTeamIds: [
          ...new Set(
            rows.flatMap(({ floorTeamId }) =>
              floorTeamId ? [floorTeamId] : [],
            ),
          ),
        ],
      },
    },
  };
}

export async function listDesks(
  parentIds: string[],
  database: DalDatabase = getDb(),
) {
  if (!parentIds.length) return [];
  const area = alias(spaces, "desk_area");
  return database
    .select({
      id: spaces.id,
      name: spaces.name,
      parentId: area.id,
      bookable: spaces.bookable,
    })
    .from(spaces)
    .innerJoin(
      area,
      and(eq(area.id, spaces.parentId), eq(area.floorId, spaces.floorId)),
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
    .orderBy(asc(spaces.name), asc(spaces.id));
}

export type DeskScheduleInput = { parentIds: string[]; during: TimeRange };
export async function listDeskBookings(
  { parentIds, during }: DeskScheduleInput,
  database: DalDatabase = getDb(),
) {
  if (!parentIds.length) return [];
  const area = alias(spaces, "desk_area");
  return database
    .select({
      id: bookings.id,
      spaceId: spaces.id,
      parentId: area.id,
      userId: bookings.userId,
      teamId: bookings.teamId,
      during: bookings.during,
    })
    .from(bookings)
    .innerJoin(spaces, eq(spaces.id, bookings.spaceId))
    .innerJoin(
      area,
      and(eq(area.id, spaces.parentId), eq(area.floorId, spaces.floorId)),
    )
    .where(
      and(
        inArray(area.id, parentIds),
        eq(area.type, "desk_area"),
        eq(area.bookable, false),
        eq(spaces.type, "desk"),
        isNull(spaces.archivedAt),
        isNull(area.archivedAt),
        eq(bookings.status, "confirmed"),
        sql`${bookings.during} && ${serializeTimeRange(during)}::tstzrange`,
      ),
    )
    .orderBy(asc(sql`lower(${bookings.during})`), asc(bookings.id));
}

export async function listDeskBlocks(
  { parentIds, during }: DeskScheduleInput,
  database: DalDatabase = getDb(),
) {
  if (!parentIds.length) return [];
  const area = alias(spaces, "desk_area");
  return database
    .select({
      id: spaceBlocks.id,
      spaceId: spaces.id,
      parentId: area.id,
      during: spaceBlocks.during,
    })
    .from(spaceBlocks)
    .innerJoin(spaces, eq(spaces.id, spaceBlocks.spaceId))
    .innerJoin(
      area,
      and(
        eq(area.floorId, spaces.floorId),
        or(
          eq(area.id, spaces.id),
          and(eq(spaces.type, "desk"), eq(area.id, spaces.parentId)),
        ),
      ),
    )
    .where(
      and(
        inArray(area.id, parentIds),
        eq(area.type, "desk_area"),
        eq(area.bookable, false),
        isNull(spaces.archivedAt),
        isNull(area.archivedAt),
        sql`${spaceBlocks.during} && ${serializeTimeRange(during)}::tstzrange`,
      ),
    )
    .orderBy(asc(sql`lower(${spaceBlocks.during})`), asc(spaceBlocks.id));
}

export async function hasUserDeskBookingOverlap(
  userId: string,
  during: TimeRange,
  database: DalDatabase = getDb(),
): Promise<boolean> {
  const [row] = await database
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(spaces, eq(spaces.id, bookings.spaceId))
    .where(
      and(
        eq(bookings.userId, userId),
        eq(spaces.type, "desk"),
        eq(bookings.status, "confirmed"),
        sql`${bookings.during} && ${serializeTimeRange(during)}::tstzrange`,
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function listFloorSeats(
  floorId: string,
  database: DalDatabase = getDb(),
): Promise<FloorPlanDocument["seats"]> {
  const [row] = await database
    .select({
      seats: sql<FloorPlanDocument["seats"]>`${floorPlans.document} -> 'seats'`,
    })
    .from(floors)
    .innerJoin(floorPlans, eq(floorPlans.id, floors.publishedPlanId))
    .where(
      and(
        eq(floors.id, floorId),
        eq(floorPlans.floorId, floors.id),
        eq(floorPlans.status, "published"),
      ),
    )
    .limit(1);
  return row?.seats ?? [];
}

export async function lockDeskBookingActor(
  { userId, teamId }: { userId: string; teamId: string | null },
  transaction: DalDatabase,
): Promise<boolean> {
  const [user] = await transaction
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .for("update");
  if (!user) return false;
  if (teamId === null) return true;
  const [team] = await transaction
    .select({ id: teams.id })
    .from(teams)
    .where(eq(teams.id, teamId))
    .for("update");
  return Boolean(team);
}
