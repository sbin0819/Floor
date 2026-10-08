import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActionError } from "@/lib/actions/result";
const { summary, connection } = vi.hoisted(() => ({
  summary: vi.fn(),
  connection: vi.fn(),
}));
vi.mock("@/features/notifications/queries", () => ({
  getNotificationSummary: summary,
}));
vi.mock("next/server", () => ({ connection }));
import { GET } from "@/app/api/notifications/route";

describe("notification summary GET", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });
  it("passes through only the authenticated summary and prevents caching", async () => {
    const data = {
      items: [],
      unreadCount: 0,
      now: "2026-10-08T01:00:00Z",
      nextAt: "2026-10-08T01:10:00Z",
    };
    summary.mockResolvedValue(data);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(data);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(summary).toHaveBeenCalledExactlyOnceWith();
    expect(connection).toHaveBeenCalledExactlyOnceWith();
  });
  it.each([
    [new ActionError("UNAUTHENTICATED"), 401, "UNAUTHENTICATED"],
    [new Error("private raw SQL and email"), 500, "INTERNAL"],
  ])("does not redirect or expose the error", async (error, status, code) => {
    summary.mockRejectedValue(error);
    const response = await GET();
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ code });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("location")).toBeNull();
  });
  it("does not swallow a prerender boundary in its error handler", async () => {
    const boundary = new Error("request boundary");
    connection.mockRejectedValue(boundary);
    await expect(GET()).rejects.toBe(boundary);
    expect(summary).not.toHaveBeenCalled();
  });
});
