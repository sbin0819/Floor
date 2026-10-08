import { connection } from "next/server";
import {
  getRealtimeToken,
  RealtimeDisabledError,
} from "@/features/chat/realtime-token";
import { ActionError } from "@/lib/actions/result";
import { RateLimitError } from "@/lib/rate-limit/memory";

export async function POST(request: Request) {
  await connection();
  const headers = { "Cache-Control": "private, no-store" };
  try {
    return Response.json(await getRealtimeToken(() => request.json()), {
      headers,
    });
  } catch (error) {
    if (error instanceof RealtimeDisabledError)
      return Response.json(
        { code: "REALTIME_DISABLED" },
        { status: 503, headers },
      );
    if (error instanceof RateLimitError)
      return Response.json(
        { code: "RATE_LIMITED" },
        {
          status: 429,
          headers: { ...headers, "Retry-After": String(error.retryAfter) },
        },
      );
    if (
      error instanceof ActionError &&
      (error.code === "UNAUTHENTICATED" || error.code === "INVALID_INPUT")
    )
      return Response.json(
        { code: error.code },
        { status: error.code === "UNAUTHENTICATED" ? 401 : 400, headers },
      );
    return Response.json({ code: "INTERNAL" }, { status: 500, headers });
  }
}
