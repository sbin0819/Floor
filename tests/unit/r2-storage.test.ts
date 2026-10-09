import { Readable } from "node:stream";
import type { S3Client } from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { adminObjectKey } from "@/lib/storage/admin-keys";
import {
  AdminStorageMissingError,
  AdminStoragePreconditionError,
} from "@/lib/storage/admin-types";
import {
  adminFilesEnabled,
  createR2ObjectStorage,
  getAdminObjectStorage,
} from "@/lib/storage/r2";

const env = vi.hoisted(() => ({ value: {} as Record<string, string> }));
vi.mock("@/lib/env", () => ({ getEnv: () => env.value }));

const config = {
  endpoint: "https://test.r2.cloudflarestorage.com",
  bucket: "floor-test",
  accessKeyId: "test-access-id",
  secretAccessKey: "test-secret-key",
};
const complete = {
  R2_ENDPOINT: config.endpoint,
  R2_BUCKET: config.bucket,
  R2_ACCESS_KEY_ID: config.accessKeyId,
  R2_SECRET_ACCESS_KEY: config.secretAccessKey,
};
const uploadId = "a1000000-0000-4000-8000-000000000001";
const planId = "a1000000-0000-4000-8000-000000000002";
const pending = adminObjectKey({ kind: "pending", uploadId });
const final = adminObjectKey({ kind: "plan-background", uploadId, planId });
type Handle = S3Client["config"]["requestHandler"]["handle"];
type FakeResponse = {
  statusCode?: number;
  headers?: Record<string, string>;
  body?: string | Uint8Array | Readable;
};
function fixture(responses: FakeResponse[] = []) {
  const handle = vi.fn<Handle>().mockImplementation(async () => {
    const response = responses.shift();
    if (!response) throw new Error("No fake response. Network is forbidden.");
    return {
      response: {
        statusCode: response.statusCode ?? 200,
        headers: response.headers ?? {},
        body:
          response.body instanceof Readable
            ? response.body
            : Readable.from([
                typeof response.body === "string"
                  ? Buffer.from(response.body)
                  : (response.body ?? Buffer.alloc(0)),
              ]),
      },
    };
  });
  const storage = createR2ObjectStorage(config, { requestHandler: { handle } });
  return { storage, handle };
}
const objectHeaders = {
  "content-length": "30",
  "content-type": "image/webp",
  etag: '"etag-original"',
  "x-amz-meta-purpose": "plan-background",
};
afterEach(() => {
  env.value = {};
  vi.restoreAllMocks();
});

describe("R2 availability", () => {
  it("stays disabled when absent, warns once for partial config without values, and enables a full config", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(adminFilesEnabled({})).toBe(false);
    expect(getAdminObjectStorage()).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    expect(adminFilesEnabled({ R2_ACCESS_KEY_ID: "never-log-this" })).toBe(
      false,
    );
    expect(adminFilesEnabled({ R2_SECRET_ACCESS_KEY: "never-log-that" })).toBe(
      false,
    );
    expect(warn).toHaveBeenCalledExactlyOnceWith("R2 설정이 일부만 있어요");
    expect(adminFilesEnabled(complete)).toBe(true);
  });
  it("lazily reuses the configured adapter without sending a request", () => {
    env.value = complete;
    const first = getAdminObjectStorage();
    expect(first).not.toBeNull();
    expect(getAdminObjectStorage()).toBe(first);
    env.value = { ...complete, R2_BUCKET: "different-bucket" };
    expect(getAdminObjectStorage()).not.toBe(first);
    env.value = {};
    expect(getAdminObjectStorage()).toBeNull();
  });
});

describe("R2 signed requests using the installed SDK without network", () => {
  it("signs exact type, length, expiration and immutable metadata without a false empty-body checksum", async () => {
    const { storage, handle } = fixture();
    const metadata = {
      purpose: "plan-background",
      "uploader-id": uploadId,
      "floor-id": planId,
      "plan-id": planId,
      "expected-size": "1234",
      "expires-at": "2026-10-09T10:05:00.000Z",
    };
    const url = new URL(
      await storage.createUploadUrl(pending, {
        contentType: "image/webp",
        contentLength: 1234,
        expiresIn: 300,
        metadata,
      }),
    );
    expect(url.origin).toBe(config.endpoint);
    expect(url.pathname).toBe(`/${config.bucket}/${pending}`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-SignedHeaders")!.split(";")).toEqual([
      "content-length",
      "content-type",
      "host",
    ]);
    for (const [key, value] of Object.entries(metadata))
      expect(url.searchParams.get(`x-amz-meta-${key}`)).toBe(value);
    expect(url.searchParams.get("X-Amz-Credential")).toContain(
      "/auto/s3/aws4_request",
    );
    expect(
      [...url.searchParams.keys()].filter((key) => /checksum/i.test(key)),
    ).toEqual([]);
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[a-f0-9]{64}$/);
    expect(handle).not.toHaveBeenCalled();
  });
  it.each<{
    contentLength: number;
    expiresIn: number;
    metadata: Record<string, string>;
  }>([
    { contentLength: 0, expiresIn: 300, metadata: {} },
    { contentLength: 1.5, expiresIn: 300, metadata: {} },
    { contentLength: 1, expiresIn: 301, metadata: {} },
    { contentLength: 1, expiresIn: 0, metadata: {} },
    { contentLength: 1, expiresIn: 300, metadata: { "Unsafe-Key": "x" } },
    {
      contentLength: 1,
      expiresIn: 300,
      metadata: { purpose: "bad\r\nheader" },
    },
  ])("rejects invalid signed upload options %j", async (options) => {
    const { storage, handle } = fixture();
    await expect(
      storage.createUploadUrl(pending, {
        ...options,
        contentType: "image/webp",
      }),
    ).rejects.toThrow("Invalid admin upload options.");
    expect(handle).not.toHaveBeenCalled();
  });
  it("does not sign direct writes to final keys", async () => {
    const { storage, handle } = fixture();
    await expect(
      storage.createUploadUrl(final, {
        contentType: "image/webp",
        contentLength: 30,
        expiresIn: 300,
        metadata: {},
      }),
    ).rejects.toThrow();
    expect(handle).not.toHaveBeenCalled();
  });
  it("returns allowlisted HEAD metadata and missing objects as null", async () => {
    const { storage, handle } = fixture([
      { headers: objectHeaders },
      { statusCode: 404 },
    ]);
    expect(await storage.head(pending)).toEqual({
      size: 30,
      contentType: "image/webp",
      etag: '"etag-original"',
      metadata: { purpose: "plan-background" },
    });
    expect(await storage.head(final)).toBeNull();
    expect(handle.mock.calls[0]![0]).toMatchObject({
      method: "HEAD",
      hostname: "test.r2.cloudflarestorage.com",
      path: `/${config.bucket}/${pending}`,
    });
  });
  it("conditions the range read on the opaque ETag and reads no more than the bounded range", async () => {
    const { storage, handle } = fixture([
      {
        statusCode: 206,
        headers: objectHeaders,
        body: new Uint8Array([1, 2, 3]),
      },
    ]);
    expect(
      await storage.readRange(pending, 0, 1023, { ifMatch: '"etag-original"' }),
    ).toEqual(new Uint8Array([1, 2, 3]));
    expect(handle.mock.calls[0]![0].headers).toMatchObject({
      range: "bytes=0-1023",
      "if-match": '"etag-original"',
    });
  });
  it("cancels an oversized response even if a provider ignores Range", async () => {
    const { storage } = fixture([{ body: new Uint8Array(1025) }]);
    await expect(
      storage.readRange(pending, 0, 1023, { ifMatch: '"etag-original"' }),
    ).rejects.toThrow("Admin object storage request failed.");
  });
  it("distinguishes a changed range source from a provider error", async () => {
    const { storage } = fixture([
      {
        statusCode: 412,
        body: "<Error><Code>PreconditionFailed</Code></Error>",
      },
    ]);
    await expect(
      storage.readRange(pending, 0, 1023, { ifMatch: '"old"' }),
    ).rejects.toBeInstanceOf(AdminStoragePreconditionError);
  });
  it("distinguishes a removed range source without leaking provider details", async () => {
    const { storage, handle } = fixture([
      {
        statusCode: 404,
        body: "<Error><Code>NoSuchKey</Code><Message>private-key-and-token</Message></Error>",
      },
    ]);
    const result = storage.readRange(pending, 0, 1023, { ifMatch: '"old"' });
    await expect(result).rejects.toBeInstanceOf(AdminStorageMissingError);
    await expect(result).rejects.toThrow("The stored object does not exist.");
    expect(handle).toHaveBeenCalledTimes(1);
  });
  it("signs both copy conditions on just the copy request and preserves metadata", async () => {
    const { storage, handle } = fixture([
      { body: '<CopyObjectResult><ETag>"copied"</ETag></CopyObjectResult>' },
      { headers: objectHeaders },
    ]);
    expect(
      await storage.copy(pending, final, {
        sourceEtag: '"etag-original"',
        ifAbsent: true,
      }),
    ).toBe("created");
    const request = handle.mock.calls[0]![0];
    expect(request.headers).toMatchObject({
      "x-amz-copy-source": `${config.bucket}/${pending}`,
      "x-amz-copy-source-if-match": '"etag-original"',
      "cf-copy-destination-if-none-match": "*",
      "x-amz-metadata-directive": "COPY",
    });
    expect(request.headers.authorization).toContain(
      "cf-copy-destination-if-none-match",
    );
    expect(request.headers.authorization).toContain(
      "x-amz-copy-source-if-match",
    );
    await storage.head(final);
    expect(handle.mock.calls[1]![0].headers).not.toHaveProperty(
      "cf-copy-destination-if-none-match",
    );
  });
  it.each([true, false])(
    "checks destination after ambiguous copy 412 (exists=%s)",
    async (exists) => {
      const { storage, handle } = fixture([
        {
          statusCode: 412,
          body: "<Error><Code>PreconditionFailed</Code></Error>",
        },
        exists ? { headers: objectHeaders } : { statusCode: 404 },
      ]);
      const result = storage.copy(pending, final, {
        sourceEtag: '"etag-original"',
        ifAbsent: true,
      });
      if (exists) await expect(result).resolves.toBe("exists");
      else
        await expect(result).rejects.toBeInstanceOf(
          AdminStoragePreconditionError,
        );
      expect(handle.mock.calls.map(([request]) => request.method)).toEqual([
        "PUT",
        "HEAD",
      ]);
    },
  );
  it("streams bytes without a public URL, and returns null for a missing object", async () => {
    const { storage } = fixture([{ body: "webp-bytes" }, { statusCode: 404 }]);
    const stream = await storage.readStream(final);
    expect(await new Response(stream).text()).toBe("webp-bytes");
    expect(await storage.readStream(final)).toBeNull();
  });
  it("sanitizes an upstream stream failure after headers and releases its reader", async () => {
    const body = Readable.from(
      (async function* () {
        yield Buffer.from("partial");
        throw new Error("secret upstream URL and object key");
      })(),
    );
    const { storage } = fixture([{ body }]);
    const stream = (await storage.readStream(final))!;
    await expect(new Response(stream).text()).rejects.toThrow(
      "Admin object storage request failed.",
    );
    expect(body.destroyed).toBe(true);
  });
  it("cancels the upstream source when the response consumer disconnects", async () => {
    const body = new Readable({
      read() {
        this.push(Buffer.alloc(64));
      },
    });
    const { storage } = fixture([{ body }]);
    const stream = (await storage.readStream(final))!;
    const reader = stream.getReader();
    await reader.read();
    await reader.cancel();
    expect(body.destroyed).toBe(true);
  });
  it("refuses unsafe range sizes before touching the adapter", async () => {
    const { storage, handle } = fixture();
    for (const [start, end] of [
      [-1, 1],
      [2, 1],
      [0, 1024 * 1024],
      [0.5, 1],
    ])
      await expect(
        storage.readRange(pending, start!, end!, { ifMatch: '"etag"' }),
      ).rejects.toThrow("Invalid admin object range.");
    expect(handle).not.toHaveBeenCalled();
  });
  it("removes only the validated exact key", async () => {
    const { storage, handle } = fixture([{ statusCode: 204 }]);
    await storage.remove(pending);
    expect(handle.mock.calls[0]![0]).toMatchObject({
      method: "DELETE",
      path: `/${config.bucket}/${pending}`,
    });
    await expect(storage.remove("../other")).rejects.toThrow(
      "Invalid admin object key.",
    );
    expect(handle).toHaveBeenCalledTimes(1);
  });
  it("does not leak upstream messages, keys, signed URLs or retry a possibly committed copy", async () => {
    const { storage, handle } = fixture([
      {
        statusCode: 503,
        body: "<Error><Code>ServiceUnavailable</Code><Message>secret-original-message-and-key</Message></Error>",
      },
    ]);
    await expect(
      storage.copy(pending, final, {
        sourceEtag: '"etag-original"',
        ifAbsent: true,
      }),
    ).rejects.toThrow("Admin object storage request failed.");
    expect(handle).toHaveBeenCalledTimes(1);
  });
});
