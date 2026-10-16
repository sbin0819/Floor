import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRoomFiles } from "@/features/chat/file-client";
import { ApiError } from "@/lib/http/errors";

const roomId = "10000000-0000-4000-8000-000000000001";
const file = {
  id: "10000000-0000-4000-8000-000000000002",
  name: "자료.pdf",
  size: 30,
  kind: "file",
  width: null,
  height: null,
  uploaderName: "김하은",
  sentAt: "2026-10-08T15:30:00.000Z",
  messageId: "10000000-0000-4000-8000-000000000003",
  seq: 12,
};
afterEach(() => vi.unstubAllGlobals());

describe("file panel HTTP boundary", () => {
  it("sends kind, composite cursor and cancellation signal without caching", async () => {
    const page = { files: [file], hasMore: false, nextCursor: null };
    const fetch = vi.fn().mockResolvedValue(Response.json(page));
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    expect(
      await fetchRoomFiles(roomId, {
        kind: "file",
        before: "13_9",
        signal: controller.signal,
      }),
    ).toEqual(page);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      `/api/rooms/${roomId}/files?kind=file&before=13_9`,
      expect.objectContaining({
        credentials: "same-origin",
        cache: "no-store",
        signal: expect.any(AbortSignal),
        method: "GET",
      }),
    );
  });

  it.each([401, 403, 404, 429, 500])(
    "hides arbitrary error response bodies for HTTP %i",
    async (status) => {
      const body = "private@example.test private-object-key";
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(body, { status })),
      );
      const error: unknown = await fetchRoomFiles(roomId, {
        kind: "all",
      }).catch((failure: unknown) => failure);
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ kind: "http", status });
      expect(String(error)).not.toContain(body);
      expect(JSON.stringify(error)).not.toMatch(
        /private@example|private-object/,
      );
      for (const field of ["config", "request", "response", "cause"])
        expect(error).not.toHaveProperty(field);
    },
  );

  it.each([
    {
      files: [{ ...file, storageKey: "private-object-key" }],
      hasMore: false,
      nextCursor: null,
    },
    {
      files: [{ ...file, email: "private@example.test" }],
      hasMore: false,
      nextCursor: null,
    },
    {
      files: [{ ...file, sentAt: "not-a-date" }],
      hasMore: false,
      nextCursor: null,
    },
    {
      files: [{ ...file, seq: Number.MAX_SAFE_INTEGER + 1 }],
      hasMore: false,
      nextCursor: null,
    },
    {
      files: Array.from({ length: 31 }, () => file),
      hasMore: true,
      nextCursor: "12_0",
    },
    { files: [file], hasMore: true, nextCursor: null },
    { files: [file], hasMore: false, nextCursor: "12_0" },
    { files: [file], hasMore: true, nextCursor: "9007199254740992_0" },
  ])(
    "rejects unsafe or inconsistent DTOs without retaining their contents",
    async (value) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(value)));
      await expect(
        fetchRoomFiles(roomId, { kind: "all" }),
      ).rejects.toMatchObject({
        name: "ApiError",
        kind: "invalid_response",
        status: 200,
      });
    },
  );

  it("turns malformed JSON into the same safe response error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("private invalid JSON")),
    );
    await expect(fetchRoomFiles(roomId, { kind: "all" })).rejects.toMatchObject(
      {
        name: "ApiError",
        kind: "invalid_response",
        status: 200,
      },
    );
  });
});
