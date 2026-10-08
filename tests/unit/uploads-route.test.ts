import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  connection: vi.fn(),
  factory: vi.fn(),
  put: vi.fn(),
}));
vi.mock("next/server", () => ({ connection: mocks.connection }));
vi.mock("@/features/chat/uploads", () => ({
  createChatUploads: mocks.factory,
}));
import * as route from "@/app/api/uploads/[attachmentId]/route";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.factory.mockReturnValue({ putUpload: mocks.put });
});
describe("upload body route", () => {
  it("only exports PUT and waits for the request boundary without consuming its body", async () => {
    expect(Object.keys(route)).toEqual(["PUT"]);
    const ready = Promise.withResolvers<void>();
    mocks.connection.mockReturnValue(ready.promise);
    const request = new Request("https://floor.test/api/uploads/id", {
      method: "PUT",
      body: "abc",
    });
    const result = new Response(null, { status: 204 });
    mocks.put.mockResolvedValue(result);
    const pending = route.PUT(request, {
      params: Promise.resolve({ attachmentId: "id" }),
    });
    expect(mocks.factory).not.toHaveBeenCalled();
    ready.resolve();
    expect(await pending).toBe(result);
    expect(mocks.put).toHaveBeenCalledExactlyOnceWith(request, "id");
    expect(request.bodyUsed).toBe(false);
  });
  it("preserves request-boundary interruptions", async () => {
    mocks.connection.mockRejectedValue(new Error("request boundary"));
    await expect(
      route.PUT(new Request("https://floor.test"), {
        params: Promise.resolve({ attachmentId: "id" }),
      }),
    ).rejects.toThrow("request boundary");
    expect(mocks.factory).not.toHaveBeenCalled();
  });
});
