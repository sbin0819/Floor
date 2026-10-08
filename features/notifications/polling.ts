import type { NotificationSummary } from "./types";

export const NOTIFICATION_POLL_INTERVAL = 60_000;
export const NOTIFICATION_IDLE_DELAY = 10 * 60_000;

export function notificationReminderDelay({
  now,
  nextAt,
}: Pick<NotificationSummary, "now" | "nextAt">): number | null {
  if (!nextAt) return null;
  const remaining = Date.parse(nextAt) - Date.parse(now);
  return Number.isFinite(remaining) &&
    remaining >= 0 &&
    remaining <= NOTIFICATION_POLL_INTERVAL
    ? remaining + 1_000
    : null;
}

export function newlyPublishedNotifications(
  summary: NotificationSummary,
  previousNow: string,
) {
  if (Date.parse(summary.now) <= Date.parse(previousNow)) return [];
  return summary.items.filter(
    (item) =>
      !item.read && Date.parse(item.scheduledFor) > Date.parse(previousNow),
  );
}

export function notificationToastId(
  item: NotificationSummary["items"][number],
) {
  return item.type === "booking_reminder" && item.bookingId
    ? `reminder:${item.bookingId}`
    : item.id;
}
