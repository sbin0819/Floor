"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CallTarget } from "../client/types";
import { useCall } from "./call-provider";

export function MeetingCallButton({
  target,
  start,
  end,
  status,
  now,
  enabled,
  eligible,
}: {
  target: CallTarget;
  start: string;
  end: string;
  status: "confirmed" | "cancelled";
  now: string;
  enabled: boolean;
  eligible: boolean;
}) {
  const call = useCall();
  const submitting = useRef(false);
  const descriptionId = useId();
  const [clock, setClock] = useState({ anchor: now, value: Date.parse(now) });
  const current = clock.anchor === now ? clock.value : Date.parse(now);
  const opens = Date.parse(start) - 600_000;
  const closes = Date.parse(end);
  useEffect(() => {
    if (!enabled || status !== "confirmed") return;
    const base = Date.parse(now);
    const elapsedFrom = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    function update() {
      clearTimeout(timer);
      const value = base + Math.max(0, Date.now() - elapsedFrom);
      setClock({ anchor: now, value });
      const next = [opens, closes].find((boundary) => boundary > value);
      if (next !== undefined)
        timer = setTimeout(update, Math.min(next - value, 2_147_483_647));
    }
    update();
    document.addEventListener("visibilitychange", update);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, [now, opens, closes, enabled, status]);
  if (!enabled || status !== "confirmed" || current >= closes) return null;
  const early = current < opens;
  const joining = call.phase === "connecting" || call.phase === "checking";
  return (
    <div className="space-y-1">
      <Button
        disabled={!eligible || early || joining}
        aria-describedby={early && eligible ? descriptionId : undefined}
        onClick={async () => {
          if (submitting.current) return;
          submitting.current = true;
          try {
            await call.join(target);
          } finally {
            submitting.current = false;
          }
        }}
      >
        <Video aria-hidden="true" /> 회의 참여
      </Button>
      {early && eligible && (
        <p id={descriptionId} className="text-sm text-muted-foreground">
          10분 전부터 참여할 수 있어요
        </p>
      )}
    </div>
  );
}
