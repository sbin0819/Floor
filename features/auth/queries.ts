import { requireSession } from "@/lib/auth/session";
import { readAccountMenu } from "@/lib/dal/people-status";
import { toAvatar } from "@/lib/avatar";
import { ActionError } from "@/lib/actions/result";

export async function getAccountMenuData() {
  const session = await requireSession();
  const account = await readAccountMenu(session.userId);
  if (!account) throw new ActionError("UNAUTHENTICATED");
  return {
    name: account.name,
    avatar: toAvatar(account.avatar),
    email: session.email,
    isOperator: account?.isOperator ?? false,
    myStatus: account?.myStatus ?? "online",
    username: account?.username ?? null,
  };
}
