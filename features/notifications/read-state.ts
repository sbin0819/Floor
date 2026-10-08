import type { NotificationItem, NotificationListData } from "./types";

export type NotificationRead =
  { kind: "one"; item: NotificationItem } | { kind: "all" };

export function applyNotificationRead<T extends NotificationListData>(
  data: T,
  operation: NotificationRead,
): T {
  const matches = (item: NotificationItem) =>
    operation.kind === "all" ||
    item.id === operation.item.id ||
    (item.type === "booking_reminder" &&
      operation.item.type === "booking_reminder" &&
      item.bookingId !== null &&
      item.bookingId === operation.item.bookingId &&
      item.scheduledFor <= data.now);
  const visibleMatch = data.items.find(matches);
  const reduction =
    operation.kind === "all"
      ? data.unreadCount
      : visibleMatch
        ? Number(!visibleMatch.read)
        : Number(!operation.item.read);
  return {
    ...data,
    items: data.items.map((item) =>
      matches(item) ? { ...item, read: true } : item,
    ),
    unreadCount: Math.max(0, data.unreadCount - reduction),
  };
}
