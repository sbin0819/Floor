import "server-only";

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  bookings,
  branches,
  branchStaff,
  floorPlans,
  floors,
  spaces,
  users,
} from "@/lib/db/schema";
import type { SeatDiff } from "@/lib/floor-plan/seat-diff";
import type { FloorPlanDocument } from "@/lib/floor-plan/types";
import type { DalDatabase } from "./database";

export async function lockPublishingDraft(floorId: string, db: DalDatabase) {
  const [row] = await db
    .select()
    .from(floorPlans)
    .where(and(eq(floorPlans.floorId, floorId), eq(floorPlans.status, "draft")))
    .for("update");
  return row ?? null;
}
export function lockPublishingSpaces(floorId: string, db: DalDatabase) {
  return db
    .select({ id: spaces.id })
    .from(spaces)
    .where(and(eq(spaces.floorId, floorId), isNull(spaces.archivedAt)))
    .orderBy(asc(spaces.id))
    .for("share");
}
export function lockChangedPlanSpaces(
  floorId: string,
  ids: string[],
  db: DalDatabase,
) {
  if (ids.length === 0) return Promise.resolve([]);
  return db
    .select({ id: spaces.id })
    .from(spaces)
    .where(and(eq(spaces.floorId, floorId), inArray(spaces.id, ids)))
    .orderBy(asc(spaces.id))
    .for("update");
}
export function lockPlanBookings(ids: string[], db: DalDatabase) {
  if (ids.length === 0) return Promise.resolve([]);
  return db
    .select({
      id: bookings.id,
      spaceId: bookings.spaceId,
      during: bookings.during,
    })
    .from(bookings)
    .where(
      and(inArray(bookings.spaceId, ids), eq(bookings.status, "confirmed")),
    )
    .orderBy(asc(bookings.id))
    .for("update");
}
export function listPublishBookings(
  input: {
    floorId: string;
    userId: string;
    showBooker: boolean;
    now: Date;
  },
  db: DalDatabase = getDb(),
) {
  return db
    .select({
      spaceId: spaces.id,
      seatName: spaces.name,
      during: bookings.during,
      bookerName: sql<
        string | null
      >`case when ${input.showBooker} then ${users.name} else null end`,
      openHours: branches.openHours,
    })
    .from(bookings)
    .innerJoin(spaces, eq(spaces.id, bookings.spaceId))
    .innerJoin(floors, eq(floors.id, spaces.floorId))
    .innerJoin(branches, eq(branches.id, floors.branchId))
    .innerJoin(
      branchStaff,
      and(
        eq(branchStaff.branchId, branches.id),
        eq(branchStaff.userId, input.userId),
      ),
    )
    .innerJoin(users, eq(users.id, bookings.userId))
    .where(
      and(
        eq(floors.id, input.floorId),
        eq(bookings.status, "confirmed"),
        sql`upper(${bookings.during}) > ${input.now.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(asc(sql`lower(${bookings.during})`), asc(bookings.id));
}
export function listPlanVersions(
  floorId: string,
  userId: string,
  db: DalDatabase = getDb(),
) {
  return db
    .select({
      planId: floorPlans.id,
      version: floorPlans.version,
      status: floorPlans.status,
      publishedAt: floorPlans.publishedAt,
      publishedByName: users.name,
    })
    .from(floorPlans)
    .innerJoin(floors, eq(floors.id, floorPlans.floorId))
    .innerJoin(
      branchStaff,
      and(
        eq(branchStaff.branchId, floors.branchId),
        eq(branchStaff.userId, userId),
      ),
    )
    .leftJoin(
      users,
      sql`${users.id} = coalesce(${floorPlans.updatedBy}, ${floorPlans.createdBy})`,
    )
    .where(
      and(
        eq(floorPlans.floorId, floorId),
        inArray(floorPlans.status, ["published", "archived"]),
      ),
    )
    .orderBy(desc(floorPlans.version));
}
export async function getRestorablePlan(
  floorId: string,
  version: number,
  db: DalDatabase,
) {
  const [row] = await db
    .select({
      id: floorPlans.id,
      document: floorPlans.document,
      backgroundImage: floorPlans.backgroundImage,
    })
    .from(floorPlans)
    .where(
      and(
        eq(floorPlans.floorId, floorId),
        eq(floorPlans.version, version),
        inArray(floorPlans.status, ["published", "archived"]),
      ),
    );
  return row ?? null;
}
export function listArchivedPlanDesks(
  floorId: string,
  ids: string[],
  db: DalDatabase,
) {
  if (ids.length === 0) return Promise.resolve([]);
  return db
    .select({ id: spaces.id, name: spaces.name })
    .from(spaces)
    .where(
      and(
        eq(spaces.floorId, floorId),
        eq(spaces.type, "desk"),
        inArray(spaces.id, ids),
        sql`${spaces.archivedAt} is not null`,
      ),
    )
    .orderBy(asc(spaces.id))
    .for("share");
}
export async function replaceDraftVersion(
  input: {
    planId: string;
    revision: number;
    document: FloorPlanDocument;
    backgroundImage: string | null;
    userId: string;
    now: Date;
  },
  db: DalDatabase,
) {
  const [row] = await db
    .update(floorPlans)
    .set({
      document: input.document,
      backgroundImage: input.backgroundImage,
      revision: sql`${floorPlans.revision}+1`,
      updatedBy: input.userId,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(floorPlans.id, input.planId),
        eq(floorPlans.status, "draft"),
        eq(floorPlans.revision, input.revision),
      ),
    )
    .returning({
      planId: floorPlans.id,
      version: floorPlans.version,
      revision: floorPlans.revision,
    });
  return row ?? null;
}
export async function writePublishedSeats(
  floorId: string,
  diff: SeatDiff,
  now: Date,
  db: DalDatabase,
) {
  if (diff.archived.length)
    await db
      .update(spaces)
      .set({ archivedAt: now })
      .where(
        and(
          eq(spaces.floorId, floorId),
          inArray(
            spaces.id,
            diff.archived.map((seat) => seat.id),
          ),
          isNull(spaces.archivedAt),
        ),
      );
  const renamed = diff.updated.filter(
    (seat) => seat.name !== seat.previousName,
  );
  if (renamed.length)
    await db
      .update(spaces)
      .set({ name: sql`'~' || ${spaces.id}::text` })
      .where(
        and(
          eq(spaces.floorId, floorId),
          inArray(
            spaces.id,
            renamed.map((seat) => seat.id),
          ),
          isNull(spaces.archivedAt),
        ),
      );
  // 기존 ID와 좌석의 정원·설비·예약 규칙은 보존한다.
  if (diff.updated.length) {
    const changed = sql.join(
      diff.updated.map(
        (seat) =>
          sql`(${seat.id}::uuid, ${seat.name}::text, ${seat.parentId}::uuid)`,
      ),
      sql`, `,
    );
    await db
      .update(spaces)
      .set({ name: sql`changed.name`, parentId: sql`changed.parent_id` })
      .from(sql`(values ${changed}) as changed(id, name, parent_id)`)
      .where(
        and(
          eq(spaces.id, sql`changed.id`),
          eq(spaces.floorId, floorId),
          isNull(spaces.archivedAt),
        ),
      );
  }
  if (diff.created.length)
    await db.insert(spaces).values(
      diff.created.map((seat) => ({
        id: seat.id,
        floorId,
        parentId: seat.parentId,
        name: seat.name,
        type: "desk" as const,
        capacity: 1,
        bookable: true,
        access: null,
        amenities: [],
        createdAt: now,
      })),
    );
  if (diff.occupiedAreaIds.length)
    await db
      .update(spaces)
      .set({ bookable: false })
      .where(
        and(
          eq(spaces.floorId, floorId),
          inArray(spaces.id, diff.occupiedAreaIds),
          eq(spaces.type, "desk_area"),
          isNull(spaces.archivedAt),
        ),
      );
}
export async function publishPlanRecord(
  input: {
    floorId: string;
    planId: string;
    revision: number;
    userId: string;
    now: Date;
  },
  db: DalDatabase,
) {
  await db
    .update(floorPlans)
    .set({ status: "archived" })
    .where(
      and(
        eq(floorPlans.floorId, input.floorId),
        eq(floorPlans.status, "published"),
      ),
    );
  const [row] = await db
    .update(floorPlans)
    .set({
      status: "published",
      publishedAt: input.now,
      updatedAt: input.now,
      updatedBy: input.userId,
    })
    .where(
      and(
        eq(floorPlans.id, input.planId),
        eq(floorPlans.floorId, input.floorId),
        eq(floorPlans.status, "draft"),
        eq(floorPlans.revision, input.revision),
      ),
    )
    .returning({ planId: floorPlans.id, version: floorPlans.version });
  if (!row) return null;
  await db
    .update(floors)
    .set({ publishedPlanId: row.planId })
    .where(eq(floors.id, input.floorId));
  return row;
}
