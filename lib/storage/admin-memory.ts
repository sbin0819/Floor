import { assertAdminObjectKey } from "./admin-keys";
import {
  AdminStoragePreconditionError,
  type AdminObjectHead,
  type AdminObjectStorage,
  type AdminUploadOptions,
} from "./admin-types";

export function createMemoryAdminObjectStorage() {
  const objects = new Map<
    string,
    { bytes: Uint8Array; head: AdminObjectHead }
  >();
  const uploads = new Map<string, AdminUploadOptions>();
  let revision = 0;
  const storage: AdminObjectStorage & {
    uploads: ReadonlyMap<string, AdminUploadOptions>;
    put(
      key: string,
      bytes: Uint8Array,
      options?: { contentType?: string; metadata?: Record<string, string> },
    ): AdminObjectHead;
  } = {
    uploads,
    put(key, bytes, options = {}) {
      assertAdminObjectKey(key);
      const head = {
        size: bytes.byteLength,
        contentType: options.contentType ?? "image/webp",
        metadata: { ...options.metadata },
        etag: `"memory-${++revision}"`,
      };
      objects.set(key, { bytes: Uint8Array.from(bytes), head });
      return structuredClone(head);
    },
    async createUploadUrl(key, options) {
      assertAdminObjectKey(key);
      if (!key.startsWith("pending/")) throw new Error("Invalid upload key.");
      uploads.set(key, structuredClone(options));
      return `https://uploads.invalid/${key}`;
    },
    async head(key) {
      assertAdminObjectKey(key);
      return structuredClone(objects.get(key)?.head ?? null);
    },
    async readRange(key, start, end, options) {
      assertAdminObjectKey(key);
      const object = objects.get(key);
      if (!object || object.head.etag !== options.ifMatch)
        throw new AdminStoragePreconditionError();
      return object.bytes.slice(start, end + 1);
    },
    async readStream(key) {
      assertAdminObjectKey(key);
      const object = objects.get(key);
      return object
        ? new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(object.bytes.slice());
              controller.close();
            },
          })
        : null;
    },
    async copy(from, to, options) {
      assertAdminObjectKey(from);
      assertAdminObjectKey(to);
      if (options.ifAbsent !== true || from === to)
        throw new Error("Invalid copy options.");
      const object = objects.get(from);
      if (objects.has(to)) return "exists";
      if (!object || object.head.etag !== options.sourceEtag)
        throw new AdminStoragePreconditionError();
      storage.put(to, object.bytes, {
        contentType: object.head.contentType ?? undefined,
        metadata: object.head.metadata,
      });
      return "created";
    },
    async remove(key) {
      assertAdminObjectKey(key);
      objects.delete(key);
    },
  };
  return storage;
}
