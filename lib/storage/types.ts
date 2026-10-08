export type UploadTarget = {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
};

export interface FileStorage {
  readonly kind: "local" | "disabled";
  createUploadTarget(
    key: string,
    options: { size: number },
  ): Promise<UploadTarget>;
  readHead(key: string, bytes: number): Promise<Uint8Array>;
  stat(key: string): Promise<{ size: number } | null>;
  readStream(key: string): Promise<ReadableStream<Uint8Array> | null>;
  remove(key: string): Promise<void>;
}

export interface LocalFileStorage extends FileStorage {
  readonly kind: "local";
  writeStream(
    key: string,
    body: ReadableStream<Uint8Array>,
    exactBytes: number,
  ): Promise<"written" | "exists">;
}

export function isLocalFileStorage(
  storage: FileStorage,
): storage is LocalFileStorage {
  return storage.kind === "local" && "writeStream" in storage;
}

export class StorageSizeMismatchError extends Error {
  constructor() {
    super("Upload body length does not match.");
    this.name = "StorageSizeMismatchError";
  }
}

export class StorageBodyError extends Error {
  constructor() {
    super("Upload body could not be read.");
    this.name = "StorageBodyError";
  }
}
