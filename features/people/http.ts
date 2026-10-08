import { ActionError } from "@/lib/actions/result";
import { RateLimitError } from "@/lib/rate-limit/memory";

export function peopleErrorResponse(error: unknown) {
  const headers = { "Cache-Control": "private, no-store" };
  if (error instanceof RateLimitError)
    return Response.json(
      { code: "RATE_LIMITED" },
      {
        status: 429,
        headers: { ...headers, "Retry-After": String(error.retryAfter) },
      },
    );
  if (error instanceof ActionError) {
    const status =
      error.code === "UNAUTHENTICATED"
        ? 401
        : error.code === "INVALID_INPUT"
          ? 400
          : error.code === "NOT_FOUND"
            ? 404
            : null;
    if (status) return Response.json({ code: error.code }, { status, headers });
  }
  return Response.json({ code: "INTERNAL" }, { status: 500, headers });
}
