import { assertAdminObjectKey } from "./admin-keys";
import {
  InvalidPendingWebpError,
  type AdminObjectHead,
  type AdminObjectStorage,
} from "./admin-types";
import { sniff } from "./file-kind";
import { readImageSize } from "./image-size";

export type VerifyPendingWebpOptions = {
  maxBytes: number;
  size?: { width: number; height: number };
  maxLongSide?: number;
  head?: AdminObjectHead;
};

export async function verifyPendingWebp(
  key: string,
  options: VerifyPendingWebpOptions,
  storage: AdminObjectStorage,
): Promise<AdminObjectHead & { width: number; height: number }> {
  assertAdminObjectKey(key);
  if (!key.startsWith("pending/")) throw new InvalidPendingWebpError();
  return verifyAdminWebp(key, options, storage);
}

export async function verifyAdminWebp(
  key: string,
  options: VerifyPendingWebpOptions,
  storage: AdminObjectStorage,
): Promise<AdminObjectHead & { width: number; height: number }> {
  assertAdminObjectKey(key);
  if (
    !Number.isSafeInteger(options.maxBytes) ||
    options.maxBytes < 1 ||
    (options.maxLongSide !== undefined &&
      (!Number.isSafeInteger(options.maxLongSide) ||
        options.maxLongSide < 1)) ||
    (options.size !== undefined &&
      (!Number.isSafeInteger(options.size.width) ||
        !Number.isSafeInteger(options.size.height) ||
        options.size.width < 1 ||
        options.size.height < 1))
  )
    throw new InvalidPendingWebpError();
  const head = options.head ?? (await storage.head(key));
  if (
    !head ||
    head.contentType !== "image/webp" ||
    !Number.isSafeInteger(head.size) ||
    head.size < 1 ||
    head.size > options.maxBytes ||
    !head.etag
  )
    throw new InvalidPendingWebpError();
  const bytes = await storage.readRange(key, 0, 1023, { ifMatch: head.etag });
  const dimensions =
    sniff(bytes) === "image/webp" ? readImageSize(bytes) : null;
  if (
    !dimensions ||
    (options.maxLongSide !== undefined &&
      Math.max(dimensions.width, dimensions.height) > options.maxLongSide) ||
    (options.size !== undefined &&
      (dimensions.width !== options.size.width ||
        dimensions.height !== options.size.height))
  )
    throw new InvalidPendingWebpError();
  return { ...head, ...dimensions };
}
