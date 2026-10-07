export type ActionErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "BOOKING_CONFLICT"
  | "SPACE_BLOCKED"
  | "LIMIT_EXCEEDED"
  | "PLAN_INVALID"
  | "TEAM_NAME_TAKEN"
  | "ALREADY_MEMBER"
  | "ALREADY_REQUESTED"
  | "INVITE_INVALID"
  | "INTERNAL";

export type ActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: ActionErrorCode;
      message?: string;
      fieldErrors?: Record<string, string[]>;
    };

export class ActionError extends Error {
  constructor(public readonly code: ActionErrorCode) {
    super(code);
    this.name = "ActionError";
  }
}
