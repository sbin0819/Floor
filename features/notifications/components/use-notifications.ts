"use client";

import { useEffect, useRef, type MouseEvent } from "react";
import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
  skipToken,
  type QueryClient,
  type QueryKey,
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
import {
  fetchNotificationSummary,
  type FetchNotificationSummary,
} from "../client";
import {
  NOTIFICATION_POLL_INTERVAL,
  notificationReminderDelay,
} from "../polling";
import { useNotificationActivity } from "./use-notification-activity";

export const NOTIFICATION_SUMMARY_KEY = ["notifications", "summary"] as const;
export const NOTIFICATION_LIST_KEY = ["notifications", "list"] as const;
export const NOTIFICATION_READ_KEY = ["notification-read"] as const;
const locked = new WeakSet<QueryClient>();
const readError = "알림을 읽음으로 바꾸지 못했어요. 다시 시도해 주세요";
type ReadSnapshot = {
  key: QueryKey;
  previous: NotificationListData | undefined;
  optimistic: NotificationListData | undefined;
};

function useIncomingData(
  key: typeof NOTIFICATION_SUMMARY_KEY | typeof NOTIFICATION_LIST_KEY,
  incoming: NotificationListData,
) {
  const client = useQueryClient();
  useEffect(() => {
    const current = client.getQueryData<NotificationListData>(key);
    if (current && Date.parse(incoming.now) <= Date.parse(current.now)) return;
    const pending = client
      .getMutationCache()
      .find<void, Error, NotificationRead, ReadSnapshot[]>({
        mutationKey: NOTIFICATION_READ_KEY,
        status: "pending",
      });
    const snapshots = pending?.state.context;
    const operation = pending?.state.variables;
    if (snapshots && operation) {
      let snapshot = snapshots.find((entry) => entry.key[1] === key[1]);
      if (!snapshot) {
        snapshot = { key, previous: incoming, optimistic: undefined };
        snapshots.push(snapshot);
      }
      // 새 응답을 밑에 두고 진행 중인 읽음만 덮어야 실패 시 새 알림까지 사라지지 않는다.
      snapshot.previous = incoming;
      snapshot.optimistic = client.setQueryData<NotificationListData>(
        key,
        applyNotificationRead(incoming, operation),
      );
    } else client.setQueryData(key, incoming);
  }, [client, key, incoming]);
}

export function useNotificationSummary(
  initialData: NotificationSummary,
  fetchSummary: FetchNotificationSummary = fetchNotificationSummary,
) {
  const client = useQueryClient();
  const pending = useIsMutating({ mutationKey: NOTIFICATION_READ_KEY }) > 0;
  const activity = useNotificationActivity();
  const query = useQuery({
    queryKey: NOTIFICATION_SUMMARY_KEY,
    queryFn: async ({ signal }) => {
      const incoming = await fetchSummary(signal);
      const current = client.getQueryData<NotificationSummary>(
        NOTIFICATION_SUMMARY_KEY,
      );
      return current && Date.parse(incoming.now) < Date.parse(current.now)
        ? current
        : incoming;
    },
    initialData,
    enabled: activity.active && !pending,
    refetchOnMount: false,
    refetchOnWindowFocus: "always",
    refetchInterval:
      activity.active && !pending ? NOTIFICATION_POLL_INTERVAL : false,
    refetchIntervalInBackground: false,
    retry: false,
  });
  useIncomingData(NOTIFICATION_SUMMARY_KEY, initialData);
  const { refetch } = query;
  const resumed = useRef(0);
  useEffect(() => {
    if (!activity.active || pending || resumed.current === activity.resumed)
      return;
    resumed.current = activity.resumed;
    void refetch({ cancelRefetch: false });
  }, [activity, pending, refetch]);
  useEffect(() => {
    if (!activity.active || pending) return;
    const delay = notificationReminderDelay(query.data);
    if (delay === null) return;
    const timer = setTimeout(() => {
      if (document.visibilityState !== "hidden")
        void refetch({ cancelRefetch: false });
    }, delay);
    return () => clearTimeout(timer);
  }, [
    activity.active,
    pending,
    query.data.now,
    query.data.nextAt,
    query.data,
    refetch,
  ]);
  return query.data;
}

export function useNotificationList(initialData: NotificationListData) {
  const query = useQuery<NotificationListData>({
    queryKey: NOTIFICATION_LIST_KEY,
    queryFn: skipToken,
    initialData,
    enabled: false,
  });
  useIncomingData(NOTIFICATION_LIST_KEY, initialData);
  return query.data ?? initialData;
}

export function useNotificationReads() {
  const client = useQueryClient();
  const router = useRouter();
  const pending = useIsMutating({ mutationKey: NOTIFICATION_READ_KEY }) > 0;
  const mutation = useMutation<void, Error, NotificationRead, ReadSnapshot[]>({
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
            ? client.setQueryData<NotificationListData>(
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
    onSettled: (_data, error) => {
      // 이 시점에는 읽음 mutation이 아직 pending이므로 다음 관찰 주기에 최신 요약을 읽는다.
      void client.invalidateQueries({ queryKey: NOTIFICATION_SUMMARY_KEY });
      if (
        !error &&
        (client
          .getQueryCache()
          .find({ queryKey: NOTIFICATION_LIST_KEY, exact: true })
          ?.getObserversCount() ?? 0) > 0
      ) {
        // 100건 밖의 읽지 않은 수도 서버가 다시 세되 기존 목록과 포커스는 유지한다.
        router.refresh();
      }
    },
  });
  const submit = async (operation: NotificationRead) => {
    if (locked.has(client)) return false;
    locked.add(client);
    const through = client
      .getQueriesData<NotificationListData>({ queryKey: ["notifications"] })
      .flatMap(([, data]) => (data ? [data.now] : []))
      .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
    try {
      await mutation.mutateAsync({ ...operation, through });
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
