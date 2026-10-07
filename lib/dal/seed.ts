import "server-only";

// 고정된 가상 데이터만 다루는 시드 전용 쓰기다. 기능 액션에서 사용하지 않는다.
import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { DalDatabase } from "@/lib/dal/database";
import { serializeTimeRange, type TimeRange } from "@/lib/db/range";
import {
  accessGrants,
  bookings,
  branches,
  branchStaff,
  floorPlans,
  floors,
  spaceBlocks,
  spaces,
  teamMembers,
  teams,
} from "@/lib/db/schema";

export async function upsertSeedBranch(
  input: typeof branches.$inferInsert,
  db: DalDatabase,
) {
  await db
    .insert(branches)
    .values(input)
    .onConflictDoUpdate({ target: branches.id, set: input });
}
export async function upsertSeedFloor(
  input: Omit<typeof floors.$inferInsert, "publishedPlanId">,
  db: DalDatabase,
) {
  await db
    .insert(floors)
    .values(input)
    .onConflictDoUpdate({ target: floors.id, set: input });
}
export async function upsertSeedSpace(
  input: typeof spaces.$inferInsert,
  db: DalDatabase,
) {
  await db
    .insert(spaces)
    .values(input)
    .onConflictDoUpdate({ target: spaces.id, set: input });
}
export async function upsertSeedTeam(
  input: typeof teams.$inferInsert,
  db: DalDatabase,
) {
  await db
    .insert(teams)
    .values(input)
    .onConflictDoUpdate({ target: teams.id, set: input });
}
export async function upsertSeedMember(
  input: typeof teamMembers.$inferInsert,
  db: DalDatabase,
) {
  await db
    .insert(teamMembers)
    .values(input)
    .onConflictDoUpdate({
      target: [teamMembers.teamId, teamMembers.userId],
      set: { role: input.role, title: input.title },
    });
}
export async function upsertSeedStaff(
  input: typeof branchStaff.$inferInsert,
  db: DalDatabase,
) {
  await db.insert(branchStaff).values(input).onConflictDoNothing();
}
export async function replaceSeedGrants(
  floorIds: string[],
  spaceIds: string[],
  grants: (typeof accessGrants.$inferInsert)[],
  db: DalDatabase,
) {
  await db
    .delete(accessGrants)
    .where(
      or(
        and(
          eq(accessGrants.targetType, "floor"),
          inArray(accessGrants.targetId, floorIds),
        ),
        and(
          eq(accessGrants.targetType, "space"),
          inArray(accessGrants.targetId, spaceIds),
        ),
      ),
    );
  if (grants.length) await db.insert(accessGrants).values(grants);
}
export async function putSeedPlan(
  input: typeof floorPlans.$inferInsert,
  db: DalDatabase,
): Promise<boolean> {
  const [published] = await db
    .select({ id: floorPlans.id })
    .from(floorPlans)
    .where(
      and(
        eq(floorPlans.floorId, input.floorId),
        eq(floorPlans.status, "published"),
      ),
    );
  if (published && published.id !== input.id) return false;
  const [existing] = await db
    .select({
      id: floorPlans.id,
      status: floorPlans.status,
      floorId: floorPlans.floorId,
    })
    .from(floorPlans)
    .where(eq(floorPlans.id, input.id!));
  if (!existing) await db.insert(floorPlans).values(input);
  if (
    !existing ||
    (existing.status === "published" && existing.floorId === input.floorId)
  ) {
    await db
      .update(floors)
      .set({ publishedPlanId: input.id })
      .where(eq(floors.id, input.floorId));
  }
  return true;
}
export async function clearSeedSchedule(
  bookingIds: string[],
  blockIds: string[],
  db: DalDatabase,
) {
  if (bookingIds.length)
    await db.delete(bookings).where(inArray(bookings.id, bookingIds));
  if (blockIds.length)
    await db.delete(spaceBlocks).where(inArray(spaceBlocks.id, blockIds));
}
export async function insertSeedBlock(
  input: typeof spaceBlocks.$inferInsert,
  db: DalDatabase,
) {
  await db.insert(spaceBlocks).values(input);
}
export async function hasSeedBookingOverlap(
  spaceId: string,
  during: TimeRange,
  db: DalDatabase,
) {
  const [row] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.spaceId, spaceId),
        eq(bookings.status, "confirmed"),
        sql`${bookings.during} && ${serializeTimeRange(during)}::tstzrange`,
      ),
    )
    .limit(1);
  return Boolean(row);
}
export async function insertSeedBooking(
  input: typeof bookings.$inferInsert,
  db: DalDatabase,
) {
  await db.insert(bookings).values(input);
}
