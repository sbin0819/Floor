"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  BlockUserDialog,
  type ModerationAction,
} from "@/features/people/components/moderation-dialogs";
import type { ActionResult } from "@/lib/actions/result";

export type MessageRequestState =
  { role: "recipient" } | { role: "sender"; sentCount: number } | null;
export type RespondMessageRequest = (
  input: unknown,
) => Promise<ActionResult<unknown>>;
export function MessageRequestBanner({
  roomId,
  other,
  request,
  respond,
  block,
}: {
  roomId: string;
  other: { userId: string; name: string };
  request: MessageRequestState;
  respond: RespondMessageRequest;
  block: ModerationAction;
}) {
  const router = useRouter();
  const client = useQueryClient();
  const [blocking, setBlocking] = useState(false);
  const blockTrigger = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState("");
  const locked = useRef(false);
  const active = useRef({ active: false });
  useEffect(() => {
    const scope = { active: true };
    active.current = scope;
    return () => {
      scope.active = false;
    };
  }, [roomId]);
  const mutation = useMutation({
    mutationFn: (accept: boolean) => respond({ roomId, accept }),
    retry: false,
  });
  async function decide(accept: boolean) {
    if (locked.current) return;
    locked.current = true;
    setError("");
    const scope = active.current;
    try {
      const result = await mutation.mutateAsync(accept);
      if (!scope.active) return;
      if (!result.ok) {
        setError("요청을 처리하지 못했어요. 다시 시도해 주세요");
        return;
      }
      void client.invalidateQueries({ queryKey: ["chat", "nav"] });
      void client.invalidateQueries({ queryKey: ["people"] });
      if (accept) router.refresh();
      else router.push("/friends?tab=requests");
    } catch {
      if (scope.active)
        setError("요청을 처리하지 못했어요. 다시 시도해 주세요");
    } finally {
      locked.current = false;
    }
  }
  if (!request) return null;
  return (
    <section
      aria-label="메시지 요청"
      className="shrink-0 border-b border-status-pending bg-status-pending px-4 py-3 text-sm text-status-pending-foreground"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p>
          {request.role === "recipient"
            ? `${other.name} 님이 메시지를 보내고 싶어 해요`
            : `${other.name} 님이 수락하면 대화가 시작돼요`}
        </p>
        {request.role === "recipient" && (
          <div className="flex gap-2">
            <Button
              disabled={mutation.isPending}
              onClick={() => void decide(true)}
            >
              수락
            </Button>
            <Button
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => void decide(false)}
            >
              거절
            </Button>
            <Button
              variant="outline"
              disabled={mutation.isPending}
              ref={blockTrigger}
              onClick={() => setBlocking(true)}
            >
              차단
            </Button>
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-destructive">
          {error}
        </p>
      )}
      {blocking && (
        <BlockUserDialog
          person={other}
          open
          onOpenChange={setBlocking}
          action={block}
          onBlocked={() => router.push("/friends?tab=requests")}
          onReturnFocus={() => blockTrigger.current?.focus()}
        />
      )}
    </section>
  );
}
