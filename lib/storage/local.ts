import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  realpath,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import {
  StorageBodyError,
  StorageSizeMismatchError,
  type LocalFileStorage,
} from "./types";

function hasCode(error: unknown, code: string) {
  return error instanceof Error && "code" in error && error.code === code;
}

function within(directory: string, path: string) {
  const part = relative(directory, path);
  return (
    part === "" ||
    (!isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`))
  );
}

function keyParts(key: string) {
  // 저장 키는 앱이 만든 ASCII 경로뿐이다. 파일 이름·URL 디코딩은 여기서 다루지 않는다.
  if (key.length > 240 || !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(key))
    throw new Error("Invalid storage key.");
  return key.split("/");
}

async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(await canonicalPath(parent), relative(parent, path));
  }
}

async function removeTemp(path: string | undefined) {
  if (!path) return;
  try {
    await unlink(path);
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
  }
}

export function createLocalFileStorage({
  directory,
  publicDirectory = resolve("public"),
}: {
  directory: string;
  publicDirectory?: string;
}): LocalFileStorage {
  const configuredRoot = resolve(directory);
  const configuredPublic = resolve(publicDirectory);
  let initialized: Promise<string> | undefined;

  async function initialize() {
    const [root, publicRoot] = await Promise.all([
      canonicalPath(configuredRoot),
      canonicalPath(configuredPublic),
    ]);
    if (
      within(configuredPublic, configuredRoot) ||
      within(publicRoot, root) ||
      within(root, publicRoot)
    )
      throw new Error("Storage must use a private directory outside public.");
    try {
      if ((await lstat(configuredRoot)).isSymbolicLink())
        throw new Error("Storage directory must not be a symbolic link.");
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }
    await mkdir(root, { recursive: true, mode: 0o700 });
    if (!(await lstat(root)).isDirectory())
      throw new Error("Invalid storage directory.");
    return root;
  }

  async function rootDirectory() {
    initialized ??= initialize().catch((error: unknown) => {
      initialized = undefined;
      throw error;
    });
    return initialized;
  }

  async function filePath(key: string, createParents: boolean) {
    const parts = keyParts(key);
    const root = await rootDirectory();
    const rootInfo = await lstat(root);
    if (
      !rootInfo.isDirectory() ||
      rootInfo.isSymbolicLink() ||
      (await realpath(root)) !== root
    )
      throw new Error("Invalid storage directory.");
    let parent = root;
    // 서비스만 쓰는 폴더가 전제다. 각 요소를 확인해 기존 심볼릭 링크는 따라가지 않는다.
    for (const part of parts.slice(0, -1)) {
      parent = join(parent, part);
      if (createParents) {
        try {
          await mkdir(parent, { mode: 0o700 });
        } catch (error) {
          if (!hasCode(error, "EEXIST")) throw error;
        }
      }
      const info = await lstat(parent);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error("Invalid storage directory.");
    }
    const path = resolve(parent, parts.at(-1)!);
    if (!within(root, path)) throw new Error("Invalid storage key.");
    return path;
  }

  async function openFile(key: string): Promise<FileHandle | null> {
    let handle: FileHandle | undefined;
    try {
      const path = await filePath(key, false);
      handle = await open(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      if (!(await handle.stat()).isFile())
        throw new Error("Storage object is not a regular file.");
      return handle;
    } catch (error) {
      await handle?.close();
      if (hasCode(error, "ENOENT")) return null;
      throw error;
    }
  }

  return {
    kind: "local",
    async createUploadTarget(key, { size }) {
      const parts = keyParts(key);
      const id = parts.at(-1)!;
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          id,
        )
      )
        throw new Error("Invalid upload identifier.");
      if (!Number.isSafeInteger(size) || size < 1)
        throw new StorageSizeMismatchError();
      return {
        url: `/api/uploads/${id}`,
        method: "PUT",
        // Content-Length는 브라우저가 정한다. XHR로 설정할 수 없는 머리를 넘기지 않는다.
        headers: { "Content-Type": "application/octet-stream" },
      };
    },
    async writeStream(key, body, exactBytes) {
      const reader = body.getReader();
      let handle: FileHandle | undefined;
      let temp: string | undefined;
      let ended = false;
      try {
        if (!Number.isSafeInteger(exactBytes) || exactBytes < 1)
          throw new StorageSizeMismatchError();
        const path = await filePath(key, true);
        const candidate = join(dirname(path), `.upload-${randomUUID()}`);
        handle = await open(
          candidate,
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o600,
        );
        temp = candidate;
        let total = 0;
        while (true) {
          let item: ReadableStreamReadResult<Uint8Array>;
          try {
            item = await reader.read();
          } catch {
            throw new StorageBodyError();
          }
          if (item.done) {
            ended = true;
            break;
          }
          if (!(item.value instanceof Uint8Array)) throw new StorageBodyError();
          total += item.value.byteLength;
          if (total > exactBytes) throw new StorageSizeMismatchError();
          let offset = 0;
          while (offset < item.value.byteLength) {
            const { bytesWritten } = await handle.write(
              item.value,
              offset,
              item.value.byteLength - offset,
              null,
            );
            if (!bytesWritten) throw new Error("Storage write failed.");
            offset += bytesWritten;
          }
        }
        if (total !== exactBytes) throw new StorageSizeMismatchError();
        await handle.close();
        handle = undefined;
        try {
          // 같은 파일시스템의 완성된 inode만 공개하므로 부분 파일이나 덮어쓰기가 없다.
          await link(temp, path);
          return "written";
        } catch (error) {
          if (hasCode(error, "EEXIST")) return "exists";
          throw error;
        }
      } finally {
        try {
          if (!ended) await reader.cancel().catch(() => {});
          reader.releaseLock();
        } finally {
          try {
            await handle?.close();
          } finally {
            await removeTemp(temp);
          }
        }
      }
    },
    async readHead(key, bytes) {
      if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > 1024 * 1024)
        throw new Error("Invalid storage head length.");
      const handle = await openFile(key);
      if (!handle) return new Uint8Array();
      try {
        const head = new Uint8Array(bytes);
        let offset = 0;
        while (offset < bytes) {
          const { bytesRead } = await handle.read(
            head,
            offset,
            bytes - offset,
            offset,
          );
          if (!bytesRead) break;
          offset += bytesRead;
        }
        return head.subarray(0, offset);
      } finally {
        await handle.close();
      }
    },
    async stat(key) {
      const handle = await openFile(key);
      if (!handle) return null;
      try {
        return { size: (await handle.stat()).size };
      } finally {
        await handle.close();
      }
    },
    async readStream(key) {
      const handle = await openFile(key);
      if (!handle) return null;
      // 같은 FD를 쓴다. Node 22.12에서도 종료·오류·cancel 때 FD가 닫히는 경로다.
      // Node와 DOM 선언의 BYOB 타입만 다르며, 이 스트림의 실제 청크는 Buffer다.
      return Readable.toWeb(
        handle.createReadStream({ autoClose: true }),
      ) as unknown as ReadableStream<Uint8Array>;
    },
    async remove(key) {
      try {
        const path = await filePath(key, false);
        const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink())
          throw new Error("Storage object is not a regular file.");
        await unlink(path);
      } catch (error) {
        if (!hasCode(error, "ENOENT")) throw error;
      }
    },
  };
}
