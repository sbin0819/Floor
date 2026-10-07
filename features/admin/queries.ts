import { ActionError } from "@/lib/actions/result";
import { requireSession } from "@/lib/auth/session";
import { getOperatorBranches } from "@/lib/dal";
import { createAdminQueries } from "./query-factory";

export async function getAdminBranch(branchId: string) {
  return createAdminQueries().getAdminBranch(branchId);
}
export async function getAdminFloor(
  branchId: string,
  floorId: string,
  teamQuery?: unknown,
) {
  return createAdminQueries().getAdminFloor(branchId, floorId, teamQuery);
}

export async function getOperatorHome() {
  const session = await requireSession();
  const branches = await getOperatorBranches(session.userId);
  if (branches.length === 0) throw new ActionError("FORBIDDEN");
  return { session, branches };
}
