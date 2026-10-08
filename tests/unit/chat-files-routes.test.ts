import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActionError } from "@/lib/actions/result";
import { RateLimitError } from "@/lib/rate-limit/memory";
const { page, download, connection } = vi.hoisted(() => ({
  page: vi.fn(),
  download: vi.fn(),
  connection: vi.fn(),
}));
vi.mock("@/features/chat/queries", () => ({ getRoomFiles: page }));
vi.mock("@/features/chat/files", () => ({
  createFileDownloads: () => ({ getFile: download }),
}));
vi.mock("next/server", () => ({ connection }));
import { GET as list } from "@/app/api/rooms/[roomId]/files/route";
import { GET as getFile } from "@/app/api/files/[attachmentId]/route";
const id = "10000000-0000-4000-8000-000000000001";
const request = () =>
  new Request(`https://floor.test/api/rooms/${id}/files?kind=image&before=9_2`);
describe("file GET routes", () => {
  beforeEach(() => vi.resetAllMocks());
  it("passes files query to the session-enforcing reader after connection without caching", async () => {
    const data = { files: [], hasMore: false, nextCursor: null };
    page.mockResolvedValue(data);
    const response = await list(request(), {
      params: Promise.resolve({ roomId: id }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(data);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(page).toHaveBeenCalledExactlyOnceWith(
      id,
      new URLSearchParams("kind=image&before=9_2"),
    );
    expect(connection.mock.invocationCallOrder[0]).toBeLessThan(
      page.mock.invocationCallOrder[0]!,
    );
  });
  it.each([
    [new ActionError("UNAUTHENTICATED"), 401, "UNAUTHENTICATED"],
    [new ActionError("INVALID_INPUT"), 400, "INVALID_INPUT"],
    [new ActionError("NOT_FOUND"), 404, "NOT_FOUND"],
    [new Error("private@email.test"), 500, "INTERNAL"],
  ])("maps list failures safely", async (error, status, code) => {
    page.mockRejectedValue(error);
    const response = await list(request(), {
      params: Promise.resolve({ roomId: id }),
    });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ code });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("returns retry guidance on list throttling", async () => {
    page.mockRejectedValue(new RateLimitError(23));
    const response = await list(request(), {
      params: Promise.resolve({ roomId: id }),
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("23");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("leaves download response and streaming body to the feature handler", async () => {
    const expected = new Response(null, {
      status: 304,
      headers: { ETag: `"${id}"` },
    });
    download.mockResolvedValue(expected);
    const req = request();
    expect(
      await getFile(req, { params: Promise.resolve({ attachmentId: id }) }),
    ).toBe(expected);
    expect(download).toHaveBeenCalledExactlyOnceWith(req, id);
    expect(connection.mock.invocationCallOrder[0]).toBeLessThan(
      download.mock.invocationCallOrder[0]!,
    );
  });
  it("does not swallow the request boundary in either route", async () => {
    const error = new Error("prerender boundary");
    connection.mockRejectedValue(error);
    await expect(
      list(request(), { params: Promise.resolve({ roomId: id }) }),
    ).rejects.toBe(error);
    await expect(
      getFile(request(), { params: Promise.resolve({ attachmentId: id }) }),
    ).rejects.toBe(error);
    expect(page).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });
});
