import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connection: vi.fn(),
  heartbeat: vi.fn(),
  leave: vi.fn(),
  factory: vi.fn(),
}));
vi.mock("next/server", () => ({ connection: mocks.connection }));
vi.mock("@/features/calls/http", () => ({
  createCallHttpHandlers: mocks.factory,
}));
import * as heartbeatRoute from "@/app/api/calls/heartbeat/route";
import * as leaveRoute from "@/app/api/calls/leave/route";

const routes = [
  { method: "heartbeat", route: heartbeatRoute },
  { method: "leave", route: leaveRoute },
] as const;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.factory.mockReturnValue({
    heartbeat: mocks.heartbeat,
    leave: mocks.leave,
  });
});

describe.each(routes)("call $method route", ({ method, route }) => {
  it("only exports POST and awaits the request boundary before creating handlers", async () => {
    expect(Object.keys(route)).toEqual(["POST"]);
    const ready = Promise.withResolvers<void>();
    mocks.connection.mockReturnValue(ready.promise);
    const request = new Request(`https://floor.test/api/calls/${method}`, {
      method: "POST",
      body: "{}",
    });
    const response = new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
    mocks[method].mockResolvedValue(response);
    const pending = route.POST(request);
    expect(mocks.connection).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.factory).not.toHaveBeenCalled();
    expect(mocks[method]).not.toHaveBeenCalled();
    ready.resolve();
    expect(await pending).toBe(response);
    expect(mocks.factory).toHaveBeenCalledExactlyOnceWith();
    expect(mocks[method]).toHaveBeenCalledExactlyOnceWith(request);
    expect(
      mocks[method === "heartbeat" ? "leave" : "heartbeat"],
    ).not.toHaveBeenCalled();
  });

  it.each([400, 401, 403, 404, 500])(
    "preserves the feature handler's %i response and cache policy",
    async (status) => {
      const response = new Response(null, {
        status,
        headers: { "Cache-Control": "no-store" },
      });
      mocks[method].mockResolvedValue(response);
      const actual = await route.POST(
        new Request(`https://floor.test/api/calls/${method}`, {
          method: "POST",
        }),
      );
      expect(actual).toBe(response);
      expect(actual.headers.get("Cache-Control")).toBe("no-store");
    },
  );

  it("does not swallow prerender/request-boundary interruptions", async () => {
    const interruption = new Error("request boundary");
    mocks.connection.mockRejectedValue(interruption);
    await expect(
      route.POST(new Request("https://floor.test", { method: "POST" })),
    ).rejects.toBe(interruption);
    expect(mocks.factory).not.toHaveBeenCalled();
    expect(mocks[method]).not.toHaveBeenCalled();
  });
});
