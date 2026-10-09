import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActionError } from "@/lib/actions/result";

const { read, connection } = vi.hoisted(() => ({
  read: vi.fn(),
  connection: vi.fn(),
}));
vi.mock("@/features/floor-plan/queries", () => ({
  getFloorPlanDocument: read,
}));
vi.mock("next/server", () => ({ connection }));
import { GET } from "@/app/api/floor-plans/[planId]/route";

const id = "10000000-0000-4000-8000-000000000001";
const request = () => new Request(`https://floor.test/api/floor-plans/${id}`);
const context = () => ({ params: Promise.resolve({ planId: id }) });

describe("authenticated floor-plan GET", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns the document directly with private immutable caching after the request boundary", async () => {
    const document = { schema: 1, seats: [], spaces: [] };
    read.mockResolvedValue(document);
    const response = await GET(request(), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(document);
    expect(response.headers.get("Cache-Control")).toBe(
      "private, max-age=31536000, immutable",
    );
    expect(read).toHaveBeenCalledExactlyOnceWith(id);
    expect(connection.mock.invocationCallOrder[0]).toBeLessThan(
      read.mock.invocationCallOrder[0]!,
    );
  });

  it.each([
    [new ActionError("UNAUTHENTICATED"), 401, "UNAUTHENTICATED"],
    [new ActionError("NOT_FOUND"), 404, "NOT_FOUND"],
    [new Error("private database details"), 500, "INTERNAL"],
  ])(
    "does not cache or disclose failure details",
    async (error, status, code) => {
      read.mockRejectedValue(error);
      const response = await GET(request(), context());
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ code });
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    },
  );

  it("does not swallow the request-time boundary", async () => {
    const error = new Error("prerender boundary");
    connection.mockRejectedValue(error);
    await expect(GET(request(), context())).rejects.toBe(error);
    expect(read).not.toHaveBeenCalled();
  });
});
