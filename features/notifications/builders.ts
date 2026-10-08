import {
  parseNotificationData,
  type NotificationData,
  type NotificationType,
} from "./types";

export const REMINDER_MINUTES = [30, 10, 5, 0] as const;
export type ReminderMinutes = (typeof REMINDER_MINUTES)[number];
type During = { start: Date; end: Date };

export type NotificationBooking = {
  id: string;
  during: During;
  title?: string | null;
  spaceName: string;
  floorName: string;
  branchName: string;
  timezone: string;
};

export type NotificationWrite = {
  userId: string;
  type: NotificationType;
  bookingId: string;
  actorId: string | null;
  data: NotificationData;
  scheduledFor: Date;
  expiresAt: Date | null;
};

export function createReminderSchedule(during: During, now: Date) {
  return REMINDER_MINUTES.map((minutesBefore) => ({
    minutesBefore,
    scheduledFor: new Date(during.start.getTime() - minutesBefore * 60_000),
    expiresAt: during.end,
  })).filter(({ scheduledFor }) => scheduledFor > now);
}

export function buildNotificationData(
  booking: NotificationBooking,
  options: {
    actorName?: string;
    previousDuring?: During;
    minutesBefore?: ReminderMinutes;
  } = {},
): NotificationData {
  const data = {
    spaceName: booking.spaceName,
    floorName: booking.floorName,
    branchName: booking.branchName,
    timezone: booking.timezone,
    start: booking.during.start.toISOString(),
    end: booking.during.end.toISOString(),
  };
  // 미리 저장하는 미리 알림에는 나중에 바뀔 제목이나 사람 정보를 복사하지 않는다.
  if (options.minutesBefore !== undefined)
    return { ...data, minutesBefore: options.minutesBefore };
  return {
    ...data,
    ...(options.actorName ? { actorName: options.actorName } : {}),
    ...(booking.title ? { title: booking.title } : {}),
    ...(options.previousDuring
      ? {
          previousStart: options.previousDuring.start.toISOString(),
          previousEnd: options.previousDuring.end.toISOString(),
        }
      : {}),
  };
}

export function buildReminderNotifications(
  booking: NotificationBooking,
  userIds: readonly string[],
  now: Date,
): NotificationWrite[] {
  const schedule = createReminderSchedule(booking.during, now);
  return [...new Set(userIds)].flatMap((userId) =>
    schedule.map(({ minutesBefore, scheduledFor, expiresAt }) => ({
      userId,
      type: "booking_reminder",
      bookingId: booking.id,
      actorId: null,
      data: buildNotificationData(booking, { minutesBefore }),
      scheduledFor,
      expiresAt,
    })),
  );
}

export function buildBookingNotifications({
  type,
  booking,
  actor,
  userIds,
  now,
  previousDuring,
}: {
  type: Exclude<NotificationType, "booking_reminder">;
  booking: NotificationBooking;
  actor: { id: string; name: string };
  userIds: readonly string[];
  now: Date;
  previousDuring?: During;
}): NotificationWrite[] {
  const data = buildNotificationData(booking, {
    actorName: actor.name,
    previousDuring,
  });
  if (!parseNotificationData(type, data))
    throw new Error("Invalid notification snapshot.");
  return [...new Set(userIds)]
    .filter((userId) => userId !== actor.id)
    .map((userId) => ({
      userId,
      type,
      bookingId: booking.id,
      actorId: actor.id,
      data,
      scheduledFor: now,
      expiresAt: null,
    }));
}

export function notificationBookingSnapshot({
  booking,
  space,
  floor,
  branch,
  areaName,
}: {
  booking: { id: string; during: During; title: string | null };
  space: { name: string };
  floor: { name: string };
  branch: { name: string; timezone: string };
  areaName?: string;
}): NotificationBooking {
  return {
    id: booking.id,
    during: booking.during,
    title: booking.title,
    spaceName: areaName ? `${areaName} ${space.name}` : space.name,
    floorName: floor.name,
    branchName: branch.name,
    timezone: branch.timezone,
  };
}
