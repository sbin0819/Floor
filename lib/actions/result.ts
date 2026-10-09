export type ActionErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "INVALID_INPUT"
  | "PASSWORD_INCORRECT"
  | "LAST_ADMIN"
  | "NOT_FOUND"
  | "BOOKING_CONFLICT"
  | "SPACE_BLOCKED"
  | "STALE"
  | "LIMIT_EXCEEDED"
  | "PLAN_INVALID"
  | "TEAM_NAME_TAKEN"
  | "CHANNEL_NAME_TAKEN"
  | "USERNAME_TAKEN"
  | "ALREADY_MEMBER"
  | "ALREADY_REQUESTED"
  | "INVITE_INVALID"
  | "OUTSIDE_HOURS"
  | "SPACE_IN_USE"
  | "OVER_CAPACITY"
  | "INTERNAL";

export type ActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: ActionErrorCode;
      message?: string;
      fieldErrors?: Record<string, string[]>;
    };

export type ActionErrorDetails = {
  message?:
    | "per_booking"
    | "per_day"
    | "days_ahead"
    | "send_rate"
    | "reaction_rate"
    | "username_cooldown"
    | "friend_daily"
    | "friend_cooldown"
    | "report_daily"
    | "request_daily"
    | "request_pending"
    | "space_count"
    | "space_join_count"
    | "invite_count"
    | "channel_count"
    | "space_full"
    | "call_full"
    | "storage_quota"
    | "password_attempts"
    | "admin_teams"
    | "desk_per_person"
    | "attendee_count"
    | "not_cancellable"
    | "maintenance_state"
    | "participants";
  fieldErrors?: Record<string, string[]>;
};

export class ActionError extends Error {
  constructor(
    public readonly code: ActionErrorCode,
    public readonly details: ActionErrorDetails = {},
  ) {
    super(code);
    this.name = "ActionError";
  }
}
