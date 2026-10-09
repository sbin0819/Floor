import "server-only";

import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { floorPlans, floors } from "@/lib/db/schema";
import type { DalDatabase } from "./database";

const draftColumns = {
  id: floorPlans.id,
  floorId: floorPlans.floorId,
  backgroundImage: floorPlans.backgroundImage,
};
export async function readBackgroundDraft(
  floorId: string,
  db: DalDatabase = getDb(),
) {
  const [row] = await db
    .select(draftColumns)
    .from(floorPlans)
    .where(
      and(eq(floorPlans.floorId, floorId), eq(floorPlans.status, "draft")),
    );
  return row ?? null;
}
export async function lockBackgroundDraft(
  floorId: string,
  db: DalDatabase = getDb(),
) {
  const [row] = await db
    .select(draftColumns)
    .from(floorPlans)
    .where(and(eq(floorPlans.floorId, floorId), eq(floorPlans.status, "draft")))
    .for("update");
  return row ?? null;
}
export async function updatePlanBackground(
  input: { planId: string; floorId: string; key: string },
  db: DalDatabase = getDb(),
) {
  const [row] = await db
    .update(floorPlans)
    .set({ backgroundImage: input.key })
    .where(
      and(
        eq(floorPlans.id, input.planId),
        eq(floorPlans.floorId, input.floorId),
        eq(floorPlans.status, "draft"),
      ),
    )
    .returning({ id: floorPlans.id });
  return row ?? null;
}
export async function readPlanBackground(
  planId: string,
  db: DalDatabase = getDb(),
) {
  const [row] = await db
    .select({
      branchId: floors.branchId,
      backgroundImage: floorPlans.backgroundImage,
    })
    .from(floorPlans)
    .innerJoin(floors, eq(floors.id, floorPlans.floorId))
    .where(eq(floorPlans.id, planId));
  return row ?? null;
}
