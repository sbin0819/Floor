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
  // 업로드 파일은 런타임 데이터이므로 빌드의 파일 추적 대상이 아니다.
  const directory = resolve(
    /* turbopackIgnore: true */ env.FILE_STORAGE_DIR ?? ".floor-local/uploads",
  );
  if (!local || local.directory !== directory)
    local = { directory, storage: createLocalFileStorage({ directory }) };
  return local.storage;
}
