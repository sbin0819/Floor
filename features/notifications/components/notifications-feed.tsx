"use client";

import { Button } from "@/components/ui/button";
import type { NotificationListData } from "../types";
import { NotificationList } from "./notification-list";
import { useNotificationList, useNotificationReads } from "./use-notifications";

export function NotificationsFeed({
  initialData,
}: {
  initialData: NotificationListData;
}) {
  const data = useNotificationList(initialData);
  const reads = useNotificationReads();
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="justify-self-end"
        disabled={reads.pending || data.unreadCount === 0}
        onClick={() => void reads.markAll()}
      >
        모두 읽음
      </Button>
      <div className="col-span-2 overflow-hidden rounded-xl border border-border bg-card">
        {reads.message && (
          <p role="status" className="px-4 py-2 text-sm text-destructive">
            {reads.message}
          </p>
        )}
        <NotificationList
          items={data.items}
          now={data.now}
          pendingIds={
            reads.pending
              ? new Set(data.items.map((item) => item.id))
              : undefined
          }
          emptyLabel="알림이 아직 없어요"
          onActivate={(item, event) => {
            void reads.activate(item, event);
          }}
        />
      </div>
    </>
  );
}
