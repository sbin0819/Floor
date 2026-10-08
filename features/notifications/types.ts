import { z } from "zod";
import { isValidTimeZone } from "@/lib/time/zoned";

export const bookingNotificationTypes = [
  "booking_invited",
  "booking_changed",
  "booking_cancelled",
  "booking_removed",
  "participant_left",
  "booking_reminder",
] as const;
export const personNotificationTypes = [
  "friend_request",
  "friend_accepted",
] as const;
export const notificationTypes = [
  ...bookingNotificationTypes,
  ...personNotificationTypes,
] as const;

export type NotificationType = (typeof notificationTypes)[number];
export type BookingNotificationType = (typeof bookingNotificationTypes)[number];
export type PersonNotificationType = (typeof personNotificationTypes)[number];
const instant = z.iso.datetime({ offset: true });

export const bookingNotificationDataSchema = z
  .strictObject({
    actorName: z.string().min(1).optional(),
    spaceName: z.string().min(1),
    floorName: z.string().min(1),
    branchName: z.string().min(1),
    timezone: z.string().refine(isValidTimeZone),
    start: instant,
    end: instant,
    previousStart: instant.optional(),
    previousEnd: instant.optional(),
    title: z.string().optional(),
    minutesBefore: z
      .union([z.literal(30), z.literal(10), z.literal(5), z.literal(0)])
      .optional(),
  })
  .refine((value) => Date.parse(value.end) > Date.parse(value.start));

export const personNotificationDataSchema = z.strictObject({
  actorName: z.string().min(1),
});
export const notificationDataSchema = z.union([
  bookingNotificationDataSchema,
  personNotificationDataSchema,
]);
export type BookingNotificationData = z.infer<
  typeof bookingNotificationDataSchema
>;
export type PersonNotificationData = z.infer<
  typeof personNotificationDataSchema
>;
export type NotificationData = BookingNotificationData | PersonNotificationData;
export type NotificationContent =
  | {
      [Type in BookingNotificationType]: {
        type: Type;
        data: BookingNotificationData;
      };
    }[BookingNotificationType]
  | {
      [Type in PersonNotificationType]: {
        type: Type;
        data: PersonNotificationData;
      };
    }[PersonNotificationType];

export function isPersonNotificationType(
  type: NotificationType,
): type is PersonNotificationType {
  return type === "friend_request" || type === "friend_accepted";
}

export function parseNotificationData(
  type: BookingNotificationType,
  input: unknown,
): BookingNotificationData | null;
export function parseNotificationData(
  type: PersonNotificationType,
  input: unknown,
): PersonNotificationData | null;
export function parseNotificationData(
  type: NotificationType,
  input: unknown,
): NotificationData | null;
export function parseNotificationData(
  type: NotificationType,
  input: unknown,
): NotificationData | null {
  if (isPersonNotificationType(type)) {
    const result = personNotificationDataSchema.safeParse(input);
    return result.success ? result.data : null;
  }
  const result = bookingNotificationDataSchema.safeParse(input);
  if (!result.success) return null;
  const value = result.data;
  if (type === "booking_reminder")
    return value.minutesBefore !== undefined &&
      value.actorName === undefined &&
      value.title === undefined &&
      value.previousStart === undefined &&
      value.previousEnd === undefined
      ? value
      : null;
  if (value.minutesBefore !== undefined) return null;
  if (type === "booking_changed")
    return value.previousStart !== undefined &&
      value.previousEnd !== undefined &&
      Date.parse(value.previousEnd) > Date.parse(value.previousStart)
      ? value
      : null;
  return value.previousStart === undefined && value.previousEnd === undefined
    ? value
    : null;
}

export function parseNotificationContent(
  type: NotificationType,
  input: unknown,
): NotificationContent | null {
  if (isPersonNotificationType(type)) {
    const data = parseNotificationData(type, input);
    return data ? { type, data } : null;
  }
  const data = parseNotificationData(type, input);
  return data ? { type, data } : null;
}

export type NotificationItem = NotificationContent & {
  id: string;
  read: boolean;
  scheduledFor: string;
  bookingId: string | null;
  href: string | null;
};

export type NotificationSummary = {
  items: NotificationItem[];
  unreadCount: number;
  now: string;
  nextAt: string | null;
};

export type NotificationListData = Omit<NotificationSummary, "nextAt">;
