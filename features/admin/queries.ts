import { ActionError } from "@/lib/actions/result";
import { requireSession } from "@/lib/auth/session";
import { getOperatorBranches } from "@/lib/dal";

export async function getOperatorHome() {
  const session = await requireSession();
  const branches = await getOperatorBranches(session.userId);
  if (branches.length === 0) throw new ActionError("FORBIDDEN");
  return { session, branches };
}
