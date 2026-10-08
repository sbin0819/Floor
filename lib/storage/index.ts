import { resolve } from "node:path";
import { getEnv } from "@/lib/env";
import { disabledFileStorage } from "./disabled";
import { createLocalFileStorage } from "./local";
import type { FileStorage } from "./types";

export type { FileStorage, LocalFileStorage, UploadTarget } from "./types";
export { isLocalFileStorage } from "./types";

type StorageEnvironment = Pick<
  ReturnType<typeof getEnv>,
  "FILE_STORAGE" | "FILE_STORAGE_DIR" | "NODE_ENV"
>;

export function filesEnabled(env: StorageEnvironment = getEnv()) {
  return (
    (env.FILE_STORAGE ??
      (env.NODE_ENV === "development" ? "local" : "disabled")) === "local"
  );
}

let local: { directory: string; storage: FileStorage } | undefined;

export function getFileStorage(
  env: StorageEnvironment = getEnv(),
): FileStorage {
  if (!filesEnabled(env)) return disabledFileStorage;
  const directory = resolve(env.FILE_STORAGE_DIR ?? ".floor-local/uploads");
  if (!local || local.directory !== directory)
    local = { directory, storage: createLocalFileStorage({ directory }) };
  return local.storage;
}
