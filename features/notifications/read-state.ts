import type { NotificationItem, NotificationListData } from "./types";

export type NotificationRead =
  | { kind: "one"; item: NotificationItem; through?: string }
  | { kind: "all"; through?: string };

export function applyNotificationRead<T extends NotificationListData>(
  data: T,
  operation: NotificationRead,
): T {
  const through = Date.parse(operation.through ?? data.now);
  const matches = (item: NotificationItem) =>
    Date.parse(item.scheduledFor) <= through &&
    (operation.kind === "all" ||
      item.id === operation.item.id ||
      (item.type === "booking_reminder" &&
        operation.item.type === "booking_reminder" &&
        item.bookingId !== null &&
        item.bookingId === operation.item.bookingId));
  const visibleMatch = data.items.find(matches);
  const possiblyVisible =
    operation.kind === "one" &&
    Date.parse(operation.item.scheduledFor) <= Date.parse(data.now) &&
    (operation.item.type !== "booking_reminder" ||
      Date.parse(operation.item.data.end) > Date.parse(data.now));
  const reminderReplaced =
    operation.kind === "one" &&
    operation.item.type === "booking_reminder" &&
    data.items.some(
      (item) =>
        item.type === "booking_reminder" &&
        item.bookingId === operation.item.bookingId &&
        Date.parse(item.scheduledFor) > through,
    );
  const reduction =
    operation.kind === "all"
      ? Date.parse(data.now) <= through
        ? data.unreadCount
        : data.items.filter((item) => matches(item) && !item.read).length
      : visibleMatch
        ? Number(!visibleMatch.read)
        : Number(possiblyVisible && !reminderReplaced && !operation.item.read);
  return {
    ...data,
    items: data.items.map((item) =>
      matches(item) ? { ...item, read: true } : item,
    ),
    unreadCount: Math.max(0, data.unreadCount - reduction),
  };
}
