import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ActionError } from "@/lib/actions/result";
import { getAuth } from "@/lib/auth/auth";
import { hasSessionCookie } from "@/lib/auth/cookies";
import { safeNext } from "@/lib/auth/safe-next";
import type { Session } from "@/lib/auth/types";
import { getOperatorBranches } from "@/lib/dal";

export type { Session } from "@/lib/auth/types";

const getRawSession = cache(async () => {
  const requestHeaders = await headers();
  if (!hasSessionCookie(requestHeaders)) return null;
  return getAuth().api.getSession({ headers: requestHeaders });
});

// 인증 경계 안에서만 소비하고 앱의 Session에는 식별자나 토큰을 추가하지 않는다.
export async function getCurrentSessionId(): Promise<string | null> {
  return (await getRawSession())?.session.id ?? null;
}

export const getSession = cache(async (): Promise<Session | null> => {
  const session = await getRawSession();
  return session
    ? {
        userId: session.user.id,
        email: session.user.email,
        name: session.user.name,
      }
    : null;
});

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
