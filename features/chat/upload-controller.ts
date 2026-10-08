import type { ActionResult } from "@/lib/actions/result";
import { isBlockedName, normalizeFileName } from "@/lib/storage/file-kind";
import type { ChatAttachment } from "./types";
import {
  MAX_UPLOAD_BYTES,
  type UploadCompletion,
  type UploadTarget,
} from "./upload-types";
import { UploadHttpError, type UploadFile } from "./upload-file";

export type UploadActions = {
  create: (input: {
    roomId: string;
    files: { name: string; size: number }[];
  }) => Promise<ActionResult<UploadTarget[]>>;
  complete: (input: {
    attachmentIds: string[];
  }) => Promise<ActionResult<UploadCompletion[]>>;
  discard: (input: {
    attachmentIds: string[];
  }) => Promise<ActionResult<object>>;
};
export type UploadItem = {
  id: string;
  file: File;
  name: string;
  size: number;
  previewUrl: string | null;
  status:
    "starting" | "queued" | "uploading" | "completing" | "ready" | "failed";
  progress: number;
  error?: string;
  target?: UploadTarget;
  attachment?: ChatAttachment;
};
export const uploadErrors = {
  disabled: "파일 공유는 준비 중이에요",
  request: "상대가 수락하면 파일을 보낼 수 있어요",
  offline: "연결되면 다시 올려 주세요",
  blocked: "이 종류의 파일은 보낼 수 없어요",
  size: "25MB보다 큰 파일은 보낼 수 없어요",
  count: "한 번에 10개까지 보낼 수 있어요",
  quota:
    "올린 파일이 1GB를 넘었어요. 파일이 있는 메시지를 지우면 공간이 생겨요",
  rate: "잠시 뒤에 다시 올려 주세요",
  failed: "파일을 올리지 못했어요. 다시 올려 주세요",
} as const;
export function uploadActionError(
  result: Exclude<ActionResult<unknown>, { ok: true }>,
) {
  if (result.message === "storage_quota") return uploadErrors.quota;
  if (result.code === "LIMIT_EXCEEDED") return uploadErrors.rate;
  if (result.code === "FORBIDDEN") return uploadErrors.request;
  return uploadErrors.failed;
}

export function createUploadController(options: {
  roomId: string;
  actions: UploadActions;
  upload: UploadFile;
  notify: (message: string) => void;
  objectUrls: { create: (file: File) => string; revoke: (url: string) => void };
}) {
  let items: UploadItem[] = [];
  let active = true;
  let generation = 0;
  let unavailable: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let completing = false;
  const listeners = new Set<() => void>();
  const running = new Map<string, AbortController>();
  const waiting = new Set<string>();
  const emit = () => listeners.forEach((listener) => listener());
  const find = (id: string) => items.find((item) => item.id === id);
  const change = (id: string, update: Partial<UploadItem>) => {
    if (!find(id)) return;
    items = items.map((item) =>
      item.id === id ? { ...item, ...update } : item,
    );
    emit();
  };
  const discard = (ids: string[]) => {
    if (ids.length)
      void options.actions
        .discard({ attachmentIds: ids })
        .catch(() => undefined);
  };
  const revoke = (item: UploadItem) => {
    if (item.previewUrl) options.objectUrls.revoke(item.previewUrl);
  };
  const scheduleComplete = () => {
    if (!timer && !completing && waiting.size)
      timer = setTimeout(() => {
        timer = undefined;
        void complete();
      }, 1000);
  };
  async function complete() {
    if (!active || completing) return;
    const batch = [...waiting]
      .map(find)
      .filter((item): item is UploadItem => !!item?.target);
    waiting.clear();
    if (!batch.length) return;
    const version = generation;
    completing = true;
    try {
      const result = await options.actions.complete({
        attachmentIds: batch.map((item) => item.target!.attachmentId),
      });
      if (!active || version !== generation) return;
      for (const item of batch) {
        if (!find(item.id)) continue;
        const value = result.ok
          ? result.data.find(
              (value) => value.attachmentId === item.target!.attachmentId,
            )
          : undefined;
        if (value?.ok) {
          const { attachmentId, name, size, kind, width, height } = value;
          change(item.id, {
            status: "ready",
            progress: 100,
            error: undefined,
            attachment: { id: attachmentId, name, size, kind, width, height },
          });
        } else {
          const error = !result.ok
            ? uploadActionError(result)
            : value?.reason === "blocked_type"
              ? uploadErrors.blocked
              : uploadErrors.failed;
          discard([item.target!.attachmentId]);
          change(item.id, { status: "failed", target: undefined, error });
        }
      }
    } catch {
      if (active && version === generation)
        for (const item of batch) {
          // 완료 응답이 끊겼다면 PUT을 덮어쓰지 않고 같은 ID로 완료부터 다시 확인한다.
          change(item.id, {
            status: "failed",
            progress: 100,
            error: uploadErrors.failed,
          });
        }
    } finally {
      completing = false;
      scheduleComplete();
    }
  }
  function pump() {
    if (!active || unavailable) return;
    while (running.size < 3) {
      const item = items.find(
        (item) => item.status === "queued" && !running.has(item.id),
      );
      if (!item?.target) break;
      const controller = new AbortController();
      const version = generation;
      running.set(item.id, controller);
      change(item.id, { status: "uploading", progress: 0, error: undefined });
      void options
        .upload(item.target.uploadUrl, item.file, {
          headers: item.target.headers,
          signal: controller.signal,
          onProgress: (progress) => {
            if (active && generation === version && !controller.signal.aborted)
              change(item.id, { progress });
          },
        })
        .then(() => {
          if (!active || generation !== version || !find(item.id)) return;
          change(item.id, { status: "completing", progress: 100 });
          waiting.add(item.id);
          scheduleComplete();
        })
        .catch((error: unknown) => {
          if (
            !active ||
            generation !== version ||
            !find(item.id) ||
            controller.signal.aborted
          )
            return;
          if (error instanceof UploadHttpError && error.status === 409) {
            change(item.id, { status: "completing", progress: 100 });
            waiting.add(item.id);
            scheduleComplete();
          } else {
            const retired =
              error instanceof UploadHttpError &&
              [403, 404].includes(error.status);
            if (retired) discard([item.target!.attachmentId]);
            change(item.id, {
              status: "failed",
              error: uploadErrors.failed,
              ...(retired ? { target: undefined } : {}),
            });
          }
        })
        .finally(() => {
          if (running.get(item.id) === controller) running.delete(item.id);
          pump();
        });
    }
  }
  async function reserve(batch: UploadItem[]) {
    const version = generation;
    try {
      const result = await options.actions.create({
        roomId: options.roomId,
        files: batch.map(({ name, size }) => ({ name, size })),
      });
      if (!result.ok) {
        if (active && version === generation) {
          const error = uploadActionError(result);
          batch.forEach((item) => change(item.id, { status: "failed", error }));
          options.notify(error);
        }
        return;
      }
      result.data.forEach((target, index) => {
        const item = batch[index];
        if (!item || !active || generation !== version || !find(item.id))
          discard([target.attachmentId]);
        else change(item.id, { target, status: "queued" });
      });
      pump();
    } catch {
      if (active && version === generation)
        batch.forEach((item) =>
          change(item.id, { status: "failed", error: uploadErrors.failed }),
        );
    }
  }
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => items,
    activate() {
      active = true;
    },
    setUnavailable(reason: string | null) {
      unavailable = reason;
      if (!reason) pump();
    },
    add(files: readonly File[]) {
      if (!active) return;
      if (unavailable) {
        options.notify(unavailable);
        return;
      }
      const batch: UploadItem[] = [];
      for (const file of files) {
        const name = normalizeFileName(file.name);
        if (isBlockedName(name)) {
          options.notify(uploadErrors.blocked);
          continue;
        }
        if (file.size < 1 || file.size > MAX_UPLOAD_BYTES) {
          options.notify(uploadErrors.size);
          continue;
        }
        if (items.length + batch.length >= 10) {
          options.notify(uploadErrors.count);
          continue;
        }
        batch.push({
          id: crypto.randomUUID(),
          file,
          name,
          size: file.size,
          previewUrl: /^image\/(?:jpeg|png|gif|webp)$/.test(file.type)
            ? options.objectUrls.create(file)
            : null,
          status: "starting",
          progress: 0,
        });
      }
      if (!batch.length) return;
      items = [...items, ...batch];
      emit();
      void reserve(batch);
    },
    remove(id: string) {
      const item = find(id);
      if (!item) return;
      running.get(id)?.abort();
      waiting.delete(id);
      items = items.filter((item) => item.id !== id);
      revoke(item);
      emit();
      if (item.target) discard([item.target.attachmentId]);
    },
    retry(id: string) {
      if (unavailable) {
        options.notify(unavailable);
        return;
      }
      const item = find(id);
      if (!item || item.status !== "failed") return;
      if (item.target && item.progress === 100) {
        change(id, { status: "completing", error: undefined });
        waiting.add(id);
        scheduleComplete();
      } else if (item.target) {
        change(id, { status: "queued", error: undefined });
        pump();
      } else {
        change(id, { status: "starting", error: undefined });
        void reserve([item]);
      }
    },
    take(): ChatAttachment[] {
      if (items.some((item) => item.status !== "ready")) return [];
      const attachments = items.flatMap((item) =>
        item.attachment ? [item.attachment] : [],
      );
      items.forEach(revoke);
      items = [];
      emit();
      return attachments;
    },
    dispose() {
      active = false;
      generation += 1;
      running.forEach((controller) => controller.abort());
      running.clear();
      waiting.clear();
      if (timer) clearTimeout(timer);
      timer = undefined;
      discard(
        items.flatMap((item) =>
          item.target ? [item.target.attachmentId] : [],
        ),
      );
      items.forEach(revoke);
      items = [];
      emit();
    },
  };
}
export type UploadController = ReturnType<typeof createUploadController>;
