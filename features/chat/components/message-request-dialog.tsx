"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
import { messageBodySchema } from "../schema";

export type SendMessageRequest = (
  input: unknown,
) => Promise<ActionResult<{ roomId: string }>>;
export function requestError(result: { code: string; message?: string }) {
  if (result.message === "request_daily")
    return "오늘은 메시지 요청을 더 보낼 수 없어요";
  if (result.message === "request_pending")
    return "상대가 수락하면 더 보낼 수 있어요";
  if (result.code === "FORBIDDEN") return "메시지를 보낼 수 없어요";
  return "메시지를 보내지 못했어요. 다시 시도해 주세요";
}
export function MessageRequestDialog({
  person,
  open,
  onOpenChange,
  send,
  onReturnFocus,
}: {
  person: { userId: string; name: string; canDirectMessage: boolean };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  send: SendMessageRequest;
  onReturnFocus?: () => void;
}) {
  const id = useId();
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const locked = useRef(false);
  const active = useRef({ active: false });
  const clientId = useRef<string | null>(null);
  function close() {
    setBody("");
    setError("");
    clientId.current = null;
    onOpenChange(false);
  }
  useEffect(() => {
    const scope = { active: open };
    active.current = scope;
    return () => {
      scope.active = false;
    };
  }, [person.userId, open]);
  const mutation = useMutation({
    mutationFn: (input: unknown) => send(input),
    retry: false,
  });
  const count = Array.from(body.trim()).length;
  async function submit() {
    if (locked.current || person.canDirectMessage) return;
    const parsed = messageBodySchema.safeParse(body);
    if (!parsed.success) {
      setError("메시지를 1–4000자로 입력해 주세요");
      return;
    }
    locked.current = true;
    setError("");
    clientId.current ??= crypto.randomUUID();
    const scope = active.current;
    try {
      const result = await mutation.mutateAsync({
        userId: person.userId,
        clientId: clientId.current,
        body: parsed.data,
      });
      if (!scope.active) return;
      if (!result.ok) {
        setError(requestError(result));
        return;
      }
      close();
      router.push(`/dm/${result.data.roomId}`);
    } catch {
      if (scope.active)
        setError("메시지를 보내지 못했어요. 다시 시도해 주세요");
    } finally {
      locked.current = false;
    }
  }
  if (person.canDirectMessage) return null;
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
          <DialogTitle>{person.name} 님에게 메시지 보내기</DialogTitle>
          <DialogDescription>
            친구가 아니어서 메시지 요청으로 가요. 상대가 수락하기 전에는 3개까지
            보낼 수 있어요
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Label htmlFor={`${id}-body`}>메시지</Label>
          <Textarea
            id={`${id}-body`}
            value={body}
            disabled={mutation.isPending}
            onChange={(event) => {
              setBody(event.target.value);
              clientId.current = null;
            }}
            aria-describedby={`${id}-count${error ? ` ${id}-error` : ""}`}
            aria-invalid={count > 4000 || undefined}
            rows={4}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing &&
                event.nativeEvent.keyCode !== 229
              ) {
                event.preventDefault();
                void submit();
              }
            }}
          />
          <p
            id={`${id}-count`}
            className="text-right text-xs text-muted-foreground tabular-nums"
          >
            {count}/4000
          </p>
          {error && (
            <p
              role="alert"
              id={`${id}-error`}
              className="text-sm text-destructive"
            >
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={mutation.isPending}
              onClick={close}
            >
              취소
            </Button>
            <Button
              type="submit"
              disabled={
                mutation.isPending || !messageBodySchema.safeParse(body).success
              }
            >
              보내기
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
