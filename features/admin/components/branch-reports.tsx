"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useLayoutEffect,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  useIsMutating,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
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
import { resolveReports } from "@/features/admin/report-actions";
import { errorMessage } from "@/lib/errors/messages";
import { notifySessionExpired } from "@/lib/errors/session-expired";
import { isRequestCanceled } from "@/lib/http/errors";
import type { BranchReportGroup, BranchReportsData } from "../reports-types";
import {
  reportsHref,
  reportsPath,
  type ReportResolution,
  type ReportTab,
} from "../report-navigation";
import { adminErrorMessage } from "./use-admin-mutation";
import { ReportCard, reportGroupKey } from "./report-card";
import { ReportCardsSkeleton } from "./reports-frame";

export function BranchReports({ data }: { data: BranchReportsData }) {
  const router = useRouter();
  const client = useQueryClient();
  const [navigating, startTransition] = useTransition();
  const [selected, setSelected] = useOptimistic<ReportTab>(data.tab);
  const [finished, setFinished] = useState<Set<string>>(() => new Set());
  const [confirmation, setConfirmation] = useState<{
    row: BranchReportGroup;
    resolution: Exclude<ReportResolution, "dismissed">;
  } | null>(null);
  const [error, setError] = useState("");
  const mounted = useRef(false),
    generation = useRef(0),
    lock = useRef(false);
  const focus = useRef<HTMLButtonElement | null>(null),
    tabs = useRef<HTMLElement | null>(null);
  const path = reportsPath(data.branch.id);
  useLayoutEffect(() => {
    mounted.current = true;
    generation.current += 1;
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, [path]);
  const current = () => mounted.current && window.location.pathname === path;
  const pending = useIsMutating({ mutationKey: ["admin-actions"] }) > 0;
  const mutation = useMutation({
    mutationKey: ["admin-actions"],
    scope: { id: "admin-actions" },
    retry: false,
    mutationFn: (input: unknown) => resolveReports(input),
  });
  async function submit(row: BranchReportGroup, resolution: ReportResolution) {
    if (lock.current || pending || !current()) return;
    lock.current = true;
    setError("");
    const before = generation.current;
    try {
      const result = await mutation.mutateAsync({
        messageId: row.messageId,
        resolution,
      });
      if (!current() || before !== generation.current) return;
      if (!result.ok) {
        const message =
          result.code === "NOT_FOUND"
            ? "다른 운영자가 이미 처리했어요"
            : adminErrorMessage(result.code);
        setError(message);
        if (!notifySessionExpired(client, result)) toast.error(message);
        if (result.code === "NOT_FOUND") {
          setConfirmation(null);
          router.refresh();
        }
        return;
      }
      setFinished((previous) => new Set([...previous, reportGroupKey(row)]));
      setConfirmation(null);
      toast.success("신고를 처리했어요");
      router.refresh();
      tabs.current
        ?.querySelector<HTMLAnchorElement>('[aria-current="page"]')
        ?.focus();
    } catch (error) {
      if (isRequestCanceled(error)) return;
      if (current() && before === generation.current) {
        const message = errorMessage(error, adminErrorMessage("INTERNAL"));
        setError(message);
        if (!notifySessionExpired(client, error)) toast.error(message);
      }
    } finally {
      lock.current = false;
    }
  }
  const hidden = data.rows.filter(
    (row) => !row.resolution && finished.has(reportGroupKey(row)),
  ).length;
  const count =
    data.reportSummary === null
      ? null
      : Math.max(0, data.reportSummary.count - hidden);
  const rows = data.rows.filter((row) => !finished.has(reportGroupKey(row)));
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <nav
          ref={tabs}
          aria-label="신고 목록"
          className="inline-flex rounded-lg bg-muted p-1"
        >
          {(["open", "resolved"] as const).map((tab) => (
            <Link
              key={tab}
              href={reportsHref(data.branch.id, tab)}
              aria-label={
                tab === "open" && count !== null
                  ? `처리할 것 ${count}`
                  : undefined
              }
              aria-current={selected === tab ? "page" : undefined}
              className="inline-flex min-h-11 items-center gap-2 rounded-md px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring aria-[current=page]:bg-card aria-[current=page]:shadow-card"
              onClick={(event) => {
                if (
                  event.defaultPrevented ||
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                )
                  return;
                event.preventDefault();
                if (!current()) return;
                setConfirmation(null);
                setError("");
                startTransition(() => {
                  setSelected(tab);
                  router.push(reportsHref(data.branch.id, tab), {
                    scroll: false,
                  });
                });
              }}
            >
              {tab === "open" ? "처리할 것" : "처리함"}
              {tab === "open" && count !== null && (
                <span className="tabular-nums"> {count}</span>
              )}
            </Link>
          ))}
        </nav>
        <p className="text-sm text-muted-foreground">
          {data.branch.name} 라운지와 이 지점 예약의 회의 채널 신고만 보여요.
          DM·그룹·팀·커뮤니티 신고와 사용자 신고는 기록만 남아요.
        </p>
      </div>
      {error && !confirmation && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {navigating && selected !== data.tab ? (
        <ReportCardsSkeleton />
      ) : rows.length === 0 ? (
        <p className="rounded-xl border bg-card px-6 py-16 text-center text-muted-foreground">
          {data.tab === "open"
            ? "처리할 신고가 없어요"
            : "최근 30일 동안 처리한 신고가 없어요"}
        </p>
      ) : (
        <div className="space-y-4">
          {rows.map((row, index) => (
            <ReportCard
              key={
                row.resolution
                  ? `${reportGroupKey(row)}:${index}`
                  : reportGroupKey(row)
              }
              row={row}
              now={data.now}
              timezone={data.branch.timezone}
              pending={pending}
              onResolve={
                data.tab === "open"
                  ? (row, resolution, trigger) => {
                      if (resolution === "dismissed") {
                        void submit(row, resolution);
                        return;
                      }
                      focus.current = trigger;
                      setConfirmation({ row, resolution });
                    }
                  : undefined
              }
            />
          ))}
        </div>
      )}
      <Dialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setConfirmation(null);
        }}
      >
        <DialogContent
          showCloseButton={!pending}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (current() && focus.current?.isConnected) focus.current.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {confirmation?.resolution === "member_banned"
                ? "라운지에서 내보낼까요?"
                : "메시지를 지울까요?"}
            </DialogTitle>
            <DialogDescription>
              {confirmation?.resolution === "member_banned"
                ? "신고된 메시지가 지워져요. 이 사람은 관리자가 풀어 줄 때까지 라운지에 다시 들어올 수 없어요."
                : "신고된 메시지와 첨부가 지워져요. 되돌릴 수 없어요."}
            </DialogDescription>
          </DialogHeader>
          {error && confirmation && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setConfirmation(null)}
            >
              취소
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => {
                if (confirmation)
                  void submit(confirmation.row, confirmation.resolution);
              }}
            >
              {pending
                ? "처리하고 있어요"
                : confirmation?.resolution === "member_banned"
                  ? "내보내기"
                  : "지우기"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
