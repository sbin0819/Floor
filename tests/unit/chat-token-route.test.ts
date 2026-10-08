import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActionError } from "@/lib/actions/result";
import { RateLimitError } from "@/lib/rate-limit/memory";
const mocks = vi.hoisted(() => ({ token: vi.fn(), connection: vi.fn() }));
vi.mock("next/server", () => ({ connection: mocks.connection }));
vi.mock("@/features/chat/realtime-token", async (original) => ({
  ...(await original<typeof import("@/features/chat/realtime-token")>()),
  getRealtimeToken: mocks.token,
}));
import { RealtimeDisabledError } from "@/features/chat/realtime-token";
import { POST } from "@/app/api/realtime/token/route";
beforeEach(() => {
  mocks.token.mockReset();
  mocks.connection.mockReset();
});
describe("token HTTP handler", () => {
  it.each([
    [new ActionError("UNAUTHENTICATED"), 401, "UNAUTHENTICATED"],
    [new ActionError("INVALID_INPUT"), 400, "INVALID_INPUT"],
    [new RealtimeDisabledError(), 503, "REALTIME_DISABLED"],
    [new RateLimitError(8), 429, "RATE_LIMITED"],
    [new Error("private secret"), 500, "INTERNAL"],
  ] as const)(
    "maps known errors without leaking internals",
    async (error, status, code) => {
      mocks.token.mockRejectedValue(error);
      const response = await POST(
        new Request("http://localhost/api/realtime/token", {
          method: "POST",
          body: "{}",
        }),
      );
      expect(response.status).toBe(status);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(await response.json()).toEqual({ code });
      if (status === 429) expect(response.headers.get("Retry-After")).toBe("8");
    },
  );
  it("returns the signed request and preserves the request-time boundary", async () => {
    mocks.token.mockImplementation(async (read: () => Promise<unknown>) => {
      expect(await read()).toEqual({ rooms: [] });
      return { mac: "fake" };
    });
    const response = await POST(
      new Request("http://localhost/api/realtime/token", {
        method: "POST",
        body: '{"rooms":[]}',
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ mac: "fake" });
    const interruption = new Error("prerender interrupted");
    mocks.connection.mockRejectedValue(interruption);
    await expect(POST(new Request("http://localhost"))).rejects.toBe(
      interruption,
    );
  });
});
