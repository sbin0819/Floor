import { createNotificationQueries } from "./query-factory";

export async function getNotificationSummary() {
  return createNotificationQueries().getNotificationSummary();
}

export async function getNotifications() {
  return createNotificationQueries().getNotifications();
}
