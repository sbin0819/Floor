import { z } from "zod";
import { isValidTimeZone } from "@/lib/time/zoned";

export const notificationTypes = [
  "booking_invited",
  "booking_changed",
  "booking_cancelled",
  "booking_removed",
  "participant_left",
  "booking_reminder",
] as const;

export type NotificationType = (typeof notificationTypes)[number];
const instant = z.iso.datetime({ offset: true });

export const notificationDataSchema = z
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

export type NotificationData = z.infer<typeof notificationDataSchema>;

export function parseNotificationData(
  type: NotificationType,
  input: unknown,
): NotificationData | null {
  const result = notificationDataSchema.safeParse(input);
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

export type NotificationItem = {
  id: string;
  type: NotificationType;
  read: boolean;
  scheduledFor: string;
  bookingId: string | null;
  data: NotificationData;
  href: string | null;
};

export type NotificationSummary = {
  items: NotificationItem[];
  unreadCount: number;
  now: string;
  nextAt: string | null;
};

export type NotificationListData = Omit<NotificationSummary, "nextAt">;
