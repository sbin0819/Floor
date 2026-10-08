import { ActionError, type ActionErrorCode } from "@/lib/actions/result";

export function getActionErrorCode(error: unknown): ActionErrorCode {
  if (error instanceof ActionError) return error.code;
  const databaseError = getPostgresError(error);
  if (databaseError?.code === "23P01") return "BOOKING_CONFLICT";
  if (databaseError?.code === "23505") {
    if (databaseError.constraint === "chat_rooms_space_name_unique")
      return "CHANNEL_NAME_TAKEN";
    if (databaseError.constraint === "users_username_unique")
      return "USERNAME_TAKEN";
    if (databaseError.constraint === "teams_name_unique")
      return "TEAM_NAME_TAKEN";
    if (databaseError.constraint === "team_join_requests_one_pending")
      return "ALREADY_REQUESTED";
  }
  return "INTERNAL";
}

export function getPostgresError(
  error: unknown,
): { code: string; constraint?: string } | null {
  const visited = new Set<object>();
  let current = error;

  while (
    typeof current === "object" &&
    current !== null &&
    !visited.has(current)
  ) {
    visited.add(current);
    if (
      "code" in current &&
      typeof current.code === "string" &&
      /^[0-9A-Z]{5}$/.test(current.code)
    )
      return {
        code: current.code,
        ...("constraint" in current && typeof current.constraint === "string"
          ? { constraint: current.constraint }
          : {}),
      };
    current = "cause" in current ? current.cause : undefined;
  }

  return null;
}
