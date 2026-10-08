"use server";

import { createNotificationActions } from "./action-factory";

export async function markNotificationRead(input: unknown) {
  return createNotificationActions().markNotificationRead(input);
}

export async function markAllNotificationsRead() {
  return createNotificationActions().markAllNotificationsRead();
}
