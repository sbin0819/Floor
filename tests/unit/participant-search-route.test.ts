import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActionError } from "@/lib/actions/result";
import { RateLimitError } from "@/lib/rate-limit/memory";
const { search } = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock("@/features/bookings/queries", () => ({ searchParticipants: search }));
import { GET } from "@/app/api/participants/search/route";

describe("participant search GET", () => {
  beforeEach(() => {
    search.mockReset();
  });
  const request = () =>
    GET(
      new Request("https://floor.test/api/participants/search?q=ab%40test.com"),
    );
  it("returns only query results and prevents caching", async () => {
    search.mockResolvedValue([]);
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ results: [] });
    expect(search).toHaveBeenCalledWith("ab@test.com");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it.each([
    [new ActionError("UNAUTHENTICATED"), 401, "UNAUTHENTICATED"],
    [new Error("secret email or SQL"), 500, "INTERNAL"],
  ])("does not redirect or expose errors", async (error, status, code) => {
    search.mockRejectedValue(error);
    const response = await request();
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ code });
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("includes Retry-After on limited responses", async () => {
    search.mockRejectedValue(new RateLimitError(37));
    const response = await request();
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("37");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ code: "RATE_LIMITED" });
  });
});
