"use client";

import { useLinkStatus } from "next/link";

export function LinkPending() {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden="true"
      data-pending={pending || undefined}
      className={`pointer-events-none absolute inset-0 rounded-lg border border-border bg-muted transition-opacity duration-150 motion-reduce:transition-none ${pending ? "opacity-100" : "opacity-0"}`}
    />
  );
}
