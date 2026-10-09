"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useIsMutating, useMutation } from "@tanstack/react-query";
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
import {
  createMaintenance,
  updateMaintenance,
  endMaintenance,
  deleteMaintenance,
} from "@/features/admin/maintenance-actions";
import {
  createMaintenanceSchema,
  updateMaintenanceSchema,
  validateMaintenanceWindow,
} from "../maintenance-schema";
import type { MaintenanceListData, MaintenanceRow } from "../maintenance-types";
import {
  maintenanceCloseHref,
  maintenanceDraftWindow,
  maintenanceInitialDraft,
  maintenancePath,
  maintenancePreviewHref,
  maintenancePreviewKey,
  type MaintenanceDraft,
  type MaintenanceDialogKind,
  type MaintenanceRequest,
} from "../maintenance-navigation";
import { ActionError } from "@/lib/actions/result";
import { adminErrorMessage } from "./use-admin-mutation";
import { MaintenanceFields } from "./maintenance-fields";
import {
  MaintenancePreviewContext,
  MaintenancePreviewSkeleton,
  type MaintenancePreviewResult,
} from "./maintenance-preview";

export const staleMaintenanceMessage =
  "그사이 예약이 바뀌었어요. 다시 확인해 주세요";
type Approval = { key: string; result: MaintenancePreviewResult };
export function MaintenanceDialog({
  data,
  kind,
  row,
  initialRequest,
  children,
}: {
  data: MaintenanceListData;
  kind: MaintenanceDialogKind;
  row?: MaintenanceRow;
  initialRequest?: MaintenanceRequest | null;
  children?: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState(() =>
    maintenanceInitialDraft(
      data.now,
      data.branch.timezone,
      row && { spaceId: row.space.id, ...row },
      initialRequest,
    ),
  );
  const [request, setRequest] = useState(initialRequest ?? null);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const mounted = useRef(true);
  const closed = useRef(false);
  const submitting = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const editing = kind === "edit";
  const editor = kind === "create" || editing;
  const input = useMemo(
    () =>
      maintenanceDraftWindow(
        {
          spaceId: draft.spaceId,
          startKind: draft.startKind,
          startAt: draft.startAt,
          end: draft.end,
        },
        data.branch.timezone,
      ),
    [
      draft.spaceId,
      draft.startKind,
      draft.startAt,
      draft.end,
      data.branch.timezone,
    ],
  );
  const inputKey = input ? maintenancePreviewKey(input) : null;
  const requestKey =
    request && request.inputKey === inputKey
      ? `${request.inputKey}:${request.nonce}`
      : null;
  const pending = useIsMutating({ mutationKey: ["admin-actions"] }) > 0;
  const ownsLocation = useCallback(() => {
    const search = new URLSearchParams(window.location.search);
    return (
      window.location.pathname === maintenancePath(data.branch.id) &&
      (search.get("dialog") === kind ||
        (kind === "create" && search.get("create") === "1")) &&
      (kind === "create" || search.get("block") === row?.id)
    );
  }, [data.branch.id, kind, row?.id]);
  const isCurrent = useCallback(
    () => mounted.current && !closed.current && ownsLocation(),
    [ownsLocation],
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const close = useCallback(() => {
    if (closed.current || !mounted.current) return;
    const current = isCurrent();
    closed.current = true;
    setOpen(false);
    if (current)
      router.replace(
        maintenanceCloseHref(
          data.branch.id,
          new URLSearchParams(window.location.search),
        ),
        { scroll: false },
      );
  }, [data.branch.id, isCurrent, router]);
  const requestPreview = useCallback(
    (next: NonNullable<typeof input>) => {
      if (!isCurrent()) return;
      const value = {
        input: next,
        inputKey: maintenancePreviewKey(next),
        nonce: crypto.randomUUID(),
      };
      setApproval(null);
      setRequest(value);
      router.replace(
        maintenancePreviewHref(
          data.branch.id,
          new URLSearchParams(window.location.search),
          value,
        ),
        { scroll: false },
      );
    },
    [data.branch.id, isCurrent, router],
  );
  useEffect(() => {
    if (!editor || !inputKey || request?.inputKey === inputKey) return;
    const timer = setTimeout(() => {
      if (input) requestPreview(input);
    }, 300);
    return () => clearTimeout(timer);
  }, [editor, input, inputKey, request?.inputKey, requestPreview]);
  const accept = useCallback(
    (key: string, result: MaintenancePreviewResult) => {
      if (!isCurrent() || requestKey !== key) return;
      setApproval((previous) =>
        previous?.key === key && previous.result === result
          ? previous
          : { key, result },
      );
    },
    [isCurrent, requestKey],
  );
  const approved =
    approval?.key === requestKey && approval.result.ok
      ? approval.result.data
      : null;
  const mutation = useMutation({
    mutationKey: ["admin-actions"],
    scope: { id: "admin-actions" },
    retry: false,
    mutationFn: (value: unknown) =>
      kind === "create"
        ? createMaintenance(value)
        : kind === "edit"
          ? updateMaintenance(value)
          : kind === "end"
            ? endMaintenance(value)
            : deleteMaintenance(value),
  });
  function change(change: Partial<MaintenanceDraft>) {
    setDraft((previous) => ({ ...previous, ...change }));
    setErrors({});
    if (Object.keys(change).some((key) => key !== "reason")) {
      setApproval(null);
      setRequest(null);
    }
  }
  async function submit() {
    if (submitting.current || pending || !isCurrent()) return;
    if (editor && (!input || !approved)) return;
    setErrors({});
    setMessage("");
    let value: unknown = { blockId: row?.id };
    if (editor && input && approved) {
      value = {
        ...(editing
          ? { blockId: row?.id, start: input.start, end: input.end }
          : input),
        reason: draft.reason,
        expectedBookingIds: approved.bookings.map((booking) => booking.id),
      };
      const parsed = (
        editing ? updateMaintenanceSchema : createMaintenanceSchema
      ).safeParse(value);
      if (!parsed.success) {
        setErrors(
          Object.fromEntries(
            parsed.error.issues.map((issue) => [
              String(issue.path[0] ?? "form"),
              issue.message,
            ]),
          ),
        );
        setMessage("입력한 내용을 확인해 주세요");
        return;
      }
      try {
        validateMaintenanceWindow({
          ...input,
          now: new Date(data.now),
          timeZone: data.branch.timezone,
        });
      } catch (error) {
        if (!(error instanceof ActionError)) throw error;
        setErrors(
          Object.fromEntries(
            Object.entries(error.details.fieldErrors ?? {}).map(
              ([key, values]) => [
                key,
                values[0] ?? "입력한 내용을 확인해 주세요",
              ],
            ),
          ),
        );
        setMessage("입력한 내용을 확인해 주세요");
        return;
      }
    }
    submitting.current = true;
    try {
      const result = await mutation.mutateAsync(value);
      if (!isCurrent()) return;
      if (!result.ok) {
        if (result.code === "STALE" && input) {
          setMessage(staleMaintenanceMessage);
          requestPreview(input);
        } else {
          const text =
            result.message === "maintenance_state"
              ? "점검 상태가 바뀌었어요. 새로고침한 뒤 다시 확인해 주세요"
              : adminErrorMessage(result.code);
          setMessage(text);
          setErrors(
            Object.fromEntries(
              Object.entries(result.fieldErrors ?? {}).map(([key, values]) => [
                key,
                values[0] ?? text,
              ]),
            ),
          );
        }
        return;
      }
      const count =
        "cancelledCount" in result.data ? result.data.cancelledCount : 0;
      toast.success(
        `${kind === "create" ? "점검을 등록했어요" : kind === "edit" ? "점검을 고쳤어요" : kind === "end" ? "점검을 해제했어요" : "점검을 지웠어요"}${count ? `. 예약 ${count}건을 취소하고 알렸어요` : ""}`,
      );
      close();
      router.refresh();
    } catch {
      if (isCurrent()) setMessage(adminErrorMessage("INTERNAL"));
    } finally {
      submitting.current = false;
    }
  }
  const title =
    kind === "create"
      ? "점검 등록"
      : kind === "edit"
        ? "점검 고치기"
        : kind === "end"
          ? "지금 해제할까요?"
          : "점검을 지울까요?";
  const label =
    kind === "create"
      ? "점검 등록"
      : kind === "edit"
        ? "점검 저장"
        : kind === "end"
          ? "해제"
          : "지우기";
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"
        onOpenAutoFocus={() => {
          returnFocus.current =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const current = new URLSearchParams(window.location.search);
          if (
            window.location.pathname !== maintenancePath(data.branch.id) ||
            (current.has("dialog") && !ownsLocation())
          )
            return;
          const selector = row
            ? `[data-maintenance-trigger="${CSS.escape(row.id)}"] ${kind === "delete" ? "button" : "a"}`
            : "[data-maintenance-create]";
          const target = Array.from(
            document.querySelectorAll<HTMLElement>(selector),
          ).find((candidate) => candidate.getClientRects().length > 0);
          if (target) target.focus();
          else if (returnFocus.current?.isConnected)
            returnFocus.current.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {editor
              ? `${data.branch.name}의 현지 시각으로 정해요. 취소된 예약은 되살아나지 않아요.`
              : `${row?.space.floorName} · ${row?.space.name}`}
          </DialogDescription>
        </DialogHeader>
        <form
          className="min-w-0 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {editor ? (
            <>
              <MaintenanceFields
                draft={draft}
                spaces={data.spaces}
                editing={editing}
                pending={pending}
                errors={errors}
                onChange={change}
              />
              <MaintenancePreviewContext value={{ key: requestKey, accept }}>
                {!inputKey ? (
                  <p className="text-sm text-muted-foreground">
                    공간과 30분 단위의 시작·끝을 고르면 겹치는 예약을 확인해요
                  </p>
                ) : !approval || approval.key !== requestKey ? (
                  <MaintenancePreviewSkeleton />
                ) : null}
                {children}
              </MaintenancePreviewContext>
              <p className="text-xs leading-relaxed text-muted-foreground">
                예약자와 참석자에게 점검 이유를 알리고, 회의 채널에 기록을
                남겨요.
              </p>
            </>
          ) : (
            <p className="text-sm leading-relaxed">
              {kind === "end"
                ? "점검으로 취소된 예약은 되살아나지 않아요. 다음 30분 칸부터 예약할 수 있어요"
                : "예정된 점검을 지워요. 점검으로 취소된 예약은 되살아나지 않아요"}
            </p>
          )}
          {message && (
            <p role="alert" className="text-sm text-destructive">
              {message}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              닫기
            </Button>
            <Button type="submit" disabled={pending || (editor && !approved)}>
              {pending
                ? "처리하는 중…"
                : `${label}${editor && approved?.bookings.length ? ` · 예약 ${approved.bookings.length}건 취소` : ""}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
