import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseEnv } from "@/lib/env";
import { disabledFileStorage } from "@/lib/storage/disabled";
import { filesEnabled, getFileStorage } from "@/lib/storage";
import { createLocalFileStorage } from "@/lib/storage/local";
import {
  isLocalFileStorage,
  StorageBodyError,
  StorageSizeMismatchError,
  type LocalFileStorage,
} from "@/lib/storage/types";

vi.mock("node:fs/promises", { spy: true });
vi.mock("node:crypto", { spy: true });
const realFs =
  await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");

const id = "99999999-0000-4000-8000-000000000001";
const key = `chat/2026/10/${id}`;
const bytes = (value: string) => new TextEncoder().encode(value);
const body = (...chunks: Uint8Array[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });

describe("private local file storage", () => {
  let directory: string;
  let root: string;
  let storage: LocalFileStorage;
  beforeEach(async () => {
    directory = await fs.mkdtemp(join(tmpdir(), "floor-storage-"));
    root = join(directory, "uploads");
    storage = createLocalFileStorage({
      directory: root,
      publicDirectory: join(directory, "public"),
    });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("builds a PUT target without the display name or forbidden browser headers", async () => {
    expect(await storage.createUploadTarget(key, { size: 6 })).toEqual({
      url: `/api/uploads/${id}`,
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
    });
    await expect(fs.stat(root)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      storage.createUploadTarget("chat/2026/10/name.png", { size: 3 }),
    ).rejects.toThrow();
    await expect(
      storage.createUploadTarget(key, { size: 0 }),
    ).rejects.toBeInstanceOf(StorageSizeMismatchError);
  });

  it("streams chunks, bounded heads and full contents, and removes idempotently", async () => {
    expect(
      await storage.writeStream(
        key,
        body(bytes("ab"), bytes("cd"), bytes("ef")),
        6,
      ),
    ).toBe("written");
    expect(await storage.stat(key)).toEqual({ size: 6 });
    expect(await storage.readHead(key, 3)).toEqual(bytes("abc"));
    expect(await storage.readHead(key, 20)).toEqual(bytes("abcdef"));
    expect(await storage.readHead(key, 0)).toHaveLength(0);
    const stream = await storage.readStream(key);
    expect(await new Response(stream).text()).toBe("abcdef");
    const mode = await fs.stat(join(root, key));
    expect(mode.mode & 0o777).toBe(0o600);
    expect((await fs.stat(root)).mode & 0o777).toBe(0o700);
    await storage.remove(key);
    await storage.remove(key);
    expect(await storage.stat(key)).toBeNull();
    expect(await storage.readHead(key, 10)).toHaveLength(0);
    expect(await storage.readStream(key)).toBeNull();
  });

  it("never replaces existing contents, including two simultaneous writers", async () => {
    const results = await Promise.all([
      storage.writeStream(key, body(bytes("first")), 5),
      storage.writeStream(key, body(bytes("other")), 5),
    ]);
    expect(results.sort()).toEqual(["exists", "written"]);
    const original = await fs.readFile(join(root, key), "utf8");
    expect(["first", "other"]).toContain(original);
    expect(await storage.writeStream(key, body(bytes("third")), 5)).toBe(
      "exists",
    );
    expect(await fs.readFile(join(root, key), "utf8")).toBe(original);
    expect(await fs.readdir(join(root, "chat/2026/10"))).toEqual([id]);
  });

  it("does not publish the final key until the stream is complete", async () => {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const source = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
    });
    const write = storage.writeStream(key, source, 6);
    controller!.enqueue(bytes("abc"));
    await vi.waitFor(async () =>
      expect(await fs.readdir(join(root, "chat/2026/10"))).toHaveLength(1),
    );
    expect(await storage.stat(key)).toBeNull();
    expect(await storage.readStream(key)).toBeNull();
    controller!.enqueue(bytes("def"));
    controller!.close();
    expect(await write).toBe("written");
    expect(await storage.stat(key)).toEqual({ size: 6 });
  });

  it.each([0, 2, 4])(
    "rejects a %i-byte body when exactly 3 bytes were promised and cleans its temp file",
    async (length) => {
      await expect(
        storage.writeStream(key, body(new Uint8Array(length)), 3),
      ).rejects.toBeInstanceOf(StorageSizeMismatchError);
      expect(await fs.readdir(join(root, "chat/2026/10"))).toEqual([]);
      expect(await storage.stat(key)).toBeNull();
    },
  );

  it("cancels an overflowing source without requesting its next chunk", async () => {
    const cancel = vi.fn();
    const pull = vi.fn(
      (controller: ReadableStreamDefaultController<Uint8Array>) =>
        controller.enqueue(bytes("1234")),
    );
    const source = new ReadableStream<Uint8Array>(
      { pull, cancel },
      { highWaterMark: 0 },
    );
    await expect(storage.writeStream(key, source, 3)).rejects.toBeInstanceOf(
      StorageSizeMismatchError,
    );
    expect(pull).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(await fs.readdir(join(root, "chat/2026/10"))).toEqual([]);
  });

  it("cleans partial data when the request stream fails and hides its original error", async () => {
    let pulls = 0;
    const source = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (pulls++ === 0) controller.enqueue(bytes("ab"));
          else controller.error(new Error("private body failure"));
        },
      },
      { highWaterMark: 0 },
    );
    await expect(storage.writeStream(key, source, 4)).rejects.toThrow(
      new StorageBodyError(),
    );
    expect(await fs.readdir(join(root, "chat/2026/10"))).toEqual([]);
  });

  it("cleans its temp file when final publication fails", async () => {
    vi.spyOn(fs, "link").mockRejectedValue(
      Object.assign(new Error("disk failure"), { code: "EIO" }),
    );
    await expect(
      storage.writeStream(key, body(bytes("abc")), 3),
    ).rejects.toMatchObject({ code: "EIO" });
    expect(await fs.readdir(join(root, "chat/2026/10"))).toEqual([]);
  });

  it("does not remove a pre-existing temporary filename if exclusive creation fails", async () => {
    await fs.mkdir(join(root, "chat/2026/10"), { recursive: true });
    const temp = join(root, "chat/2026/10", `.upload-${id}`);
    await fs.writeFile(temp, "untouched");
    vi.spyOn(crypto, "randomUUID").mockReturnValue(id);
    await expect(
      storage.writeStream(key, body(bytes("abc")), 3),
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(await fs.readFile(temp, "utf8")).toBe("untouched");
  });

  it("handles a partial filesystem write without dropping bytes", async () => {
    const originalOpen = realFs.open;
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      if (String(args[0]).includes(".upload-")) {
        const originalWrite = handle.write.bind(handle);
        Object.defineProperty(handle, "write", {
          value: async (
            buffer: Uint8Array,
            offset: number,
            length: number,
            position: number | null,
          ) => {
            return originalWrite(buffer, offset, Math.min(2, length), position);
          },
        });
      }
      return handle;
    });
    expect(await storage.writeStream(key, body(bytes("abcdef")), 6)).toBe(
      "written",
    );
    expect(await fs.readFile(join(root, key), "utf8")).toBe("abcdef");
  });

  it.each([
    "../outside",
    "/outside",
    "chat/../outside",
    "chat//x",
    "chat/./x",
    "chat\\outside",
    "C:/outside",
    "%2e%2e/outside",
    "chat/x%2fy",
    "chat/\0x",
    "",
  ])(
    "rejects traversal or ambiguous key %j for every operation",
    async (invalid) => {
      await expect(
        storage.writeStream(invalid, body(bytes("a")), 1),
      ).rejects.toThrow("Invalid storage key");
      await expect(storage.readHead(invalid, 1)).rejects.toThrow(
        "Invalid storage key",
      );
      await expect(storage.stat(invalid)).rejects.toThrow(
        "Invalid storage key",
      );
      await expect(storage.readStream(invalid)).rejects.toThrow(
        "Invalid storage key",
      );
      await expect(storage.remove(invalid)).rejects.toThrow(
        "Invalid storage key",
      );
    },
  );

  it("rejects a parent symlink without writing or reading outside the root", async () => {
    const outside = join(directory, "outside");
    await fs.mkdir(outside);
    await fs.writeFile(join(outside, "value"), "private");
    await fs.mkdir(root);
    await fs.symlink(outside, join(root, "redirect"));
    for (const operation of [
      () => storage.writeStream("redirect/value", body(bytes("a")), 1),
      () => storage.stat("redirect/value"),
      () => storage.readHead("redirect/value", 5),
      () => storage.readStream("redirect/value"),
      () => storage.remove("redirect/value"),
    ])
      await expect(operation()).rejects.toThrow("Invalid storage directory");
    expect(await fs.readFile(join(outside, "value"), "utf8")).toBe("private");
  });

  it("does not follow or remove a final symlink or replace it on upload", async () => {
    await fs.mkdir(join(root, "chat/2026/10"), { recursive: true });
    const outside = join(directory, "outside");
    await fs.writeFile(outside, "private");
    await fs.symlink(outside, join(root, key));
    await expect(storage.readHead(key, 10)).rejects.toThrow();
    await expect(storage.readStream(key)).rejects.toThrow();
    await expect(storage.stat(key)).rejects.toThrow();
    await expect(storage.remove(key)).rejects.toThrow();
    expect(await storage.writeStream(key, body(bytes("a")), 1)).toBe("exists");
    expect((await fs.lstat(join(root, key))).isSymbolicLink()).toBe(true);
    expect(await fs.readFile(outside, "utf8")).toBe("private");
  });

  it("rejects non-regular final objects", async () => {
    await fs.mkdir(join(root, key), { recursive: true });
    await expect(storage.stat(key)).rejects.toThrow("not a regular file");
    await expect(storage.readHead(key, 10)).rejects.toThrow(
      "not a regular file",
    );
    await expect(storage.readStream(key)).rejects.toThrow("not a regular file");
    await expect(storage.remove(key)).rejects.toThrow("not a regular file");
  });

  it("rejects public roots and aliases that resolve into public", async () => {
    const publicDirectory = join(directory, "public");
    await fs.mkdir(publicDirectory);
    const alias = join(directory, "alias");
    await fs.symlink(publicDirectory, alias);
    for (const path of [
      publicDirectory,
      join(publicDirectory, "uploads"),
      join(alias, "uploads"),
      directory,
    ]) {
      const unsafe = createLocalFileStorage({
        directory: path,
        publicDirectory,
      });
      await expect(
        unsafe.writeStream(key, body(bytes("a")), 1),
      ).rejects.toThrow("private directory");
    }
    expect(await fs.readdir(publicDirectory)).toEqual([]);
  });

  it("rejects a root replaced by a symlink after initialization", async () => {
    await storage.writeStream(key, body(bytes("safe")), 4);
    await fs.rename(root, join(directory, "old"));
    await fs.symlink(join(directory, "old"), root);
    await expect(storage.stat(key)).rejects.toThrow(
      "Invalid storage directory",
    );
    await expect(storage.remove(key)).rejects.toThrow(
      "Invalid storage directory",
    );
  });

  it("bounds readHead allocation", async () => {
    for (const size of [-1, 0.5, NaN, Infinity, 1024 * 1024 + 1])
      await expect(storage.readHead(key, size)).rejects.toThrow("head length");
  });

  it("closes the original file handle when a download stream is cancelled", async () => {
    await storage.writeStream(
      key,
      body(new Uint8Array(512 * 1024)),
      512 * 1024,
    );
    const originalOpen = realFs.open;
    let readHandle: fs.FileHandle | undefined;
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      readHandle = handle;
      return handle;
    });
    const reader = (await storage.readStream(key))!.getReader();
    await reader.read();
    await reader.cancel();
    await vi.waitFor(() => expect(readHandle?.fd).toBe(-1));
  });
});

describe("disabled storage and environment selection", () => {
  it("never writes and returns empty reads", async () => {
    expect(isLocalFileStorage(disabledFileStorage)).toBe(false);
    await expect(
      disabledFileStorage.createUploadTarget(key, { size: 1 }),
    ).rejects.toThrow("disabled");
    expect(await disabledFileStorage.readHead(key, 8)).toHaveLength(0);
    expect(await disabledFileStorage.stat(key)).toBeNull();
    expect(await disabledFileStorage.readStream(key)).toBeNull();
    await expect(disabledFileStorage.remove(key)).resolves.toBeUndefined();
  });
  it.each(["development", "test", "production"] as const)(
    "defaults to local only in development (%s)",
    (mode) => {
      const env = parseEnv({ NODE_ENV: mode });
      expect(filesEnabled(env)).toBe(mode === "development");
      expect(getFileStorage(env).kind).toBe(
        mode === "development" ? "local" : "disabled",
      );
      expect(
        getFileStorage(parseEnv({ NODE_ENV: mode, FILE_STORAGE: "disabled" }))
          .kind,
      ).toBe("disabled");
      expect(
        getFileStorage(parseEnv({ NODE_ENV: mode, FILE_STORAGE: "local" }))
          .kind,
      ).toBe("local");
    },
  );
  it("lazily creates factories without touching the configured directory", () => {
    const mkdir = vi.spyOn(fs, "mkdir");
    try {
      const env = parseEnv({
        FILE_STORAGE: "local",
        FILE_STORAGE_DIR: "/a-directory-that-does-not-exist/floor-upload",
      });
      const first = getFileStorage(env);
      expect(getFileStorage(env)).toBe(first);
      expect(isLocalFileStorage(first)).toBe(true);
      expect(mkdir).not.toHaveBeenCalled();
    } finally {
      mkdir.mockRestore();
    }
  });
});
