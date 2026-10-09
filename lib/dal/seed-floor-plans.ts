import "server-only";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { floorPlans, floors, spaces, users } from "@/lib/db/schema";
import { SeedError } from "@/lib/seed/errors";
import type { DalDatabase } from "./database";

export async function prepareFloorPlansDatabase(
  databaseName: string,
  db: DalDatabase,
) {
  const [row] = await db
    .select({ name: sql<string>`pg_catalog.current_database()` })
    .from(sql`(select 1) seed_target`);
  if (row?.name !== databaseName)
    throw new SeedError("평면도 시드의 실제 DB 이름이 확인한 대상과 달라요.");
  await db
    .select({
      path: sql<string>`pg_catalog.set_config('search_path', 'pg_catalog, public, pg_temp', true)`,
    })
    .from(sql`(select 1) seed_path`);
}

export async function lockSeedPlanFloors(ids: string[], db: DalDatabase) {
  return db
    .select({
      id: floors.id,
      branchId: floors.branchId,
      publishedPlanId: floors.publishedPlanId,
    })
    .from(floors)
    .where(inArray(floors.id, ids))
    .orderBy(asc(floors.id))
    .for("update");
}
export async function readSeedPlanRows(
  floorIds: string[],
  planIds: string[],
  db: DalDatabase,
) {
  return db
    .select()
    .from(floorPlans)
    .where(
      or(
        inArray(floorPlans.floorId, floorIds),
        inArray(floorPlans.id, planIds),
      ),
    );
}
export async function lockSeedPlanSpaces(ids: string[], db: DalDatabase) {
  return db
    .select({ id: spaces.id, floorId: spaces.floorId, type: spaces.type })
    .from(spaces)
    .where(inArray(spaces.id, ids))
    .orderBy(asc(spaces.id))
    .for("share");
}
export async function lockSeedPlanAuthors(emails: string[], db: DalDatabase) {
  return db
    .select({
      id: users.id,
      email: users.email,
      emailVerified: users.emailVerified,
    })
    .from(users)
    .where(inArray(users.email, emails))
    .orderBy(asc(users.id))
    .for("share");
}
export async function insertSeedFloorPlan(
  input: typeof floorPlans.$inferInsert,
  db: DalDatabase,
) {
  await db.insert(floorPlans).values(input);
  const rows = await db
    .update(floors)
    .set({ publishedPlanId: input.id })
    .where(and(eq(floors.id, input.floorId), isNull(floors.publishedPlanId)))
    .returning({ id: floors.id });
  if (rows.length !== 1)
    throw new SeedError("평면도 연결이 바뀌었어요. 변경을 되돌렸어요.");
}
