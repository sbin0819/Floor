import { requireSession } from "@/lib/auth/session";
import { getOperatorBranches } from "@/lib/dal";

export async function getAccountMenuData() {
  const session = await requireSession();
  const branches = await getOperatorBranches(session.userId);
  return {
    name: session.name,
    email: session.email,
    isOperator: branches.length > 0,
  };
}
