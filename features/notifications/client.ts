import { z } from "zod";
import {
  bookingNotificationDataSchema,
  bookingNotificationTypes,
  personNotificationDataSchema,
  personNotificationTypes,
  parseNotificationData,
  type NotificationSummary,
} from "./types";

const instant = z.iso.datetime({ offset: true });
const itemFields = {
  id: z.string().min(1),
  read: z.boolean(),
  scheduledFor: instant,
  bookingId: z.string().min(1).nullable(),
  href: z
    .string()
    .refine(
      (value) =>
        value.startsWith("/") &&
        !value.startsWith("//") &&
        !/[\\\s]/u.test(value),
    )
    .nullable(),
};
const itemSchema = z
  .discriminatedUnion("type", [
    z.strictObject({
      ...itemFields,
      type: z.enum(bookingNotificationTypes),
      data: bookingNotificationDataSchema,
    }),
    z.strictObject({
      ...itemFields,
      type: z.enum(personNotificationTypes),
      data: personNotificationDataSchema,
    }),
  ])
  .refine((item) => parseNotificationData(item.type, item.data) !== null);
const summarySchema = z.strictObject({
  items: z.array(itemSchema).max(20),
  unreadCount: z.number().int().nonnegative(),
  now: instant,
  nextAt: instant.nullable(),
});

export class NotificationFetchError extends Error {
  constructor(public readonly status: number) {
    super("Notifications could not be loaded");
    this.name = "NotificationFetchError";
  }
}
export type FetchNotificationSummary = (
  signal: AbortSignal,
) => Promise<NotificationSummary>;

export const fetchNotificationSummary: FetchNotificationSummary = async (
  signal,
) => {
  const response = await fetch("/api/notifications", {
    signal,
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) throw new NotificationFetchError(response.status);
  const body: unknown = await response.json().catch(() => {
    throw new NotificationFetchError(500);
  });
  const parsed = summarySchema.safeParse(body);
  if (!parsed.success) throw new NotificationFetchError(500);
  return parsed.data;
};
