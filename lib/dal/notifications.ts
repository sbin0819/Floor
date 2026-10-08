import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import type { NotificationWrite } from "@/features/notifications/builders";
import type { DalDatabase } from "./database";
import { notifications } from "@/lib/db/schema";

export async function insertNotifications(
  rows: readonly NotificationWrite[],
  database: DalDatabase,
) {
  if (rows.length) await database.insert(notifications).values([...rows]);
}

export async function deleteBookingReminders(
  { bookingId, userIds }: { bookingId: string; userIds?: readonly string[] },
  database: DalDatabase,
) {
  if (userIds?.length === 0) return;
  await database
    .delete(notifications)
    .where(
      and(
        eq(notifications.bookingId, bookingId),
        eq(notifications.type, "booking_reminder"),
        userIds ? inArray(notifications.userId, [...userIds]) : undefined,
      ),
    );
}
