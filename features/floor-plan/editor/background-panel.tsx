"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ImagePlus, Lock, RotateCw, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  confirmPlanBackgroundUpload,
  createPlanBackgroundUpload,
} from "@/features/floor-plan/actions";
import type { ConfirmPlanBackgroundUploadResult } from "@/features/floor-plan/background-schema";
import { toWebp, WebpConversionError } from "@/features/uploads/to-webp";
import { uploadToR2 } from "@/features/uploads/upload-to-r2";
import type { Point } from "@/lib/floor-plan/render/types";
import type { PlanAutosave } from "./autosave";
import {
  rotateBackgroundCommand,
  scaleBackgroundCommand,
  setBackgroundCommand,
  setBackgroundOpacityCommand,
} from "./background-commands";
import { useEditorStore, useEditorValue } from "./editor-context";
import { NumberField } from "./editor-number-field";

export type BackgroundPanelProps = {
  enabled: boolean;
  active: boolean;
  autosave: PlanAutosave;
  locked: boolean;
  onLockedChange(locked: boolean): void;
  scalePoints: readonly Point[];
  onScaleStart(): void;
  onScaleEnd(): void;
  onUploaded(result: ConfirmPlanBackgroundUploadResult): void;
  imageSize: { width: number; height: number } | null;
  createUpload?: typeof createPlanBackgroundUpload;
  confirmUpload?: typeof confirmPlanBackgroundUpload;
  convert?: typeof toWebp;
  upload?: typeof uploadToR2;
};
type Operation = {
  epoch: number;
  path: string;
  controller: AbortController;
  ownsLock: boolean;
  draftId: string | null;
};
type Phase = "converting" | "saving" | "uploading" | "confirming";
const failureMessage = "이미지를 올리지 못했어요. 다시 시도해 주세요";

export function BackgroundPanel({
  enabled,
  active,
  autosave,
  locked,
  onLockedChange,
  scalePoints,
  onScaleStart,
  onScaleEnd,
  onUploaded,
  imageSize,
  createUpload = createPlanBackgroundUpload,
  confirmUpload = confirmPlanBackgroundUpload,
  convert = toWebp,
  upload = uploadToR2,
}: BackgroundPanelProps) {
  const store = useEditorStore();
  const background = useEditorValue((state) => state.document.background);
  const disabled = useEditorValue(
    (state) => state.writeLocked || state.saveState === "stale",
  );
  const [phase, setPhase] = useState<Phase | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [distance, setDistance] = useState(1000);
  const [opacity, setOpacity] = useState<{
    source: typeof background;
    value: number;
  } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const alive = useRef(false);
  const operation = useRef<Operation | null>(null);
  const createMutation = useMutation({
    mutationFn: (value: Parameters<typeof createUpload>[0]) =>
      createUpload(value),
    retry: false,
  });
  const confirmMutation = useMutation({
    mutationFn: (value: Parameters<typeof confirmUpload>[0]) =>
      confirmUpload(value),
    retry: false,
  });
  const release = useCallback(
    (value: Operation) => {
      if (operation.current !== value) return;
      operation.current = null;
      value.controller.abort();
      if (value.ownsLock && store.getState().epoch === value.epoch)
        store.getState().setWriteLocked(false);
    },
    [store],
  );
  const cancel = useCallback(() => {
    if (operation.current) release(operation.current);
    setPhase(null);
  }, [release]);
  useLayoutEffect(() => {
    alive.current = active && enabled;
    const unsubscribe = store.subscribe((state) => {
      const current = operation.current;
      if (
        current &&
        (state.epoch !== current.epoch ||
          (current.draftId !== null && state.draft?.planId !== current.draftId))
      )
        cancel();
    });
    const leave = () => cancel();
    window.addEventListener("pagehide", leave);
    window.addEventListener("popstate", leave);
    return () => {
      alive.current = false;
      unsubscribe();
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("popstate", leave);
      cancel();
    };
  }, [active, enabled, store, cancel]);

  function current(value: Operation) {
    const state = store.getState();
    return (
      alive.current &&
      operation.current === value &&
      !value.controller.signal.aborted &&
      state.epoch === value.epoch &&
      window.location.pathname === value.path &&
      (value.draftId === null || state.draft?.planId === value.draftId)
    );
  }
  function mayEdit() {
    const state = store.getState();
    return (
      active &&
      !operation.current &&
      !state.writeLocked &&
      state.saveState !== "stale" &&
      state.document.background === background
    );
  }
  async function choose(file: File) {
    const initial = store.getState();
    if (
      !alive.current ||
      operation.current ||
      initial.writeLocked ||
      initial.saveState === "stale"
    )
      return;
    const value: Operation = {
      epoch: initial.epoch,
      path: window.location.pathname,
      controller: new AbortController(),
      ownsLock: true,
      draftId: initial.draft?.planId ?? null,
    };
    operation.current = value;
    initial.setWriteLocked(true);
    setError("");
    setProgress(0);
    setPhase("converting");
    try {
      const converted = await convert(file, {
        maxLongSide: 4096,
        maxBytes: 3 * 1024 * 1024,
        signal: value.controller.signal,
      });
      if (!current(value)) return;
      const state = store.getState();
      if (state.saveState === "stale") return;
      setPhase("saving");
      const saved = await autosave.flush({ createDraft: true });
      if (!current(value)) return;
      if (!saved.ok || !saved.snapshot.draft) {
        setError("초안을 저장한 뒤 다시 시도해 주세요");
        return;
      }
      const latest = store.getState();
      if (
        saved.snapshot.epoch !== value.epoch ||
        saved.snapshot.changeId !== latest.changeId ||
        saved.snapshot.draft.planId !== latest.draft?.planId
      )
        return;
      value.draftId = saved.snapshot.draft.planId;
      const created = await createMutation.mutateAsync({
        floorId: latest.floorId,
        expectedDraftId: value.draftId,
        size: converted.blob.size,
      });
      if (!current(value)) return;
      if (!created.ok) {
        if (created.code === "STALE")
          store.setState({ saveState: "stale", saveError: "STALE" });
        setError(
          created.code === "FORBIDDEN"
            ? "배경 이미지를 올릴 권한이 없어요"
            : failureMessage,
        );
        return;
      }
      if (created.data.planId !== value.draftId) {
        setError(failureMessage);
        return;
      }
      setPhase("uploading");
      await upload(created.data.url, converted.blob, {
        signal: value.controller.signal,
        onProgress: (percent) => {
          if (current(value))
            setProgress(Math.max(0, Math.min(100, Math.round(percent))));
        },
      });
      if (!current(value)) return;
      setPhase("confirming");
      const confirmed = await confirmMutation.mutateAsync({
        floorId: latest.floorId,
        uploadId: created.data.uploadId,
      });
      if (!current(value)) return;
      if (!confirmed.ok) {
        if (confirmed.code === "STALE")
          store.setState({ saveState: "stale", saveError: "STALE" });
        setError(failureMessage);
        return;
      }
      if (
        confirmed.data.planId !== value.draftId ||
        confirmed.data.uploadId !== created.data.uploadId
      ) {
        setError(failureMessage);
        return;
      }
      release(value);
      store.getState().execute(
        setBackgroundCommand(store.getState().document, {
          transform: [10, 0, 0, 10, 0, 0],
          opacity: 0.35,
        }),
      );
      onScaleEnd();
      onUploaded(confirmed.data);
    } catch (cause) {
      if (current(value))
        setError(
          cause instanceof WebpConversionError
            ? cause.code === "invalid_input"
              ? "10MB 이하의 JPG, PNG, WebP 이미지를 골라 주세요."
              : cause.code === "too_large"
                ? "이미지가 너무 복잡해요. 다른 이미지를 골라 주세요."
                : "이 브라우저에서는 이미지를 올릴 수 없어요."
            : failureMessage,
        );
    } finally {
      if (operation.current === value) {
        release(value);
        if (alive.current) setPhase(null);
      } else if (alive.current && !operation.current) setPhase(null);
    }
  }
  const controlsDisabled = disabled || !active || phase !== null;
  const opacityValue =
    opacity && opacity.source === background
      ? opacity.value
      : Math.round((background?.opacity ?? 0.35) * 100);
  function commitOpacity(value: number) {
    if (mayEdit())
      store
        .getState()
        .execute(
          setBackgroundOpacityCommand(store.getState().document, value / 100),
        );
    setOpacity(null);
  }
  function rotate() {
    if (!mayEdit() || !imageSize || !background || locked) return;
    const [a, b, c, d, e, f] = background.transform;
    const x = imageSize.width / 2,
      y = imageSize.height / 2;
    store
      .getState()
      .execute(
        rotateBackgroundCommand(store.getState().document, [
          a * x + c * y + e,
          b * x + d * y + f,
        ]),
      );
    onScaleEnd();
  }
  return (
    <section className="space-y-5 p-5" aria-label="배경 도면과 축척">
      <div className="space-y-2">
        <h2 className="font-semibold">배경 도면과 축척</h2>
        <p className="text-sm text-muted-foreground">
          도면 이미지를 깔고 길이를 아는 두 점으로 축척을 맞춰요. 배경은
          편집기에서만 보여요.
        </p>
      </div>
      <Input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        aria-label="배경 이미지 파일"
        className="hidden"
        tabIndex={-1}
        disabled={!enabled || controlsDisabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void choose(file);
        }}
      />
      {enabled ? (
        <Button
          variant="outline"
          className="w-full"
          disabled={controlsDisabled}
          onClick={() => input.current?.click()}
        >
          <ImagePlus aria-hidden="true" />
          {background ? "배경 이미지 바꾸기" : "배경 이미지 올리기"}
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">
          이 환경에서는 파일을 올릴 수 없어요
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        JPG, PNG, WebP · 10MB 이하
      </p>
      {phase && (
        <div className="space-y-2" aria-live="polite">
          <p role="status" className="text-sm tabular-nums">
            {phase === "converting"
              ? "이미지를 준비하고 있어요"
              : phase === "saving"
                ? "초안을 저장하고 있어요"
                : phase === "confirming"
                  ? "이미지를 확인하고 있어요"
                  : `이미지를 올리고 있어요 ${progress}%`}
          </p>
          {phase === "uploading" && (
            <progress
              aria-label="이미지 업로드 진행률"
              value={progress}
              max={100}
              className="w-full"
            />
          )}
          <Button variant="outline" onClick={cancel}>
            올리기 취소
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {background && (
        <>
          {imageSize && (
            <p className="text-sm text-muted-foreground tabular-nums">
              {imageSize.width} × {imageSize.height}px
            </p>
          )}
          <div className="space-y-3 border-t pt-4">
            <Button
              variant="outline"
              className="w-full"
              disabled={controlsDisabled || locked}
              onClick={() => {
                if (mayEdit()) onScaleStart();
              }}
            >
              축척 기준 두 점 찍기
            </Button>
            <p className="text-xs text-muted-foreground">
              {scalePoints.length >= 2
                ? "두 점을 골랐어요. 실제 거리를 입력해 주세요."
                : scalePoints.length === 1
                  ? "두 번째 점을 골라 주세요."
                  : "배경에서 길이를 아는 두 점을 골라 주세요."}
            </p>
            <NumberField
              label="두 점 사이 실제 거리 (mm)"
              value={distance}
              min={1}
              disabled={controlsDisabled || locked}
              onCommit={setDistance}
            />
            <Button
              className="w-full"
              disabled={
                controlsDisabled ||
                locked ||
                scalePoints.length !== 2 ||
                distance <= 0
              }
              onClick={() => {
                if (!mayEdit() || locked || !scalePoints[0] || !scalePoints[1])
                  return;
                const length = Math.hypot(
                  scalePoints[1][0] - scalePoints[0][0],
                  scalePoints[1][1] - scalePoints[0][1],
                );
                if (!Number.isFinite(length) || length <= 0 || distance <= 0) {
                  setError("서로 다른 두 점과 올바른 거리를 입력해 주세요");
                  return;
                }
                const command = scaleBackgroundCommand(
                  store.getState().document,
                  scalePoints[0],
                  scalePoints[1],
                  distance,
                );
                store.getState().execute(command);
                setError("");
                onScaleEnd();
              }}
            >
              축척 적용
            </Button>
          </div>
          <label className="block space-y-1 text-sm">
            투명도 <span className="tabular-nums">{opacityValue}%</span>
            <input
              aria-label="배경 투명도"
              type="range"
              min={0}
              max={100}
              step={1}
              value={opacityValue}
              disabled={controlsDisabled}
              className="h-11 w-full accent-primary"
              onChange={(event) =>
                setOpacity({
                  source: background,
                  value: Number(event.target.value),
                })
              }
              onPointerUp={(event) =>
                commitOpacity(Number(event.currentTarget.value))
              }
              onKeyUp={(event) => {
                if (
                  [
                    "ArrowLeft",
                    "ArrowRight",
                    "ArrowUp",
                    "ArrowDown",
                    "Home",
                    "End",
                    "PageUp",
                    "PageDown",
                  ].includes(event.key)
                )
                  commitOpacity(Number(event.currentTarget.value));
              }}
              onBlur={(event) =>
                commitOpacity(Number(event.currentTarget.value))
              }
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={controlsDisabled || locked || !imageSize}
              onClick={rotate}
            >
              <RotateCw aria-hidden="true" />
              90° 회전
            </Button>
            <Button
              variant="outline"
              aria-pressed={locked}
              disabled={controlsDisabled}
              onClick={() => {
                if (mayEdit()) {
                  onLockedChange(!locked);
                  onScaleEnd();
                }
              }}
            >
              {locked ? (
                <Unlock aria-hidden="true" />
              ) : (
                <Lock aria-hidden="true" />
              )}
              {locked ? "잠금 해제" : "배경 잠금"}
            </Button>
            <Button
              variant="ghost"
              disabled={controlsDisabled}
              onClick={() => {
                if (mayEdit()) {
                  store
                    .getState()
                    .execute(
                      setBackgroundCommand(store.getState().document, null),
                    );
                  onScaleEnd();
                }
              }}
            >
              배경 지우기
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
