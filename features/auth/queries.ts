import { requireSession } from "@/lib/auth/session";
import { readAccountMenu } from "@/lib/dal/people-status";

export async function getAccountMenuData() {
  const session = await requireSession();
  const account = await readAccountMenu(session.userId);
  return {
    name: session.name,
    email: session.email,
    isOperator: account?.isOperator ?? false,
    myStatus: account?.myStatus ?? "online",
    username: account?.username ?? null,
  };
}
