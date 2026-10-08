import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import type { NotificationWrite } from "@/features/notifications/builders";
import {
  personNotificationDataSchema,
  type PersonNotificationType,
} from "@/features/notifications/types";
import type { DalDatabase } from "./database";
import { notifications } from "@/lib/db/schema";

export async function createPersonNotification(
  {
    userId,
    type,
    actorId,
    actorName,
    now,
  }: {
    userId: string;
    type: PersonNotificationType;
    actorId: string;
    actorName: string;
    now: Date;
  },
  database: DalDatabase,
) {
  const [created] = await database
    .insert(notifications)
    .values({
      userId,
      type,
      actorId,
      bookingId: null,
      data: personNotificationDataSchema.parse({ actorName }),
      scheduledFor: now,
      expiresAt: null,
    })
    .returning({ id: notifications.id });
  return created!;
}

export async function deleteFriendRequestNotification(
  userId: string,
  actorId: string,
  database: DalDatabase,
) {
  return database
    .delete(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.actorId, actorId),
        eq(notifications.type, "friend_request"),
      ),
    )
    .returning({ id: notifications.id });
}

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
