"use client";

import { cn } from "cn";
import { usePresenceStatus } from "@/components/realtime-provider";
import { statusLabel, type PresenceStatus } from "../status";

const colors: Record<PresenceStatus, string> = {
  online: "text-presence-online",
  away: "text-presence-away",
  dnd: "text-presence-dnd",
  offline: "text-presence-offline",
  unknown: "text-muted-foreground",
};
export function StatusDot({ status }: { status: PresenceStatus }) {
  if (status === "unknown") return null;
  return (
    <svg
      role="img"
      aria-label={statusLabel(status)}
      viewBox="0 0 12 12"
      focusable="false"
      className={cn("inline-block size-2.5 shrink-0", colors[status])}
    >
      <title>{statusLabel(status)}</title>
      {status === "away" ? (
        <path
          d="M10.6 7.2A5 5 0 0 1 4.8 1.4a5 5 0 1 0 5.8 5.8Z"
          fill="currentColor"
        />
      ) : status === "dnd" ? (
        <path
          d="M6 1a5 5 0 1 0 0 10A5 5 0 0 0 6 1ZM3 5h6v2H3Z"
          fill="currentColor"
          fillRule="evenodd"
        />
      ) : (
        <circle
          cx="6"
          cy="6"
          r="4"
          fill={status === "offline" ? "none" : "currentColor"}
          stroke="currentColor"
          strokeWidth="2"
        />
      )}
    </svg>
  );
}
export function PersonStatus({
  userId,
  sharesSpace,
  showLabel = false,
}: {
  userId: string;
  sharesSpace: boolean;
  showLabel?: boolean;
}) {
  const status = usePresenceStatus(userId, sharesSpace);
  if (status === "unknown") return null;
  return (
    <span className="inline-flex items-center gap-1.5">
      <StatusDot status={status} />
      {showLabel && (
        <span className="text-xs text-muted-foreground">
          {statusLabel(status)}
        </span>
      )}
    </span>
  );
}
