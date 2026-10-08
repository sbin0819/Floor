"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { notificationPresentation } from "../format";
import { newlyPublishedNotifications, notificationToastId } from "../polling";
import type { NotificationItem, NotificationSummary } from "../types";

export function useNotificationToasts(
  data: NotificationSummary,
  activate: (item: NotificationItem) => Promise<boolean>,
) {
  const previousNow = useRef(data.now);
  const router = useRouter();
  useEffect(() => {
    if (Date.parse(data.now) <= Date.parse(previousNow.current)) return;
    const incoming = newlyPublishedNotifications(data, previousNow.current);
    previousNow.current = data.now;
    if (incoming.length >= 4) {
      toast(`새 알림 ${incoming.length}개`, {
        id: `notifications:${data.now}`,
        action: { label: "보기", onClick: () => router.push("/notifications") },
      });
      return;
    }
    for (const item of incoming) {
      const presentation = notificationPresentation(item);
      toast(presentation.text, {
        id: notificationToastId(item),
        description: presentation.dateTime,
        ...(item.href
          ? {
              action: {
                label: "보기",
                onClick: () => {
                  void activate(item);
                },
              },
            }
          : {}),
      });
    }
  }, [data, activate, router]);
}
