import type { ActionErrorCode } from "@/lib/actions/result";

export type ApiErrorKind = "http" | "network" | "timeout" | "invalid_response";

export class ApiError extends Error {
  readonly status?: number;
  readonly code?: ActionErrorCode;
  readonly retryAfterMs?: number;

  constructor(
    readonly kind: ApiErrorKind,
    details: {
      status?: number;
      code?: ActionErrorCode;
      retryAfterMs?: number;
    } = {},
  ) {
    super("요청을 완료하지 못했어요.");
    this.name = "ApiError";
    this.status = details.status;
    this.code = details.code;
    this.retryAfterMs = details.retryAfterMs;
  }
}

export function isRequestCanceled(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

const allowedCodes: Record<ActionErrorCode, true> = {
  UNAUTHENTICATED: true,
  FORBIDDEN: true,
  INVALID_INPUT: true,
  PASSWORD_INCORRECT: true,
  LAST_ADMIN: true,
  NOT_FOUND: true,
  BOOKING_CONFLICT: true,
  SPACE_BLOCKED: true,
  STALE: true,
  LIMIT_EXCEEDED: true,
  PLAN_INVALID: true,
  TEAM_NAME_TAKEN: true,
  CHANNEL_NAME_TAKEN: true,
  USERNAME_TAKEN: true,
  ALREADY_MEMBER: true,
  ALREADY_REQUESTED: true,
  INVITE_INVALID: true,
  OUTSIDE_HOURS: true,
  SPACE_IN_USE: true,
  OVER_CAPACITY: true,
  INTERNAL: true,
};

export function isActionErrorCode(code: unknown): code is ActionErrorCode {
  return typeof code === "string" && Object.hasOwn(allowedCodes, code);
}

export function parseRetryAfter(value: unknown, now = Date.now()): number {
  if (typeof value !== "string" || !value.trim()) return 1_000;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0)
    return Math.min(seconds * 1_000, 2_147_483_647);
  const date = Date.parse(value);
  return Number.isFinite(date)
    ? Math.min(Math.max(0, date - now), 2_147_483_647)
    : 1_000;
}
