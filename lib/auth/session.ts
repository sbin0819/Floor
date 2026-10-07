import "server-only";

import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import { z } from "zod";

import { ActionError } from "@/lib/actions/result";
import type { Session } from "@/lib/auth/types";
import { getUserById } from "@/lib/dal";
import { getEnv } from "@/lib/env";

export type { Session } from "@/lib/auth/types";

export const sessionCookieName = "floor_session";
export const sessionMaxAge = 60 * 60 * 24 * 7;

export async function getSession(): Promise<Session | null> {
  const env = getEnv();
  if (env.AUTH_MODE !== "demo" || !env.AUTH_SECRET) return null;

  const token = (await cookies()).get(sessionCookieName)?.value;
  if (!token) return null;

  let userId: string;
  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(env.AUTH_SECRET),
      {
        algorithms: ["HS256"],
        requiredClaims: ["sub", "iat", "exp"],
        maxTokenAge: sessionMaxAge,
      },
    );
    const subject = z.uuid().safeParse(payload.sub);
    if (!subject.success) return null;
    userId = subject.data;
  } catch {
    return null;
  }

  const user = await getUserById(userId);
  return user ? { userId: user.id, email: user.email, name: user.name } : null;
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new ActionError("UNAUTHENTICATED");
  return session;
}

export async function createSessionCookie(userId: string): Promise<void> {
  const env = getEnv();
  if (env.AUTH_MODE !== "demo" || !env.AUTH_SECRET) {
    throw new ActionError("UNAUTHENTICATED");
  }
  if (!z.uuid().safeParse(userId).success)
    throw new ActionError("INVALID_INPUT");

  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + sessionMaxAge;
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(new TextEncoder().encode(env.AUTH_SECRET));

  (await cookies()).set(sessionCookieName, token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: sessionMaxAge,
    expires: new Date(expiresAt * 1000),
  });
}

export async function clearSessionCookie(): Promise<void> {
  if (getEnv().AUTH_MODE !== "demo") return;
  (await cookies()).delete(sessionCookieName);
}
