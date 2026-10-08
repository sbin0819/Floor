"use client";
import { avatarColorFor } from "@/lib/avatar";

import { useEffect, useId, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Phone, PhoneOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useRealtimeChannel } from "@/components/realtime-provider";
import { userChannel } from "@/lib/realtime/channels";
import type { RealtimeEvent } from "@/lib/realtime/types";
import { declineCall } from "@/features/calls/actions";
import { useCall } from "./call-provider";

type Ring = Extract<RealtimeEvent, { type: "call.ringing" }>;
type PendingRing = { event: Ring; timer: ReturnType<typeof setTimeout> };
const toastId = (sessionId: string) => `call:ringing:${sessionId}`;

export function CallRingingCard({
  name,
  onAccept,
  onDecline,
}: {
  name: string;
  onAccept: () => Promise<void>;
  onDecline: () => Promise<boolean>;
}) {
  const titleId = useId();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function respond(accept: boolean) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      if (accept) await onAccept();
      else if (!(await onDecline()))
        setError("거절하지 못했어요. 다시 시도해 주세요");
    } catch {
      setError("응답하지 못했어요. 다시 시도해 주세요");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      className="w-full rounded-xl border bg-popover p-4 text-popover-foreground shadow-pop"
    >
      <h2 id={titleId} className="flex items-center gap-2 text-base font-bold">
        <Phone className="size-5 shrink-0" aria-hidden="true" />
        {name} 님의 전화
      </h2>
      <div className="mt-3 flex gap-2">
        <Button disabled={pending} onClick={() => void respond(true)}>
          <Phone aria-hidden="true" /> 받기
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => void respond(false)}
        >
          <PhoneOff aria-hidden="true" /> 거절
        </Button>
      </div>
      {error && (
        <p role="status" className="mt-2 text-sm">
          {error}
        </p>
      )}
    </section>
  );
}

export function CallRinging({
  userId,
  myStatus,
  blockedUserIds,
  enabled,
}: {
  userId: string;
  myStatus: "online" | "away" | "dnd";
  blockedUserIds: readonly string[];
  enabled: boolean;
}) {
  const call = useCall();
  const pending = useRef(new Map<string, PendingRing>());
  const seen = useRef(new Set<string>());
  const declining = useMutation({
    mutationKey: ["calls", "decline"],
    mutationFn: (input: { sessionId: string }) => declineCall(input),
    retry: false,
    networkMode: "always",
  });
  function remember(sessionId: string) {
    seen.current.add(sessionId);
    if (seen.current.size > 128)
      seen.current.delete(seen.current.values().next().value!);
  }
  function dismiss(sessionId: string) {
    const entry = pending.current.get(sessionId);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.current.delete(sessionId);
    toast.dismiss(toastId(sessionId));
  }
  useEffect(() => {
    const entries = pending.current;
    const history = seen.current;
    return () => {
      for (const [id, entry] of entries) {
        clearTimeout(entry.timer);
        toast.dismiss(toastId(id));
      }
      entries.clear();
      history.clear();
    };
  }, [userId]);
  useEffect(() => {
    for (const [id, { event }] of pending.current)
      if (
        !enabled ||
        myStatus === "dnd" ||
        blockedUserIds.includes(event.callerId)
      )
        dismiss(id);
  }, [enabled, myStatus, blockedUserIds]);
  useRealtimeChannel(enabled ? userChannel(userId) : null, (event) => {
    if (event.type === "call.declined") {
      remember(event.sessionId);
      dismiss(event.sessionId);
      return;
    }
    if (event.type === "call.changed") {
      const accepted = event.participants.some(
        (person) => person.userId === userId,
      );
      if (accepted && event.sessionId) remember(event.sessionId);
      for (const [id, entry] of pending.current)
        if (
          entry.event.roomId === event.roomId &&
          (event.sessionId === null || (event.sessionId === id && accepted))
        )
          dismiss(id);
      return;
    }
    if (event.type !== "call.ringing" || seen.current.has(event.sessionId))
      return;
    remember(event.sessionId);
    if (
      !enabled ||
      myStatus === "dnd" ||
      event.callerId === userId ||
      blockedUserIds.includes(event.callerId) ||
      call.call?.sessionId === event.sessionId
    )
      return;
    // 토스트가 마우스/포커스로 머물러도 실제 울림의 30초는 연장하지 않는다.
    pending.current.set(event.sessionId, {
      event,
      timer: setTimeout(() => dismiss(event.sessionId), 30_000),
    });
    if (pending.current.size > 20)
      dismiss(pending.current.keys().next().value!);
    toast.custom(
      () => (
        <CallRingingCard
          name={event.callerName}
          onAccept={async () => {
            if (!pending.current.has(event.sessionId)) return;
            dismiss(event.sessionId);
            await call.join({
              roomId: event.roomId,
              roomKind: "dm",
              name: event.callerName,
              href: `/dm/${event.roomId}`,
              participants: [
                {
                  userId: event.callerId,
                  name: event.callerName,
                  avatar: {
                    color: avatarColorFor(event.callerId, null),
                    photoUrl: null,
                  },
                },
              ],
            });
          }}
          onDecline={async () => {
            if (!pending.current.has(event.sessionId)) return true;
            const result = await declining.mutateAsync({
              sessionId: event.sessionId,
            });
            if (result.ok) dismiss(event.sessionId);
            return result.ok;
          }}
        />
      ),
      {
        id: toastId(event.sessionId),
        position: "bottom-right",
        duration: 30_000,
        onDismiss: () => dismiss(event.sessionId),
        onAutoClose: () => dismiss(event.sessionId),
      },
    );
  });
  return null;
}
