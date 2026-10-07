import { ActionError, type ActionErrorCode } from "@/lib/actions/result";

export function getActionErrorCode(error: unknown): ActionErrorCode {
  if (error instanceof ActionError) return error.code;

  const visited = new Set<object>();
  let current = error;

  while (
    typeof current === "object" &&
    current !== null &&
    !visited.has(current)
  ) {
    visited.add(current);
    if ("code" in current && current.code === "23P01")
      return "BOOKING_CONFLICT";
    current = "cause" in current ? current.cause : undefined;
  }

  return "INTERNAL";
}
