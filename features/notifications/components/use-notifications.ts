"use client";

import { useEffect, type MouseEvent } from "react";
import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { shouldInterceptNavigation } from "@/components/optimistic-navigation";
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/features/notifications/actions";
import type {
  NotificationItem,
  NotificationListData,
  NotificationSummary,
} from "../types";
import { applyNotificationRead, type NotificationRead } from "../read-state";

export const NOTIFICATION_SUMMARY_KEY = ["notifications", "summary"] as const;
export const NOTIFICATION_LIST_KEY = ["notifications", "list"] as const;
export const NOTIFICATION_READ_KEY = ["notification-read"] as const;
const locked = new WeakSet<QueryClient>();
const readError = "알림을 읽음으로 바꾸지 못했어요. 다시 시도해 주세요";

function useIncomingData(
  key: typeof NOTIFICATION_SUMMARY_KEY | typeof NOTIFICATION_LIST_KEY,
  incoming: NotificationListData,
) {
  const client = useQueryClient();
  useEffect(() => {
    client.setQueryData<NotificationListData>(key, (current) =>
      !current || Date.parse(incoming.now) > Date.parse(current.now)
        ? incoming
        : current,
    );
  }, [client, key, incoming]);
}

export function useNotificationSummary(initialData: NotificationSummary) {
  const query = useQuery({
    queryKey: NOTIFICATION_SUMMARY_KEY,
    initialData,
    enabled: false,
  });
  useIncomingData(NOTIFICATION_SUMMARY_KEY, initialData);
  return query.data;
}

export function useNotificationList(initialData: NotificationListData) {
  const query = useQuery({
    queryKey: NOTIFICATION_LIST_KEY,
    initialData,
    enabled: false,
  });
  useIncomingData(NOTIFICATION_LIST_KEY, initialData);
  return query.data;
}

export function useNotificationReads() {
  const client = useQueryClient();
  const router = useRouter();
  const pending = useIsMutating({ mutationKey: NOTIFICATION_READ_KEY }) > 0;
  const mutation = useMutation({
    mutationKey: NOTIFICATION_READ_KEY,
    scope: { id: "notification-read" },
    retry: false,
    mutationFn: async (operation: NotificationRead) => {
      const result =
        operation.kind === "all"
          ? await markAllNotificationsRead()
          : await markNotificationRead({ notificationId: operation.item.id });
      if (!result.ok) throw new Error(readError);
    },
    onMutate: async (operation) => {
      await client.cancelQueries({ queryKey: ["notifications"] });
      return client
        .getQueriesData<NotificationListData>({ queryKey: ["notifications"] })
        .map(([key, previous]) => ({
          key,
          previous,
          optimistic: previous
            ? client.setQueryData(
                key,
                applyNotificationRead(previous, operation),
              )
            : undefined,
        }));
    },
    onError: (_error, _operation, snapshots) => {
      for (const snapshot of snapshots ?? []) {
        // 더 늦은 서버 응답이 온 경우에는 과거 목록으로 되돌리지 않는다.
        if (client.getQueryData(snapshot.key) === snapshot.optimistic)
          client.setQueryData(snapshot.key, snapshot.previous);
      }
      toast.error(readError);
    },
  });
  const submit = async (operation: NotificationRead) => {
    if (locked.has(client)) return false;
    locked.add(client);
    try {
      await mutation.mutateAsync(operation);
      return true;
    } catch {
      return false;
    } finally {
      locked.delete(client);
    }
  };
  const activate = async (
    item: NotificationItem,
    event?: MouseEvent<HTMLElement>,
  ) => {
    if (
      item.href &&
      event &&
      !shouldInterceptNavigation(event as MouseEvent<HTMLAnchorElement>)
    )
      return false;
    event?.preventDefault();
    const success = await submit({ kind: "one", item });
    if (success && item.href) router.push(item.href);
    return success;
  };
  return {
    pending,
    activate,
    markAll: () => submit({ kind: "all" }),
    message: mutation.isError ? readError : "",
  };
}
