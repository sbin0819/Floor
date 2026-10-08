import { readBookingNow } from "@/features/bookings/request-clock";
import { requireSession } from "@/lib/auth/session";
import type { Session } from "@/lib/auth/types";
import type { DalDatabase } from "@/lib/dal";
import {
  countUnreadNotifications,
  listVisibleNotifications,
  nextNotificationAt,
} from "@/lib/dal/notifications-read";
import { notificationHref } from "./format";
import {
  parseNotificationContent,
  type NotificationItem,
  type NotificationListData,
  type NotificationSummary,
} from "./types";

type Dependencies = {
  database?: DalDatabase;
  requireSession?: () => Promise<Session>;
  now?: () => Date;
};

function items(
  rows: Awaited<ReturnType<typeof listVisibleNotifications>>,
): NotificationItem[] {
  return rows.flatMap((row) => {
    const content = parseNotificationContent(row.type, row.data, row.bookingId);
    return content
      ? [
          {
            id: row.id,
            actorAvatar: row.actorAvatar,
            ...content,
            read: row.readAt !== null,
            scheduledFor: row.scheduledFor.toISOString(),
            href: notificationHref(content),
          },
        ]
      : [];
  });
}

export function createNotificationQueries(dependencies: Dependencies = {}) {
  async function context() {
    const session = await (dependencies.requireSession ?? requireSession)();
    const now = dependencies.now?.() ?? readBookingNow(!!dependencies.database);
    return { userId: session.userId, now };
  }
  return {
    async getNotificationSummary(): Promise<NotificationSummary> {
      const { userId, now } = await context();
      const [rows, unreadCount, nextAt] = await Promise.all([
        listVisibleNotifications(userId, now, 20, dependencies.database),
        countUnreadNotifications(userId, now, dependencies.database),
        nextNotificationAt(userId, now, dependencies.database),
      ]);
      return {
        items: items(rows),
        unreadCount,
        now: now.toISOString(),
        nextAt: nextAt?.toISOString() ?? null,
      };
    },
    async getNotifications(): Promise<NotificationListData> {
      const { userId, now } = await context();
      const [rows, unreadCount] = await Promise.all([
        listVisibleNotifications(userId, now, 100, dependencies.database),
        countUnreadNotifications(userId, now, dependencies.database),
      ]);
      return { items: items(rows), unreadCount, now: now.toISOString() };
    },
  };
}
