export type AdminObjectHead = {
  size: number;
  contentType: string | null;
  etag: string;
  metadata: Record<string, string>;
};

export type AdminUploadOptions = {
  contentType: "image/webp";
  contentLength: number;
  expiresIn: number;
  metadata: Record<string, string>;
};

export interface AdminObjectStorage {
  createUploadUrl(key: string, options: AdminUploadOptions): Promise<string>;
  head(key: string): Promise<AdminObjectHead | null>;
  readRange(
    key: string,
    start: number,
    end: number,
    options: { ifMatch: string },
  ): Promise<Uint8Array>;
  readStream(key: string): Promise<ReadableStream<Uint8Array> | null>;
  copy(
    from: string,
    to: string,
    options: { sourceEtag: string; ifAbsent: true },
  ): Promise<"created" | "exists">;
  remove(key: string): Promise<void>;
}

export class AdminStoragePreconditionError extends Error {
  constructor() {
    super("The stored object has changed.");
    this.name = "AdminStoragePreconditionError";
  }
}

export class InvalidPendingWebpError extends Error {
  constructor() {
    super("The uploaded image is invalid.");
    this.name = "InvalidPendingWebpError";
  }
}
