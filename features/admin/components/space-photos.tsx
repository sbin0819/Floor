"use client";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  useIsMutating,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import type { ActionResult } from "@/lib/actions/result";
import { errorMessage } from "@/lib/errors/messages";
import { notifySessionExpired } from "@/lib/errors/session-expired";
import { isRequestCanceled } from "@/lib/http/errors";
import { photoAltSchema } from "@/lib/photos/schema";
import { toWebp, WebpConversionError } from "@/features/uploads/to-webp";
import { uploadToR2 } from "@/features/uploads/upload-to-r2";
import {
  createSpacePhotoUpload,
  confirmSpacePhotoUpload,
  reorderSpacePhotos,
  updateSpacePhotoAlt,
  deleteSpacePhoto,
} from "@/features/admin/photo-actions";
import type { AdminSpacePhoto } from "../space-detail-types";
import { spaceDetailTab } from "../space-detail-navigation";
import { adminErrorMessage } from "./use-admin-mutation";
import { SpacePhotoCard } from "./space-photo-card";
import { PhotoUploadProgress } from "./photo-upload-progress";

function signature(photos: AdminSpacePhoto[]) {
  return JSON.stringify(photos.map((p) => [p.id, p.alt, p.sortOrder]));
}
function errorText(result: Extract<ActionResult<unknown>, { ok: false }>) {
  if (result.message === "files_disabled")
    return "이 환경에서는 파일을 올릴 수 없어요";
  if (result.code === "LIMIT_EXCEEDED") return "사진은 공간마다 8장까지예요";
  return adminErrorMessage(result.code);
}
export function photoConversionMessage(error: unknown) {
  if (error instanceof WebpConversionError) {
    if (error.code === "too_small") return "1200×750 이상인 사진을 골라 주세요";
    if (error.code === "too_large")
      return "사진이 너무 복잡해요. 다른 사진을 골라 주세요";
    if (error.code === "unsupported")
      return "이 브라우저에서는 사진을 올릴 수 없어요";
  }
  return "JPG, PNG, WebP 사진을 골라 주세요";
}
export function SpacePhotos({
  spaceId,
  path,
  photos,
  enabled,
  canManage,
}: {
  spaceId: string;
  path: string;
  photos: AdminSpacePhoto[];
  enabled: boolean;
  canManage: boolean;
}) {
  const router = useRouter(),
    id = useId();
  const client = useQueryClient();
  const [override, setOverride] = useState<{
    base: string;
    rows: AdminSpacePhoto[];
  } | null>(null);
  const base = signature(photos),
    rows = override?.base === base ? override.rows : photos;
  const [error, setError] = useState(""),
    [announcement, setAnnouncement] = useState("");
  const [prepared, setPrepared] = useState<Blob | null>(null),
    [alt, setAlt] = useState("");
  const [preparing, setPreparing] = useState(false),
    [progress, setProgress] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<AdminSpacePhoto | null>(null),
    [dragTarget, setDragTarget] = useState<string | null>(null);
  const mounted = useRef(false),
    generation = useRef(0),
    lock = useRef<symbol | null>(null),
    abort = useRef<AbortController | null>(null);
  const drag = useRef<{ id: string; pointerId: number; target: string } | null>(
      null,
    ),
    grid = useRef<HTMLDivElement | null>(null),
    fileInput = useRef<HTMLInputElement | null>(null),
    returnFocus = useRef<string | null>(null),
    interrupted = useRef(false);
  const activePath = () => {
    const tabs = new URLSearchParams(window.location.search).getAll("tab");
    return (
      window.location.pathname === path &&
      spaceDetailTab(tabs.length === 1 ? tabs[0] : tabs) === "photos"
    );
  };
  const current = (value: number) =>
    mounted.current && generation.current === value && activePath();
  useLayoutEffect(() => {
    mounted.current = true;
    generation.current += 1;
    if (interrupted.current) {
      const restored = generation.current;
      interrupted.current = false;
      queueMicrotask(() => {
        if (!mounted.current || generation.current !== restored) return;
        setPreparing(false);
        setProgress(null);
        setPrepared(null);
        setDeleting(null);
        setDragTarget(null);
        setOverride(null);
      });
    }
    return () => {
      interrupted.current =
        lock.current !== null ||
        abort.current !== null ||
        drag.current !== null;
      mounted.current = false;
      generation.current += 1;
      const controller = abort.current;
      abort.current = null;
      lock.current = null;
      controller?.abort();
      drag.current = null;
    };
  }, [path]);
  const pending = useIsMutating({ mutationKey: ["admin-actions"] }) > 0;
  const mutation = useMutation({
    mutationKey: ["admin-actions"],
    scope: { id: "admin-actions" },
    retry: false,
    mutationFn: (operation: () => Promise<ActionResult<unknown>>) =>
      operation(),
  });
  const disabled = !canManage || pending || preparing;
  function showError(text: string, failure?: unknown) {
    setError(text);
    if (!notifySessionExpired(client, failure)) toast.error(text);
  }
  async function execute(
    operation: () => Promise<ActionResult<unknown>>,
    success: () => void,
    rollback?: () => void,
  ) {
    if (lock.current || pending || !canManage || !activePath()) return;
    const operationId = Symbol(),
      controller = abort.current;
    lock.current = operationId;
    setError("");
    const before = generation.current;
    try {
      const result = await mutation.mutateAsync(operation);
      if (!current(before)) return;
      if (!result.ok) {
        rollback?.();
        showError(errorText(result), result);
        return;
      }
      success();
      toast.success("저장했어요");
      router.refresh();
    } catch (failure) {
      if (!current(before)) return;
      rollback?.();
      if (!isRequestCanceled(failure))
        showError(
          errorMessage(
            failure,
            "저장하지 못했어요. 잠시 뒤 다시 시도해 주세요",
          ),
          failure,
        );
    } finally {
      if (lock.current === operationId) {
        lock.current = null;
        if (abort.current === controller) abort.current = null;
        if (current(before)) setProgress(null);
      }
    }
  }
  function focusPhoto(photoId: string) {
    grid.current
      ?.querySelector<HTMLElement>(`[data-photo-id="${photoId}"]`)
      ?.focus();
  }
  function move(photoId: string, to: number) {
    if (disabled || lock.current || !activePath()) return;
    const from = rows.findIndex((photo) => photo.id === photoId);
    if (from < 0 || from === to || to < 0 || to >= rows.length) return;
    const previous = rows,
      next = [...rows],
      photo = next.splice(from, 1)[0]!;
    next.splice(to, 0, photo);
    const ordered = next.map((p, sortOrder) => ({ ...p, sortOrder }));
    setOverride({ base, rows: ordered });
    setAnnouncement(
      `사진 ${from + 1}, ${rows.length}장 가운데 ${to + 1}번째로 옮겼어요`,
    );
    void execute(
      () => reorderSpacePhotos({ spaceId, photoIds: ordered.map((p) => p.id) }),
      () => focusPhoto(photoId),
      () => {
        setOverride({ base, rows: previous });
        setAnnouncement("순서를 바꾸지 못해 원래대로 되돌렸어요");
        focusPhoto(photoId);
      },
    );
  }
  function saveAlt(photo: AdminSpacePhoto, value: string) {
    if (disabled || lock.current) return;
    const parsed = photoAltSchema.safeParse(value);
    if (!parsed.success || value.includes("\0")) {
      showError("사진 설명은 1자 이상 120자 이하로 입력해 주세요");
      return;
    }
    void execute(
      () => updateSpacePhotoAlt({ photoId: photo.id, alt: value }),
      () =>
        setOverride({
          base,
          rows: rows.map((p) => (p.id === photo.id ? { ...p, alt: value } : p)),
        }),
    );
  }
  async function choose(file: File | undefined) {
    if (!file || disabled || lock.current || !enabled || !activePath()) return;
    if (rows.length >= 8) {
      showError("사진은 공간마다 8장까지예요");
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      showError("JPG, PNG, WebP 사진을 골라 주세요");
      return;
    }
    if (file.size > 10 * 1024 * 1024 || file.size === 0) {
      showError("10MB 이하의 사진을 골라 주세요");
      return;
    }
    const before = generation.current,
      controller = new AbortController(),
      operationId = Symbol();
    abort.current?.abort();
    abort.current = controller;
    lock.current = operationId;
    setPreparing(true);
    setError("");
    try {
      const converted = await toWebp(file, {
        crop: { width: 1200, height: 750 },
        maxBytes: 1024 * 1024,
        signal: controller.signal,
      });
      if (current(before)) {
        setAlt("");
        setPrepared(converted.blob);
      }
    } catch (failure) {
      if (current(before) && !controller.signal.aborted)
        showError(photoConversionMessage(failure));
    } finally {
      if (lock.current === operationId) {
        lock.current = null;
        if (abort.current === controller) abort.current = null;
        if (current(before)) setPreparing(false);
      }
    }
  }
  function upload() {
    if (!prepared || disabled || lock.current || !activePath()) return;
    if (!photoAltSchema.safeParse(alt).success || alt.includes("\0")) {
      showError("설명을 적어 주세요 (1–120자)");
      return;
    }
    const blob = prepared,
      description = alt,
      before = generation.current,
      controller = new AbortController();
    abort.current = controller;
    setProgress(0);
    setPrepared(null);
    let uploadedId: string | null = null;
    void execute(
      async () => {
        const created = await createSpacePhotoUpload({
          spaceId,
          size: blob.size,
        });
        if (!created.ok) return created;
        if (!current(before) || controller.signal.aborted)
          throw new DOMException("Aborted", "AbortError");
        await uploadToR2(created.data.url, blob, {
          signal: controller.signal,
          onProgress: (value) => {
            if (current(before)) setProgress(value);
          },
        });
        if (!current(before) || controller.signal.aborted)
          throw new DOMException("Aborted", "AbortError");
        const confirmed = await confirmSpacePhotoUpload({
          spaceId,
          uploadId: created.data.uploadId,
          alt: description,
        });
        if (confirmed.ok) uploadedId = confirmed.data.photoId;
        return confirmed;
      },
      () => {
        if (uploadedId) {
          const next = [
            ...rows,
            {
              id: uploadedId,
              path: `/api/space-photos/${uploadedId}.webp`,
              alt: description,
              sortOrder: rows.length,
            },
          ];
          setOverride({ base, rows: next });
        }
        setAnnouncement("사진을 올렸어요");
        fileInput.current?.focus();
      },
    );
  }
  return (
    <section aria-label="공간 사진" className="space-y-5">
      {!canManage && (
        <p className="text-sm text-muted-foreground">
          읽기 전용이에요. 사진을 고칠 권한이 없어요
        </p>
      )}
      {error && !prepared && !deleting && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <p
        role="status"
        aria-label="사진 순서"
        aria-live="polite"
        className="sr-only"
      >
        {announcement}
      </p>
      <div
        ref={grid}
        tabIndex={-1}
        className="grid gap-4 focus-visible:outline-2 focus-visible:outline-ring sm:grid-cols-2 xl:grid-cols-4"
      >
        {rows.map((photo, index) => (
          <SpacePhotoCard
            key={photo.id}
            photo={photo}
            index={index}
            disabled={disabled}
            dragTarget={dragTarget === photo.id}
            onAlt={(value) => saveAlt(photo, value)}
            onCover={() => move(photo.id, 0)}
            onDelete={() => {
              setError("");
              returnFocus.current = photo.id;
              setDeleting(photo);
            }}
            onKeyDown={(event) => {
              if (
                !event.altKey ||
                !["ArrowLeft", "ArrowRight"].includes(event.key) ||
                event.target instanceof HTMLInputElement
              )
                return;
              event.preventDefault();
              move(photo.id, index + (event.key === "ArrowRight" ? 1 : -1));
            }}
            onPointerDown={(event) => {
              if (disabled || event.button !== 0) return;
              drag.current = {
                id: photo.id,
                pointerId: event.pointerId,
                target: photo.id,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
              setDragTarget(photo.id);
            }}
            onPointerMove={(event) => {
              if (!drag.current || drag.current.pointerId !== event.pointerId)
                return;
              const target = document
                .elementFromPoint(event.clientX, event.clientY)
                ?.closest<HTMLElement>("[data-photo-id]");
              if (
                target &&
                grid.current?.contains(target) &&
                target.dataset.photoId
              ) {
                drag.current.target = target.dataset.photoId;
                setDragTarget(target.dataset.photoId);
              }
            }}
            onPointerUp={(event) => {
              const state = drag.current;
              if (!state || state.pointerId !== event.pointerId) return;
              drag.current = null;
              setDragTarget(null);
              event.currentTarget.releasePointerCapture(event.pointerId);
              move(
                state.id,
                rows.findIndex((p) => p.id === state.target),
              );
            }}
            onPointerCancel={() => {
              drag.current = null;
              setDragTarget(null);
            }}
          />
        ))}
        {progress !== null && (
          <PhotoUploadProgress
            progress={progress}
            onCancel={() => abort.current?.abort()}
          />
        )}
      </div>
      {rows.length === 0 && progress === null && (
        <p className="py-8 text-center text-muted-foreground">
          아직 사진이 없어요
        </p>
      )}
      {!enabled ? (
        <p className="rounded-xl border border-dashed p-6 text-muted-foreground">
          이 환경에서는 파일을 올릴 수 없어요
        </p>
      ) : (
        <div
          className="flex flex-wrap items-center gap-4 rounded-xl border border-dashed bg-card p-5"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            void choose(event.dataTransfer.files[0]);
          }}
        >
          <Upload aria-hidden="true" className="size-6 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">사진을 끌어다 놓거나 고르기</p>
            <p className="mt-1 text-sm text-muted-foreground">
              JPG·PNG·WebP, 장마다 10MB까지, 공간마다 8장. 1200×750 WebP로 바꿔
              저장해요.
            </p>
          </div>
          <Label htmlFor={`${id}-file`} className="sr-only">
            사진 고르기
          </Label>
          <Input
            ref={fileInput}
            id={`${id}-file`}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="max-w-60"
            disabled={disabled || rows.length >= 8}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              void choose(file);
            }}
          />
          {preparing && <p role="status">사진을 바꾸고 있어요</p>}
          {rows.length >= 8 && <p>사진은 공간마다 8장까지예요</p>}
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        끌거나, 사진에 포커스를 두고 Alt+←/→로 순서를 바꿔요. 첫 사진이 대표
        사진이에요. 설명은 화면 읽기 프로그램이 읽어요.
      </p>
      <Dialog
        open={prepared !== null}
        onOpenChange={(open) => {
          if (!open) setPrepared(null);
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (mounted.current && activePath()) fileInput.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>사진 설명</DialogTitle>
            <DialogDescription>
              사진에 무엇이 보이는지 적어 주세요. 화면 읽기 프로그램이 읽어요.
            </DialogDescription>
          </DialogHeader>
          <Label htmlFor={`${id}-alt`}>설명</Label>
          <Input
            id={`${id}-alt`}
            value={alt}
            onChange={(event) => setAlt(event.target.value)}
          />
          {error && prepared && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPrepared(null)}>
              취소
            </Button>
            <Button disabled={disabled} onClick={upload}>
              사진 올리기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setDeleting(null);
        }}
      >
        <DialogContent
          showCloseButton={!pending}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (!mounted.current || !activePath()) return;
            const target =
              returnFocus.current &&
              grid.current?.querySelector<HTMLElement>(
                `[data-photo-id="${returnFocus.current}"]`,
              );
            (target || grid.current)?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>사진을 지울까요?</DialogTitle>
            <DialogDescription>
              멤버 화면에서도 사라져요. 되돌릴 수 없어요.
            </DialogDescription>
          </DialogHeader>
          {error && deleting && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setDeleting(null)}
            >
              취소
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => {
                if (!deleting) return;
                const target = deleting;
                void execute(
                  () => deleteSpacePhoto({ photoId: target.id }),
                  () => {
                    setOverride({
                      base,
                      rows: rows
                        .filter((p) => p.id !== target.id)
                        .map((p, sortOrder) => ({ ...p, sortOrder })),
                    });
                    setDeleting(null);
                  },
                );
              }}
            >
              지우기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
