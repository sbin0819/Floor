"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "cn";
import { useCall } from "./call-provider";
import { LiveCallControls } from "./live-call-controls";

function Elapsed({ joinedAt }: { joinedAt: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const tick = () =>
      setElapsed(Math.max(0, Math.floor((Date.now() - joinedAt) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [joinedAt]);
  return (
    <span className="tabular-nums">
      {String(Math.floor(elapsed / 60)).padStart(2, "0")}:
      {String(elapsed % 60).padStart(2, "0")}
    </span>
  );
}
export function CallConnectionPanel({ mobile = false }: { mobile?: boolean }) {
  const state = useCall();
  if (
    !state.call ||
    !["connecting", "connected", "reconnecting"].includes(state.phase)
  )
    return null;
  const label =
    state.phase === "connected"
      ? "통화 연결됨"
      : state.phase === "reconnecting"
        ? "다시 연결 중"
        : "통화 연결 중";
  return (
    <section
      aria-label="통화 연결"
      data-mobile-call-panel={mobile ? "" : undefined}
      className={cn(
        "border border-border bg-card p-2",
        mobile
          ? "fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 h-[calc(8rem+env(safe-area-inset-bottom))] border-x-0 border-b-0 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden [body:has([data-chat-screen])_&]:bottom-0"
          : "mb-2 rounded-lg",
      )}
    >
      <div className="flex items-center gap-2 text-sm">
        <span
          aria-hidden="true"
          className={cn(
            "size-2 shrink-0 rounded-full",
            state.phase === "connected"
              ? "bg-status-free-strong"
              : "bg-muted-foreground",
          )}
        />
        <span>{label}</span>
        <span className="ml-auto">
          <Elapsed joinedAt={state.call.joinedAt} />
        </span>
      </div>
      <Link
        href={state.call.href}
        className="flex min-h-11 items-center truncate rounded text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
      >
        {state.call.name}
      </Link>
      <LiveCallControls />
    </section>
  );
}
