import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ActionError } from "@/lib/actions/result";
import { getAuth } from "@/lib/auth/auth";
import { hasSessionCookie } from "@/lib/auth/cookies";
import { safeNext } from "@/lib/auth/safe-next";
import type { Session } from "@/lib/auth/types";
import { getOperatorBranches } from "@/lib/dal";

export type { Session } from "@/lib/auth/types";

export async function getSession(): Promise<Session | null> {
  const requestHeaders = await headers();
  if (!hasSessionCookie(requestHeaders)) return null;
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  return session
    ? {
        userId: session.user.id,
        email: session.user.email,
        name: session.user.name,
      }
    : null;
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new ActionError("UNAUTHENTICATED");
  return session;
}

export async function requirePageSession(next: string): Promise<Session> {
  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(safeNext(next))}`);
  return session;
}

export async function requireOperatorPage(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/admin/login");
  if ((await getOperatorBranches(session.userId)).length === 0)
    redirect("/admin/login?error=not_operator");
  return session;
}
