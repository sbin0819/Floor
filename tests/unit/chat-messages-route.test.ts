import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActionError } from "@/lib/actions/result";
import { RateLimitError } from "@/lib/rate-limit/memory";
const { page, connection } = vi.hoisted(() => ({
  page: vi.fn(),
  connection: vi.fn(),
}));
vi.mock("@/features/chat/queries", () => ({ getRoomMessagesPage: page }));
vi.mock("next/server", () => ({ connection }));
import { GET } from "@/app/api/rooms/[roomId]/messages/route";

describe("chat message page GET", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });
  const roomId = "11111111-1111-4111-8111-111111111111";
  const request = () =>
    GET(
      new Request(`https://floor.test/api/rooms/${roomId}/messages?after=2`),
      { params: Promise.resolve({ roomId }) },
    );
  it("passes the query to the protected reader and returns only its response without caching", async () => {
    const data = {
      messages: [],
      hasMore: false,
      lastSeq: 2,
      lastReadSeq: null,
      firstUnreadSeq: null,
    };
    page.mockResolvedValue(data);
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(data);
    expect(page).toHaveBeenCalledExactlyOnceWith(
      roomId,
      new URLSearchParams("after=2"),
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(connection).toHaveBeenCalledExactlyOnceWith();
    expect(connection.mock.invocationCallOrder[0]).toBeLessThan(
      page.mock.invocationCallOrder[0]!,
    );
  });
  it.each([
    [new ActionError("UNAUTHENTICATED"), 401, "UNAUTHENTICATED"],
    [new ActionError("INVALID_INPUT"), 400, "INVALID_INPUT"],
    [new ActionError("NOT_FOUND"), 404, "NOT_FOUND"],
    [new ActionError("FORBIDDEN"), 500, "INTERNAL"],
    [
      new Error("private database text and private@email.test"),
      500,
      "INTERNAL",
    ],
  ])(
    "maps query errors without redirecting or exposing their contents",
    async (error, status, code) => {
      page.mockRejectedValue(error);
      const response = await request();
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ code });
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    },
  );
  it("includes Retry-After for a rejected page request", async () => {
    page.mockRejectedValue(new RateLimitError(18));
    const response = await request();
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ code: "RATE_LIMITED" });
    expect(response.headers.get("retry-after")).toBe("18");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("does not swallow the request boundary or start data access before it", async () => {
    const boundary = new Error("prerender boundary");
    connection.mockRejectedValue(boundary);
    await expect(request()).rejects.toBe(boundary);
    expect(page).not.toHaveBeenCalled();
  });
});
