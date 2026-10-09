import { describe, expect, it, vi } from "vitest";
import { adminObjectKey, assertAdminObjectKey } from "@/lib/storage/admin-keys";
import { createMemoryAdminObjectStorage } from "@/lib/storage/admin-memory";
import {
  AdminStoragePreconditionError,
  InvalidPendingWebpError,
} from "@/lib/storage/admin-types";
import {
  verifyAdminWebp,
  verifyPendingWebp,
} from "@/lib/storage/verify-pending-webp";

const uploadId = "a1000000-0000-4000-8000-000000000001";
const planId = "a1000000-0000-4000-8000-000000000002";
const pending = adminObjectKey({ kind: "pending", uploadId });
const final = adminObjectKey({ kind: "plan-background", planId, uploadId });
function webp(width = 640, height = 480) {
  const bytes = Buffer.alloc(30);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(22, 4);
  bytes.write("WEBPVP8X", 8);
  bytes.writeUIntLE(width - 1, 24, 3);
  bytes.writeUIntLE(height - 1, 27, 3);
  return bytes;
}

describe("admin object keys", () => {
  it("constructs and accepts only the three fixed namespaces", () => {
    expect(pending).toBe(`pending/${uploadId}.webp`);
    expect(final).toBe(`plan-backgrounds/${planId}/${uploadId}.webp`);
    expect(adminObjectKey({ kind: "space-photo", photoId: uploadId })).toBe(
      `space-photos/${uploadId}.webp`,
    );
    for (const key of [pending, final, `space-photos/${uploadId}.webp`])
      expect(() => assertAdminObjectKey(key)).not.toThrow();
  });
  it.each([
    "",
    "/etc/passwd",
    "../image.webp",
    `pending/${uploadId}.png`,
    `pending/${uploadId.toUpperCase()}.webp`,
    `pending/${uploadId}.webp\n`,
    `pending/${uploadId}.webp\0`,
    `pending/${uploadId}.webp/extra`,
    `pending/../${uploadId}.webp`,
    `pending/%2e%2e/${uploadId}.webp`,
    `pending/${uploadId}.webp?other=true`,
    `pending/${uploadId}.webp#fragment`,
    `https://bucket.invalid/${pending}`,
    `other/${uploadId}.webp`,
    `plan-backgrounds/${uploadId}.webp`,
    `pending/not-a-uuid.webp`,
  ])("rejects a noncanonical key %j", (key) => {
    expect(() => assertAdminObjectKey(key)).toThrow(
      "Invalid admin object key.",
    );
  });
  it("also validates builder input without trimming, lowercasing, or encoding", () => {
    expect(() =>
      adminObjectKey({ kind: "pending", uploadId: ` ${uploadId}` }),
    ).toThrow();
    expect(() =>
      adminObjectKey({ kind: "plan-background", planId: "../", uploadId }),
    ).toThrow();
  });
});

describe("pending WebP verification", () => {
  it("verifies real signature/dimensions and keeps immutable metadata and ETag", async () => {
    const storage = createMemoryAdminObjectStorage();
    const head = storage.put(pending, webp(), {
      metadata: { purpose: "plan-background" },
    });
    expect(
      await verifyPendingWebp(
        pending,
        { maxBytes: 30, size: { width: 640, height: 480 }, maxLongSide: 640 },
        storage,
      ),
    ).toEqual({ ...head, width: 640, height: 480 });
  });
  it("uses an already authorized HEAD and conditions the exact 1KiB range on its ETag", async () => {
    const storage = createMemoryAdminObjectStorage();
    const head = storage.put(pending, webp());
    const readHead = vi.spyOn(storage, "head");
    const range = vi.spyOn(storage, "readRange");
    await verifyPendingWebp(pending, { maxBytes: 30, head }, storage);
    expect(readHead).not.toHaveBeenCalled();
    expect(range).toHaveBeenCalledExactlyOnceWith(pending, 0, 1023, {
      ifMatch: head.etag,
    });
  });
  it("rejects overwrite after HEAD instead of verifying a different body", async () => {
    const storage = createMemoryAdminObjectStorage();
    const head = storage.put(pending, webp());
    storage.put(pending, webp(200, 100));
    await expect(
      verifyPendingWebp(pending, { maxBytes: 30, head }, storage),
    ).rejects.toBeInstanceOf(AdminStoragePreconditionError);
  });
  it.each([
    { name: "missing", bytes: null, contentType: "image/webp", maxBytes: 30 },
    {
      name: "zero bytes",
      bytes: Buffer.alloc(0),
      contentType: "image/webp",
      maxBytes: 30,
    },
    {
      name: "too large",
      bytes: webp(),
      contentType: "image/webp",
      maxBytes: 29,
    },
    {
      name: "wrong stored MIME",
      bytes: webp(),
      contentType: "image/png",
      maxBytes: 30,
    },
    {
      name: "false WebP MIME",
      bytes: Buffer.from("<html>not webp</html>"),
      contentType: "image/webp",
      maxBytes: 30,
    },
    {
      name: "truncated",
      bytes: webp().subarray(0, 20),
      contentType: "image/webp",
      maxBytes: 30,
    },
  ])(
    "rejects $name without deleting any object",
    async ({ bytes, contentType, maxBytes }) => {
      const storage = createMemoryAdminObjectStorage();
      if (bytes) storage.put(pending, bytes, { contentType });
      const remove = vi.spyOn(storage, "remove");
      await expect(
        verifyPendingWebp(pending, { maxBytes }, storage),
      ).rejects.toBeInstanceOf(InvalidPendingWebpError);
      expect(remove).not.toHaveBeenCalled();
      expect(await storage.head(pending)).toEqual(
        bytes ? expect.objectContaining({ size: bytes.length }) : null,
      );
    },
  );
  it.each([
    { maxBytes: 30, maxLongSide: 639 },
    { maxBytes: 30, size: { width: 639, height: 480 } },
    { maxBytes: 30, size: { width: 640, height: 479 } },
    { maxBytes: Number.NaN },
    { maxBytes: 30, maxLongSide: 0 },
    { maxBytes: 30, size: { width: 0, height: 480 } },
  ])("rejects unsafe or mismatched limits %j", async (options) => {
    const storage = createMemoryAdminObjectStorage();
    storage.put(pending, webp());
    await expect(
      verifyPendingWebp(pending, options, storage),
    ).rejects.toBeInstanceOf(InvalidPendingWebpError);
  });
  it("requires the pending namespace, with a separate validator for authorized final objects", async () => {
    const storage = createMemoryAdminObjectStorage();
    storage.put(final, webp());
    await expect(
      verifyPendingWebp(final, { maxBytes: 30 }, storage),
    ).rejects.toBeInstanceOf(InvalidPendingWebpError);
    expect(
      await verifyAdminWebp(final, { maxBytes: 30 }, storage),
    ).toMatchObject({ width: 640, height: 480 });
  });
});

describe("memory admin object storage", () => {
  it("copies create-only with metadata and never adopts an existing destination", async () => {
    const storage = createMemoryAdminObjectStorage();
    const head = storage.put(pending, webp(), {
      metadata: { "plan-id": planId },
    });
    expect(
      await storage.copy(pending, final, {
        sourceEtag: head.etag,
        ifAbsent: true,
      }),
    ).toBe("created");
    const finalHead = await storage.head(final);
    expect(finalHead).toMatchObject({ metadata: head.metadata, size: 30 });
    storage.put(pending, webp(100, 100));
    expect(
      await storage.copy(pending, final, {
        sourceEtag: head.etag,
        ifAbsent: true,
      }),
    ).toBe("exists");
    expect(await storage.head(final)).toEqual(finalHead);
    await storage.remove(pending);
    expect(await storage.head(pending)).toBeNull();
    expect(await storage.head(final)).toEqual(finalHead);
  });
  it("refuses a changed source before creating a new destination", async () => {
    const storage = createMemoryAdminObjectStorage();
    const head = storage.put(pending, webp());
    storage.put(pending, webp());
    await expect(
      storage.copy(pending, final, { sourceEtag: head.etag, ifAbsent: true }),
    ).rejects.toBeInstanceOf(AdminStoragePreconditionError);
    expect(await storage.head(final)).toBeNull();
  });
  it("does not expose mutable object storage through caller buffers or HEAD metadata", async () => {
    const storage = createMemoryAdminObjectStorage();
    const bytes = webp();
    const metadata = { purpose: "plan-background" };
    storage.put(pending, bytes, { metadata });
    bytes.fill(0);
    metadata.purpose = "changed";
    const head = (await storage.head(pending))!;
    head.metadata.purpose = "changed again";
    expect((await storage.head(pending))!.metadata.purpose).toBe(
      "plan-background",
    );
    const stream = (await storage.readStream(pending))!;
    expect(Buffer.from(await new Response(stream).arrayBuffer())).toEqual(
      webp(),
    );
    expect(await storage.readStream(final)).toBeNull();
  });
});
