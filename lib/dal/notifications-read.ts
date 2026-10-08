import "server-only";

import {
  and,
  asc,
  desc,
  eq,
  gt,
  isNull,
  lte,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { alias, type AnyPgColumn } from "drizzle-orm/pg-core";
import { getDb } from "@/lib/db/client";
import { notifications } from "@/lib/db/schema";
import type { DalDatabase } from "./database";

function visible(
  userId: string,
  now: Date,
  table: {
    userId: AnyPgColumn;
    scheduledFor: AnyPgColumn;
    expiresAt: AnyPgColumn;
  } = notifications,
) {
  return and(
    eq(table.userId, userId),
    lte(table.scheduledFor, now),
    or(isNull(table.expiresAt), gt(table.expiresAt, now)),
  );
}

function latestVisible(userId: string, now: Date, database: DalDatabase) {
  const newer = alias(notifications, "newer_reminder");
  return and(
    visible(userId, now),
    or(
      sql`${notifications.type} <> 'booking_reminder'`,
      isNull(notifications.bookingId),
      notExists(
        database
          .select({ id: newer.id })
          .from(newer)
          .where(
            and(
              visible(userId, now, newer),
              eq(newer.type, "booking_reminder"),
              eq(newer.bookingId, notifications.bookingId),
              gt(newer.scheduledFor, notifications.scheduledFor),
            ),
          ),
      ),
    ),
  );
}

export function listVisibleNotifications(
  userId: string,
  now: Date,
  limit: 20 | 100,
  database: DalDatabase = getDb(),
) {
  return database
    .select({
      id: notifications.id,
      type: notifications.type,
      bookingId: notifications.bookingId,
      data: notifications.data,
      scheduledFor: notifications.scheduledFor,
      readAt: notifications.readAt,
    })
    .from(notifications)
    .where(latestVisible(userId, now, database))
    .orderBy(desc(notifications.scheduledFor), asc(notifications.id))
    .limit(limit);
}

export async function countUnreadNotifications(
  userId: string,
  now: Date,
  database: DalDatabase = getDb(),
) {
  const [row] = await database
    .select({ count: sql<number>`count(*)::integer` })
    .from(notifications)
    .where(
      and(latestVisible(userId, now, database), isNull(notifications.readAt)),
    );
  return row?.count ?? 0;
}

export async function nextNotificationAt(
  userId: string,
  now: Date,
  database: DalDatabase = getDb(),
) {
  const [row] = await database
    .select({ at: notifications.scheduledFor })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        gt(notifications.scheduledFor, now),
        or(isNull(notifications.expiresAt), gt(notifications.expiresAt, now)),
      ),
    )
    .orderBy(asc(notifications.scheduledFor))
    .limit(1);
  return row?.at ?? null;
}

export async function markVisibleNotificationRead(
  userId: string,
  notificationId: string,
  now: Date,
  database: DalDatabase = getDb(),
) {
  const target = alias(notifications, "read_target");
  await database
    .update(notifications)
    .set({ readAt: now })
    .where(
      and(
        visible(userId, now),
        isNull(notifications.readAt),
        or(
          eq(notifications.id, notificationId),
          and(
            eq(notifications.type, "booking_reminder"),
            sql`${notifications.bookingId} in (${database
              .select({ bookingId: target.bookingId })
              .from(target)
              .where(
                and(
                  eq(target.id, notificationId),
                  eq(target.type, "booking_reminder"),
                  visible(userId, now, target),
                ),
              )})`,
          ),
        ),
      ),
    );
}

export async function markAllVisibleNotificationsRead(
  userId: string,
  now: Date,
  database: DalDatabase = getDb(),
) {
  await database
    .update(notifications)
    .set({ readAt: now })
    .where(and(visible(userId, now), isNull(notifications.readAt)));
}
