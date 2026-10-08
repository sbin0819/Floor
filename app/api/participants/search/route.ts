import { searchParticipants } from "@/features/bookings/queries";
import { ActionError } from "@/lib/actions/result";
import { RateLimitError } from "@/lib/rate-limit/memory";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q");
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const results = await searchParticipants(query);
    return Response.json({ results }, { headers });
  } catch (error) {
    if (error instanceof ActionError && error.code === "UNAUTHENTICATED")
      return Response.json(
        { code: "UNAUTHENTICATED" },
        { status: 401, headers },
      );
    if (error instanceof RateLimitError)
      return Response.json(
        { code: "RATE_LIMITED" },
        {
          status: 429,
          headers: { ...headers, "Retry-After": String(error.retryAfter) },
        },
      );
    return Response.json({ code: "INTERNAL" }, { status: 500, headers });
  }
}
