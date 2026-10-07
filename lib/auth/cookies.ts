import { getSessionCookie } from "better-auth/cookies";

export function hasSessionCookie(headers: Headers): boolean {
  return Boolean(getSessionCookie(headers));
}
