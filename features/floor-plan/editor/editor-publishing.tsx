"use client";

import { Suspense, use, useCallback, useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  publishFloorPlan,
  restorePlanVersion,
} from "@/features/floor-plan/actions";
import type { ActionResult } from "@/lib/actions/result";
import { isBlockingPlanIssue } from "@/lib/floor-plan/issues";
import { hydrateSeatLabels } from "@/lib/floor-plan/seats";
import type { PlanEditorData } from "../editor-types";
import type { PlanPublishPreview, PlanVersion } from "../publish-types";
import type { PlanAutosave, SavedPlanSnapshot } from "./autosave";
import { useEditorStore, useEditorValue } from "./editor-context";
import { PublishPlanSummary, PlanVersionList } from "./publish-summary";

export type EditorPublishReads = {
  preview?: {
    key: string;
    result: Promise<ActionResult<PlanPublishPreview>>;
  } | null;
  versions?: {
    key: string;
    result: Promise<ActionResult<PlanVersion[]>>;
  } | null;
};
type Request = { key: string; snapshot: SavedPlanSnapshot };
function ReadResult<T>({
  promise,
  onResult,
}: {
  promise: Promise<ActionResult<T>>;
  onResult: (result: ActionResult<T>) => void;
}) {
  const result = use(promise);
  useEffect(() => onResult(result), [result, onResult]);
  return null;
}
function PendingDetails() {
  return (
    <div aria-busy="true" className="space-y-3 py-4">
      <Skeleton className="h-28" />
      <Skeleton className="h-12" />
      <span className="sr-only" role="status">
        게시 정보를 불러오고 있어요
      </span>
    </div>
  );
}
export function EditorPublishing({
  data,
  autosave,
  active,
  reads = {},
  publish = publishFloorPlan,
  restore = restorePlanVersion,
}: {
  data: PlanEditorData;
  autosave: PlanAutosave;
  active: boolean;
  reads?: EditorPublishReads;
  publish?: typeof publishFloorPlan;
  restore?: typeof restorePlanVersion;
}) {
  const store = useEditorStore();
  const draft = useEditorValue((state) => state.draft);
  const changeId = useEditorValue((state) => state.changeId);
  const epoch = useEditorValue((state) => state.epoch);
  const basePlanId = useEditorValue((state) => state.basePlanId);
  const dirty = useEditorValue((state) => state.changeId !== state.ackChangeId);
  const disabled = useEditorValue(
    (state) => state.saveState === "stale" || state.writeLocked,
  );
  const [mode, setMode] = useState<"publish" | "versions" | null>(null);
  const [request, setRequest] = useState<Request | null>(null);
  const requestRef = useRef<Request | null>(null);
  const [preview, setPreview] = useState<PlanPublishPreview | null>(null);
  const [versions, setVersions] = useState<PlanVersion[] | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<PlanVersion | null>(
    null,
  );
  const [error, setError] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [publishedInfo, setPublishedInfo] = useState<{
    planId: string;
    version: number;
  } | null>(data.published);
  const publishedVersion =
    data.published?.planId === basePlanId
      ? data.published.version
      : publishedInfo?.planId === basePlanId
        ? publishedInfo.version
        : null;
  const alive = useRef(false);
  const attempt = useRef(0);
  const running = useRef(false);
  const publishButton = useRef<HTMLButtonElement>(null);
  const versionsButton = useRef<HTMLButtonElement>(null);
  const lastMode = useRef<"publish" | "versions">("publish");
  const router = useRouter();
  const search = useSearchParams();
  const path = `/admin/branches/${data.branch.id}/floors/${data.floor.id}/plan`;
  const publishMutation = useMutation({
    scope: { id: `plan-editor-publish-${data.floor.id}` },
    retry: false,
    mutationFn: (input: Parameters<typeof publishFloorPlan>[0]) =>
      publish(input),
  });
  const restoreMutation = useMutation({
    scope: { id: `plan-editor-publish-${data.floor.id}` },
    retry: false,
    mutationFn: (input: Parameters<typeof restorePlanVersion>[0]) =>
      restore(input),
  });
  const cancelPending = useCallback(() => {
    attempt.current++;
    requestRef.current = null;
    setRequest(null);
    setMode(null);
    setPreparing(false);
  }, []);
  useEffect(() => {
    alive.current = active;
    return () => {
      alive.current = false;
      cancelPending();
    };
  }, [active, cancelPending]);
  const sameSnapshot = (snapshot: SavedPlanSnapshot) => {
    const current = store.getState();
    return (
      current.epoch === snapshot.epoch &&
      current.changeId === snapshot.changeId &&
      current.draft?.planId === snapshot.draft?.planId &&
      current.draft?.revision === snapshot.draft?.revision
    );
  };
  const close = () => {
    if (running.current) return;
    cancelPending();
  };
  const fail = useCallback(
    (result: Exclude<ActionResult<unknown>, { ok: true }>) => {
      if (result.code === "STALE") {
        store.setState({ saveState: "stale", saveError: "STALE" });
        setMode(null);
      } else
        setError(
          result.code === "FORBIDDEN"
            ? "평면도를 편집할 권한이 없어요"
            : "정보를 확인하지 못했어요. 다시 시도해 주세요",
        );
    },
    [store],
  );
  const receivePreview = useCallback(
    (result: ActionResult<PlanPublishPreview>) => {
      const pending = requestRef.current;
      if (!alive.current || !pending || pending.key !== reads.preview?.key)
        return;
      const current = store.getState();
      if (
        current.epoch !== pending.snapshot.epoch ||
        current.changeId !== pending.snapshot.changeId
      )
        return;
      if (!result.ok) fail(result);
      else if (
        result.data.draft.planId === pending.snapshot.draft?.planId &&
        result.data.draft.revision === pending.snapshot.draft?.revision
      )
        setPreview(result.data);
    },
    [reads.preview?.key, store, fail],
  );
  const receiveVersions = useCallback(
    (result: ActionResult<PlanVersion[]>) => {
      const pending = requestRef.current;
      if (
        !alive.current ||
        !pending ||
        pending.key !== reads.versions?.key ||
        pending.snapshot.epoch !== store.getState().epoch
      )
        return;
      if (!result.ok) fail(result);
      else setVersions(result.data);
    },
    [reads.versions?.key, store, fail],
  );
  async function open(next: "publish" | "versions") {
    if (!alive.current || running.current || disabled) return;
    const id = ++attempt.current;
    lastMode.current = next;
    setMode(next);
    setPreparing(true);
    setError("");
    setPreview(null);
    setVersions(null);
    setSelectedVersion(null);
    requestRef.current = null;
    setRequest(null);
    const saved = await autosave.flush();
    if (!alive.current || id !== attempt.current) return;
    setPreparing(false);
    if (!saved.ok) {
      setError("초안을 저장한 뒤 다시 시도해 주세요");
      return;
    }
    if (next === "publish" && !saved.snapshot.draft) {
      setError("변경한 초안이 없어요");
      return;
    }
    const pending = { key: crypto.randomUUID(), snapshot: saved.snapshot };
    requestRef.current = pending;
    setRequest(pending);
    const params = new URLSearchParams(search.toString());
    for (const key of ["preview", "draft", "revision", "versions"])
      params.delete(key);
    if (next === "publish") {
      params.set("preview", pending.key);
      params.set("draft", saved.snapshot.draft!.planId);
      params.set("revision", String(saved.snapshot.draft!.revision));
    } else params.set("versions", pending.key);
    router.replace(`${path}?${params}`, { scroll: false });
  }
  function refreshCurrent() {
    if (!alive.current) return;
    const params = new URLSearchParams(search.toString());
    for (const key of ["preview", "draft", "revision", "versions"])
      params.delete(key);
    router.replace(`${path}${params.size ? `?${params}` : ""}`, {
      scroll: false,
    });
  }
  async function commitPublish() {
    const pending = requestRef.current;
    if (
      !alive.current ||
      running.current ||
      !preview ||
      !pending ||
      !sameSnapshot(pending.snapshot) ||
      preview.issues.some(isBlockingPlanIssue)
    )
      return;
    running.current = true;
    store.getState().setWriteLocked(true);
    const sent = pending.snapshot;
    try {
      const result = await publishMutation.mutateAsync({
        floorId: data.floor.id,
        expectedDraftId: sent.draft!.planId,
        revision: sent.draft!.revision,
      });
      if (!sameSnapshot(sent)) return;
      if (!result.ok) {
        if (result.code === "PLAN_INVALID" && result.issues) {
          setPreview({ ...preview, issues: result.issues });
          setError(
            "최신 예약과 설정을 확인했어요. 표시된 문제를 해결한 뒤 다시 확인해 주세요",
          );
        } else fail(result);
        return;
      }
      const camera = store.getState().camera;
      store.getState().replaceSource({
        floorId: data.floor.id,
        basePlanId: result.data.planId,
        document: sent.document,
        draft: null,
        savedAt: null,
      });
      store.getState().setCamera(camera);
      setPublishedInfo({
        planId: result.data.planId,
        version: result.data.version,
      });
      requestRef.current = null;
      setRequest(null);
      setMode(null);
      if (alive.current) {
        toast.success(`버전 ${result.data.version}를 게시했어요`);
        refreshCurrent();
      }
    } catch {
      if (sameSnapshot(sent)) setError("게시하지 못했어요. 다시 시도해 주세요");
    } finally {
      running.current = false;
      if (store.getState().epoch === sent.epoch)
        store.getState().setWriteLocked(false);
    }
  }
  async function commitRestore() {
    if (!alive.current || running.current || !selectedVersion) return;
    running.current = true;
    store.getState().setWriteLocked(true);
    const generation = attempt.current;
    const initialEpoch = store.getState().epoch;
    try {
      const saved = await autosave.flush();
      if (!alive.current || generation !== attempt.current || !saved.ok) {
        if (alive.current) setError("초안을 저장한 뒤 다시 시도해 주세요");
        return;
      }
      const sent = saved.snapshot;
      const result = await restoreMutation.mutateAsync({
        floorId: data.floor.id,
        version: selectedVersion.version,
        expectedDraftId: sent.draft?.planId ?? null,
        revision: sent.draft?.revision ?? null,
        basePlanId: store.getState().basePlanId,
      });
      if (!sameSnapshot(sent)) return;
      if (!result.ok) {
        fail(result);
        return;
      }
      store.getState().replaceSource({
        ...result.data,
        document: hydrateSeatLabels(result.data.document, data.spaces),
      });
      requestRef.current = null;
      setRequest(null);
      setMode(null);
      if (alive.current) {
        toast.success(`버전 ${selectedVersion.version}으로 초안을 만들었어요`);
        refreshCurrent();
      }
    } catch {
      if (initialEpoch === store.getState().epoch)
        setError("초안으로 가져오지 못했어요. 다시 시도해 주세요");
    } finally {
      running.current = false;
      if (initialEpoch === store.getState().epoch)
        store.getState().setWriteLocked(false);
    }
  }
  const validPreview = Boolean(
    request &&
    epoch === request.snapshot.epoch &&
    changeId === request.snapshot.changeId &&
    draft?.planId === request.snapshot.draft?.planId &&
    draft?.revision === request.snapshot.draft?.revision,
  );
  const busy = publishMutation.isPending || restoreMutation.isPending;
  return (
    <>
      <Button
        ref={versionsButton}
        variant="outline"
        disabled={disabled}
        onClick={() => void open("versions")}
        aria-label="평면도 버전 목록"
      >
        {draft
          ? `초안 · 버전 ${draft.version}`
          : publishedVersion
            ? `게시됨 · 버전 ${publishedVersion}`
            : "버전 목록"}
      </Button>
      <Button
        ref={publishButton}
        disabled={disabled || (!draft && !dirty)}
        onClick={() => void open("publish")}
      >
        게시
      </Button>
      {active &&
        request &&
        mode === "publish" &&
        reads.preview?.key === request.key && (
          <Suspense fallback={null}>
            <ReadResult
              promise={reads.preview.result}
              onResult={receivePreview}
            />
          </Suspense>
        )}
      {active &&
        request &&
        mode === "versions" &&
        reads.versions?.key === request.key && (
          <Suspense fallback={null}>
            <ReadResult
              promise={reads.versions.result}
              onResult={receiveVersions}
            />
          </Suspense>
        )}
      <Dialog
        open={active && mode !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent
          className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl"
          onEscapeKeyDown={(event) => {
            if (running.current) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (running.current) event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target =
              lastMode.current === "publish"
                ? publishButton.current
                : versionsButton.current;
            if (alive.current && target && !target.closest("[hidden],[inert]"))
              target.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {mode === "versions" ? "평면도 버전" : "평면도 게시"}
            </DialogTitle>
            <DialogDescription>
              {mode === "versions"
                ? "지난 버전을 초안으로 가져온 뒤 다시 검사하고 게시해요."
                : "게시하면 멤버가 새 평면도와 좌석을 볼 수 있어요. 현재 예약도 다시 확인해요."}
            </DialogDescription>
          </DialogHeader>
          {mode === "publish" && (
            <>
              {preparing ||
              (!preview && !error && (!request || validPreview)) ? (
                <PendingDetails />
              ) : (
                preview && (
                  <PublishPlanSummary
                    data={preview}
                    branchId={data.branch.id}
                  />
                )
              )}
              {request && !validPreview && (
                <p role="status">
                  문서가 바뀌었어요. 게시 전에 다시 확인해 주세요
                </p>
              )}
            </>
          )}
          {mode === "versions" && (
            <>
              {versions ? (
                <PlanVersionList
                  versions={versions}
                  timezone={data.branch.timezone}
                  disabled={busy}
                  onSelect={setSelectedVersion}
                />
              ) : (
                !error && <PendingDetails />
              )}
              {selectedVersion && (
                <section className="space-y-3 rounded-xl border p-4">
                  <h3 className="font-bold">
                    버전 {selectedVersion.version}으로 초안을 만들까요?
                  </h3>
                  <p className="text-sm">
                    지금 초안과 실행 취소 이력을 바꿔요. 게시본은 바뀌지 않아요.
                  </p>
                  <Button disabled={busy} onClick={() => void commitRestore()}>
                    {busy ? "가져오고 있어요" : "확인하고 초안 만들기"}
                  </Button>
                </section>
              )}
            </>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={close}>
              닫기
            </Button>
            {mode === "publish" && (
              <>
                <Button
                  variant="outline"
                  disabled={busy || preparing}
                  onClick={() => void open("publish")}
                >
                  다시 확인
                </Button>
                <Button
                  disabled={
                    busy ||
                    preparing ||
                    !preview ||
                    !validPreview ||
                    preview.issues.some(isBlockingPlanIssue)
                  }
                  onClick={() => void commitPublish()}
                >
                  {busy ? "게시하고 있어요" : "확인하고 게시"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
