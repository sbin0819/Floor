import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActionError } from "@/lib/actions/result";
import { createMemoryRateLimiter } from "@/lib/rate-limit/memory";
import {
  createFileDownloads,
  fileDisposition,
  matchesFileEtag,
} from "@/features/chat/files";
import {
  roomFilesQueryInput,
  roomFilesQuerySchema,
} from "@/features/chat/file-schema";
import type { FileStorage } from "@/lib/storage/types";

const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/dal/chat-files", () => ({ readDownloadAttachment: read }));
const id = "10000000-0000-4000-8000-000000000001";
const session = {
  userId: "10000000-0000-4000-8000-000000000002",
  name: "가상회원",
  email: "private@example.test",
};
const now = new Date("2026-10-08T03:00:00Z");
const payload = new TextEncoder().encode("hello");
function store(): FileStorage {
  return {
    kind: "local",
    createUploadTarget: vi.fn(),
    readHead: vi.fn(),
    remove: vi.fn(),
    stat: vi.fn(async () => ({ size: 5 })),
    readStream: vi.fn(
      async () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(payload);
            controller.close();
          },
        }),
    ),
  };
}
function security(response: Response) {
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("content-security-policy")).toBe(
    "default-src 'none'; sandbox",
  );
  expect(response.headers.get("cross-origin-resource-policy")).toBe(
    "same-origin",
  );
  expect(response.headers.get("cache-control")).toBe("private, no-cache");
  expect(response.headers.get("etag")).toMatch(/^"[^"\r\n]+"$/);
}
function request(headers?: HeadersInit, query = "") {
  return new Request(`https://floor.test/api/files/${id}${query}`, { headers });
}
describe("protected file download response", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    read.mockResolvedValue({
      id,
      name: "가상 자료.pdf",
      kind: "file",
      size: 5,
      contentType: "application/pdf",
      storageKey: "private-key",
    });
  });
  it("checks a session before invalid IDs, rates or storage and includes security headers on 401", async () => {
    const storage = store();
    const consume = vi.fn();
    const files = createFileDownloads({
      storage,
      limiter: { consume },
      requireSession: async () => {
        throw new ActionError("UNAUTHENTICATED");
      },
    });
    const response = await files.getFile(request(), "invalid");
    expect(response.status).toBe(401);
    security(response);
    expect(consume).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(storage.stat).not.toHaveBeenCalled();
  });
  it("rejects invalid IDs before rate limiting and safely builds headers for malicious input", async () => {
    const consume = vi.fn();
    const files = createFileDownloads({
      requireSession: async () => session,
      limiter: { consume },
    });
    const response = await files.getFile(
      request(),
      "invalid\r\nprivate: value",
    );
    expect(response.status).toBe(404);
    security(response);
    expect(consume).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });
  it("does not reveal denied rows, access storage, or honor conditional GET for them", async () => {
    const storage = store();
    read.mockResolvedValue(null);
    const response = await createFileDownloads({
      storage,
      requireSession: async () => session,
      now: () => now,
    }).getFile(request({ "If-None-Match": "*" }), id);
    expect(response.status).toBe(404);
    security(response);
    expect(storage.stat).not.toHaveBeenCalled();
  });
  it("streams ordinary files as an attachment without trusting their recorded non-image MIME", async () => {
    const storage = store();
    const response = await createFileDownloads({
      storage,
      requireSession: async () => session,
      now: () => now,
    }).getFile(request(), id);
    expect(response.status).toBe(200);
    security(response);
    expect(response.headers.get("content-type")).toBe(
      "application/octet-stream",
    );
    expect(response.headers.get("content-length")).toBe("5");
    expect(response.headers.get("content-disposition")).toBe(
      fileDisposition("가상 자료.pdf", false),
    );
    expect(await response.text()).toBe("hello");
    expect(read).toHaveBeenCalledExactlyOnceWith(
      id,
      session.userId,
      new Date(now.getTime() - 86_400_000),
      undefined,
    );
  });
  it.each(["", "?download=1"])(
    "uses the stored image MIME and applies download choice %s",
    async (query) => {
      read.mockResolvedValue({
        id,
        name: "사진.png",
        kind: "image",
        size: 5,
        contentType: "image/png",
        storageKey: "private-key",
      });
      const response = await createFileDownloads({
        storage: store(),
        requireSession: async () => session,
      }).getFile(request(undefined, query), id);
      expect(response.status).toBe(200);
      security(response);
      expect(response.headers.get("content-type")).toBe("image/png");
      expect(response.headers.get("content-disposition")).toBe(
        fileDisposition("사진.png", !query),
      );
    },
  );
  it.each([`"${id}"`, `W/"${id}"`, `"other", W/"${id}"`, "*"])(
    "handles conditional GET %s after authorization and object existence",
    async (header) => {
      const storage = store();
      const response = await createFileDownloads({
        storage,
        requireSession: async () => session,
      }).getFile(request({ "If-None-Match": header }), id);
      expect(response.status).toBe(304);
      security(response);
      expect(await response.text()).toBe("");
      expect(storage.stat).toHaveBeenCalledTimes(1);
      expect(storage.readStream).not.toHaveBeenCalled();
      expect(response.headers.get("content-type")).toBeNull();
      expect(response.headers.get("content-length")).toBeNull();
      expect(response.headers.get("content-disposition")).toBeNull();
    },
  );
  it.each([null, { size: 4 }])(
    "returns 404 before 304 for a missing or changed object %j",
    async (metadata) => {
      const storage = store();
      vi.mocked(storage.stat).mockResolvedValue(metadata);
      const response = await createFileDownloads({
        storage,
        requireSession: async () => session,
      }).getFile(request({ "If-None-Match": "*" }), id);
      expect(response.status).toBe(404);
      security(response);
      expect(storage.readStream).not.toHaveBeenCalled();
    },
  );
  it("returns 404 when storage is disabled or the object disappears before opening its stream", async () => {
    for (const disabled of [true, false]) {
      const storage = store();
      vi.mocked(storage.readStream).mockResolvedValue(null);
      const response = await createFileDownloads({
        storage: disabled ? { ...storage, kind: "disabled" } : storage,
        requireSession: async () => session,
      }).getFile(request(), id);
      expect(response.status).toBe(404);
      security(response);
    }
  });
  it("counts 304 in the 300-per-minute user limit, isolates users and resets after the window", async () => {
    let instant = now.getTime();
    let current = session;
    const limiter = createMemoryRateLimiter(() => instant);
    const storage = store();
    const files = createFileDownloads({
      storage,
      limiter,
      requireSession: async () => current,
    });
    for (let i = 0; i < 300; i++)
      expect(
        (await files.getFile(request({ "If-None-Match": "*" }), id)).status,
      ).toBe(304);
    const response = await files.getFile(request(), id);
    expect(response.status).toBe(429);
    security(response);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(read).toHaveBeenCalledTimes(300);
    current = { ...session, userId: crypto.randomUUID() };
    expect(
      (await files.getFile(request({ "If-None-Match": "*" }), id)).status,
    ).toBe(304);
    current = session;
    instant += 60_000;
    expect(
      (await files.getFile(request({ "If-None-Match": "*" }), id)).status,
    ).toBe(304);
  });
  it("uses fixed failures and security headers for unexpected IO errors", async () => {
    const storage = store();
    vi.mocked(storage.stat).mockRejectedValue(new Error("secret disk path"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await createFileDownloads({
      storage,
      requireSession: async () => session,
    }).getFile(request(), id);
    expect(response.status).toBe(500);
    security(response);
    expect(await response.json()).toEqual({ code: "INTERNAL" });
    expect(log).toHaveBeenCalledExactlyOnceWith("File download failed.");
  });
});

describe("file headers and page input", () => {
  it("uses safe ASCII fallback and strict RFC5987 escaping", () => {
    const name = "가상 \"자료\\100%;'()*!.pdf";
    expect(fileDisposition(name, false)).toBe(
      "attachment; filename=\"__ ____100__'()*!.pdf\"; filename*=UTF-8''%EA%B0%80%EC%83%81%20%22%EC%9E%90%EB%A3%8C%5C100%25%3B%27%28%29%2A%21.pdf",
    );
  });
  it.each([null, "", '"another"', `W/"${id}different"`, `"${id}"suffix`])(
    "does not accept malformed or unrelated ETags %j",
    (header) => expect(matchesFileEtag(header, `"${id}"`)).toBe(false),
  );
  it("keeps tuple cursors and default all filter", () => {
    expect(
      roomFilesQuerySchema.parse(
        roomFilesQueryInput(new URLSearchParams("before=200_9")),
      ),
    ).toEqual({ kind: "all", before: { seq: 200, position: 9 } });
  });
  it.each([
    "kind=all&kind=file",
    "kind=video",
    "before=0_1",
    "before=1_10",
    "before=1_-1",
    "before=1.2_0",
    "before=01_0",
    "before=9007199254740992_0",
    "before=1_0&before=2_0",
    "after=1",
  ])("rejects invalid or duplicated page input %s", (query) =>
    expect(
      roomFilesQuerySchema.safeParse(
        roomFilesQueryInput(new URLSearchParams(query)),
      ).success,
    ).toBe(false),
  );
});
