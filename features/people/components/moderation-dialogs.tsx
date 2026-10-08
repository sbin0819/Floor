"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ActionResult } from "@/lib/actions/result";

export type ModerationAction = (
  input: unknown,
) => Promise<ActionResult<unknown>>;
export type ModerationActions = {
  block: ModerationAction;
  unblock: ModerationAction;
  reportUser: ModerationAction;
  reportMessage: ModerationAction;
};
export function BlockUserDialog({
  person,
  open,
  onOpenChange,
  action,
  onBlocked,
  onReturnFocus,
}: {
  person: { userId: string; name: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: ModerationAction;
  onBlocked?: () => void;
  onReturnFocus?: () => void;
}) {
  const client = useQueryClient();
  const router = useRouter();
  const locked = useRef(false);
  const active = useRef({ active: false });
  useEffect(() => {
    const scope = { active: open };
    active.current = scope;
    return () => {
      scope.active = false;
    };
  }, [person.userId, open]);
  const [error, setError] = useState("");
  const mutation = useMutation({
    mutationFn: () => action({ userId: person.userId }),
    retry: false,
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!locked.current) onOpenChange(next);
      }}
    >
      <DialogContent
        onCloseAutoFocus={(event) => {
          if (onReturnFocus) {
            event.preventDefault();
            onReturnFocus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{person.name} 님을 차단할까요?</DialogTitle>
          <DialogDescription>
            서로 메시지와 친구 요청을 보낼 수 없어요. 상대에게는 알리지 않아요
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={mutation.isPending}
            onClick={() => onOpenChange(false)}
          >
            취소
          </Button>
          <Button
            variant="destructive"
            disabled={mutation.isPending}
            onClick={async () => {
              if (locked.current) return;
              locked.current = true;
              setError("");
              const scope = active.current;
              try {
                const result = await mutation.mutateAsync();
                if (!scope.active) return;
                if (!result.ok) {
                  setError("차단하지 못했어요. 다시 시도해 주세요");
                  return;
                }
                toast.success("차단했어요");
                void client.invalidateQueries({ queryKey: ["people"] });
                void client.invalidateQueries({ queryKey: ["chat", "nav"] });
                router.refresh();
                onOpenChange(false);
                onBlocked?.();
              } catch {
                if (scope.active)
                  setError("차단하지 못했어요. 다시 시도해 주세요");
              } finally {
                locked.current = false;
              }
            }}
          >
            차단
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const reasons = [
  { value: "spam", label: "스팸" },
  { value: "harassment", label: "괴롭힘" },
  { value: "inappropriate", label: "부적절한 내용" },
  { value: "other", label: "기타" },
] as const;
export function ReportDialog({
  target,
  open,
  onOpenChange,
  report,
  block,
  onReturnFocus,
}: {
  target: { userId: string; name: string; messageId?: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  report: ModerationAction;
  block: ModerationAction;
  onReturnFocus?: () => void;
}) {
  const id = useId();
  const client = useQueryClient();
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [detail, setDetail] = useState("");
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [reported, setReported] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);
  const active = useRef({ active: false });
  function close() {
    setReason("");
    setDetail("");
    setAlsoBlock(false);
    setReported(false);
    setError("");
    onOpenChange(false);
  }
  useEffect(() => {
    const scope = { active: open };
    active.current = scope;
    return () => {
      scope.active = false;
    };
  }, [target.userId, target.messageId, open]);
  const mutation = useMutation({
    mutationFn: (input: unknown) => report(input),
    retry: false,
  });
  const blockMutation = useMutation({
    mutationFn: () => block({ userId: target.userId }),
    retry: false,
  });
  const pending = mutation.isPending || blockMutation.isPending;
  async function submit() {
    if (locked.current) return;
    if (!reported && (!reason || Array.from(detail.trim()).length > 500)) {
      setError(
        !reason ? "신고 사유를 골라 주세요" : "설명은 500자까지 입력해 주세요",
      );
      return;
    }
    locked.current = true;
    setError("");
    const scope = active.current;
    try {
      if (!reported) {
        const result = await mutation.mutateAsync({
          ...(target.messageId
            ? { messageId: target.messageId }
            : { userId: target.userId }),
          reason,
          detail: detail.trim(),
        });
        if (!scope.active) return;
        if (!result.ok) {
          setError(
            result.code === "LIMIT_EXCEEDED" &&
              result.message === "report_daily"
              ? "오늘은 신고를 더 할 수 없어요"
              : "신고하지 못했어요. 다시 시도해 주세요",
          );
          return;
        }
        setReported(true);
        toast.success("신고했어요. 검토에 쓸게요");
      }
      if (alsoBlock) {
        let blocked = false;
        try {
          blocked = (await blockMutation.mutateAsync()).ok;
        } catch {
          /* 신고는 이미 저장되어 다시 보내지 않는다. */
        }
        if (!scope.active) return;
        if (!blocked) {
          setError(
            "신고는 완료했지만 차단하지 못했어요. 차단을 다시 시도해 주세요",
          );
          return;
        }
        void client.invalidateQueries({ queryKey: ["people"] });
        void client.invalidateQueries({ queryKey: ["chat", "nav"] });
        router.refresh();
      }
      close();
    } catch {
      if (scope.active) setError("신고하지 못했어요. 다시 시도해 주세요");
    } finally {
      locked.current = false;
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!locked.current) {
          if (next) onOpenChange(true);
          else close();
        }
      }}
    >
      <DialogContent
        onCloseAutoFocus={(event) => {
          if (onReturnFocus) {
            event.preventDefault();
            onReturnFocus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {target.messageId ? "메시지 신고" : `${target.name} 님 신고`}
          </DialogTitle>
          <DialogDescription>
            검토에 필요한 사유를 알려 주세요. 상대에게는 알리지 않아요
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <fieldset disabled={pending || reported} className="space-y-3">
            <legend className="mb-2 text-sm font-semibold">신고 사유</legend>
            <RadioGroup
              value={reason}
              onValueChange={setReason}
              aria-label="신고 사유"
              aria-required="true"
              aria-describedby={error ? `${id}-error` : undefined}
            >
              {reasons.map((item) => (
                <div
                  key={item.value}
                  className="flex min-h-11 items-center gap-2"
                >
                  <RadioGroupItem
                    id={`${id}-${item.value}`}
                    value={item.value}
                  />
                  <Label htmlFor={`${id}-${item.value}`}>{item.label}</Label>
                </div>
              ))}
            </RadioGroup>
            <Label htmlFor={`${id}-detail`}>설명 (선택)</Label>
            <Textarea
              id={`${id}-detail`}
              value={detail}
              onChange={(event) => setDetail(event.target.value)}
              aria-describedby={`${id}-count`}
              aria-invalid={Array.from(detail.trim()).length > 500 || undefined}
              rows={3}
            />
            <p
              id={`${id}-count`}
              className="text-right text-xs text-muted-foreground tabular-nums"
            >
              {Array.from(detail.trim()).length}/500
            </p>
            <Label
              htmlFor={`${id}-block`}
              className="flex min-h-11 items-center gap-2"
            >
              <input
                type="checkbox"
                id={`${id}-block`}
                checked={alsoBlock}
                onChange={(event) => setAlsoBlock(event.target.checked)}
                className="size-4 accent-primary"
              />
              이 사람도 차단하기
            </Label>
          </fieldset>
          {error && (
            <p
              id={`${id}-error`}
              role="alert"
              className="text-sm text-destructive"
            >
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={close}
            >
              닫기
            </Button>
            <Button type="submit" disabled={pending}>
              {reported ? "차단 다시 시도" : "신고"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
