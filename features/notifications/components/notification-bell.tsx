"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { MatchMedia } from "@/features/bookings/components/use-wide-screen";
import type { NotificationSummary } from "../types";
import type { FetchNotificationSummary } from "../client";
import { NotificationList } from "./notification-list";
import {
  useNotificationReads,
  useNotificationSummary,
} from "./use-notifications";
import { useNotificationToasts } from "./use-notification-toasts";

const browserMatchMedia: MatchMedia = (query) => window.matchMedia(query);
const serverSnapshot = () => true;
function usePopoverWidth(matchMedia: MatchMedia) {
  const media = useMemo(
    () =>
      typeof window === "undefined" ||
      (!window.matchMedia && matchMedia === browserMatchMedia)
        ? null
        : matchMedia("(min-width: 768px)"),
    [matchMedia],
  );
  const subscribe = useCallback(
    (changed: () => void) => {
      media?.addEventListener("change", changed);
      return () => media?.removeEventListener("change", changed);
    },
    [media],
  );
  const snapshot = useCallback(() => media?.matches ?? true, [media]);
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

export function NotificationBell({
  initialData,
  matchMedia = browserMatchMedia,
  fetchSummary,
}: {
  initialData: NotificationSummary;
  matchMedia?: MatchMedia;
  fetchSummary?: FetchNotificationSummary;
}) {
  const data = useNotificationSummary(initialData, fetchSummary);
  const reads = useNotificationReads();
  useNotificationToasts(data, reads.activate);
  const [open, setOpen] = useState(false);
  const wide = usePopoverWidth(matchMedia);
  const label =
    data.unreadCount > 0
      ? `알림, 읽지 않은 알림 ${data.unreadCount}개`
      : "알림";
  const contents = (
    <>
      <span
        aria-hidden="true"
        className="flex size-10 items-center justify-center rounded-full border border-border bg-muted"
      >
        <Bell className="size-5" />
      </span>
      {data.unreadCount > 0 && (
        <span
          aria-hidden="true"
          className="absolute top-0 right-0 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-status-busy-strong px-1 text-xs font-semibold text-primary-foreground tabular-nums"
        >
          {data.unreadCount > 9 ? "9+" : data.unreadCount}
        </span>
      )}
    </>
  );
  const button = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      className="relative rounded-full"
    >
      {contents}
    </Button>
  );
  if (!wide)
    return (
      <Button
        asChild
        variant="ghost"
        size="icon"
        className="relative rounded-full"
      >
        <a href="/notifications" aria-label={label}>
          {contents}
        </a>
      </Button>
    );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{button}</PopoverTrigger>
      <PopoverContent
        aria-label="알림"
        align="end"
        className="w-[392px] max-w-[calc(100vw-2rem)] gap-0 overflow-hidden p-0"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
          <h2 className="font-bold">알림</h2>
          <Button
            type="button"
            variant="ghost"
            disabled={reads.pending || data.unreadCount === 0}
            onClick={() => void reads.markAll()}
          >
            모두 읽음
          </Button>
        </div>
        <div className="max-h-[min(28rem,60dvh)] overflow-y-auto">
          <NotificationList
            items={data.items}
            now={data.now}
            pendingIds={
              reads.pending
                ? new Set(data.items.map((item) => item.id))
                : undefined
            }
            emptyLabel="새 알림이 없어요"
            onActivate={(item, event) => {
              void reads.activate(item, event).then((success) => {
                if (success && item.href) setOpen(false);
              });
            }}
          />
        </div>
        {reads.message && (
          <p role="status" className="px-4 py-2 text-sm text-destructive">
            {reads.message}
          </p>
        )}
        <a
          href="/notifications"
          className="flex min-h-11 items-center justify-center border-t border-border px-4 py-2 text-sm font-medium text-primary focus-visible:outline-2 focus-visible:outline-ring"
        >
          알림 모두 보기
        </a>
      </PopoverContent>
    </Popover>
  );
}
