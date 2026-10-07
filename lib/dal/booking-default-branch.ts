import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import type { DalDatabase } from "@/lib/dal/database";
import { users } from "@/lib/db/schema";

export async function fillBookingDefaultBranch(
  userId: string,
  branchId: string,
  transaction: DalDatabase,
): Promise<void> {
  await transaction
    .update(users)
    .set({ defaultBranchId: branchId })
    .where(and(eq(users.id, userId), isNull(users.defaultBranchId)));
}
