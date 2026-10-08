import { describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({
  order: [] as string[],
  handle: vi.fn<(request: Request) => Promise<Response>>(
    async () => new Response(null, { status: 200 }),
  ),
}));
vi.mock("next/server", () => ({
  connection: async () => {
    boundary.order.push("connection");
  },
}));
vi.mock("@/features/calls/webhook", () => ({
  createCallWebhookHandler: () => {
    boundary.order.push("handler");
    return boundary.handle;
  },
}));
import { POST } from "@/app/api/livekit/webhook/route";

describe("LiveKit webhook route", () => {
  it("waits for a real request before passing the untouched body to the handler", async () => {
    const request = new Request("https://floor.test/api/livekit/webhook", {
      method: "POST",
      body: '  {"signed":true}  ',
      headers: { Authorization: "fake-signed-header" },
    });
    expect((await POST(request)).status).toBe(200);
    expect(boundary.order).toEqual(["connection", "handler"]);
    expect(boundary.handle).toHaveBeenCalledExactlyOnceWith(request);
    expect(request.bodyUsed).toBe(false);
  });
});
