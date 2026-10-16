"use client";

import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { safeNext } from "@/lib/auth/safe-next";
import { isSessionExpired, SESSION_EXPIRED_MESSAGE } from "./messages";

const notified = new WeakSet<QueryClient>();
const generations = new WeakMap<QueryClient, number>();
const obsoleteErrors = new WeakMap<QueryClient, WeakSet<object>>();
const toastId = "session-expired";

export function sessionNoticeGeneration(client: QueryClient) {
  return generations.get(client) ?? 0;
}

export function sessionLoginHref(pathname: string, search: string): string {
  if (pathname === "/admin" || pathname.startsWith("/admin/"))
    return "/admin/login";
  return `/login?next=${encodeURIComponent(safeNext(pathname + search))}`;
}

export function notifySessionExpired(
  client: QueryClient,
  error: unknown,
  generation = sessionNoticeGeneration(client),
): boolean {
  if (!isSessionExpired(error)) return false;
  if (typeof error === "object" && error !== null) {
    if (generation !== sessionNoticeGeneration(client)) {
      const errors = obsoleteErrors.get(client) ?? new WeakSet<object>();
      errors.add(error);
      obsoleteErrors.set(client, errors);
      return true;
    }
    if (obsoleteErrors.get(client)?.has(error)) return true;
  }
  if (typeof window === "undefined") return true;
  if (notified.has(client)) return true;
  notified.add(client);
  toast.error(SESSION_EXPIRED_MESSAGE, {
    id: toastId,
    duration: Infinity,
    action: {
      label: "로그인하기",
      onClick: () =>
        window.location.assign(
          sessionLoginHref(window.location.pathname, window.location.search),
        ),
    },
  });
  return true;
}

export function resetSessionExpiredNotice(client: QueryClient) {
  // 로그인 이전 작업의 늦은 실패는 새 로그인 안내를 만들지 않는다.
  generations.set(client, sessionNoticeGeneration(client) + 1);
  if (!notified.delete(client)) return;
  toast.dismiss(toastId);
}
