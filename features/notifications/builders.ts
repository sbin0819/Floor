import {
  parseNotificationData,
  parseNotificationContent,
  type BookingNotificationData,
  type BookingNotificationType,
  type BranchAnnouncementNotificationData,
  type NotificationContent,
} from "./types";
import type { BookingCancellation } from "@/features/bookings/cancellation";

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

export type NotificationWrite = NotificationContent & {
  userId: string;
  bookingId: string | null;
  actorId: string | null;
  scheduledFor: Date;
  expiresAt: Date | null;
};
type BookingNotificationWrite = NotificationWrite & {
  type: BookingNotificationType;
  data: BookingNotificationData;
  bookingId: string;
};

export function buildWelcomeNotification(input: {
  userId: string;
  name: string;
  now: Date;
}): NotificationWrite[] {
  const content = parseNotificationContent(
    "welcome",
    { name: input.name },
    null,
  );
  if (!content) throw new Error("Invalid welcome snapshot.");
  return [
    {
      ...content,
      userId: input.userId,
      actorId: null,
      scheduledFor: input.now,
      expiresAt: null,
    },
  ];
}

export function buildBranchAnnouncementNotifications(
  input: BranchAnnouncementNotificationData & {
    actorId: string;
    userIds: readonly string[];
    now: Date;
  },
): NotificationWrite[] {
  const { branchName, title, body, announcementId } = input;
  const content = parseNotificationContent(
    "branch_announcement",
    { branchName, title, body, announcementId },
    null,
  );
  if (!content) throw new Error("Invalid branch announcement snapshot.");
  return [...new Set(input.userIds)]
    .filter((userId) => userId !== input.actorId)
    .map((userId) => ({
      ...content,
      userId,
      actorId: input.actorId,
      scheduledFor: input.now,
      expiresAt: null,
    }));
}

export function buildTeamNotifications(
  input: {
    teamName: string;
    actor: { id: string; name: string };
    userIds: readonly string[];
    now: Date;
  } & (
    | { type: "team_removed" | "team_deleted" }
    | { type: "team_role_changed"; teamId: string; role: "admin" | "member" }
  ),
): NotificationWrite[] {
  const data = {
    actorName: input.actor.name,
    teamName: input.teamName,
    ...(input.type === "team_role_changed"
      ? { teamId: input.teamId, role: input.role }
      : {}),
  };
  const content = parseNotificationContent(input.type, data, null);
  if (!content) throw new Error("Invalid team notification snapshot.");
  return [...new Set(input.userIds)]
    .filter((userId) => userId !== input.actor.id)
    .map((userId) => ({
      ...content,
      userId,
      actorId: input.actor.id,
      scheduledFor: input.now,
      expiresAt: null,
    }));
}

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
    cancellation?: BookingCancellation;
  } = {},
): BookingNotificationData {
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
    ...(options.cancellation
      ? {
          cancelKind: options.cancellation.kind,
          cancelReason: options.cancellation.reason,
        }
      : {}),
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
): BookingNotificationWrite[] {
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
  cancellation,
}: {
  type: Exclude<BookingNotificationType, "booking_reminder">;
  booking: NotificationBooking;
  actor: { id: string; name: string };
  userIds: readonly string[];
  now: Date;
  previousDuring?: During;
  cancellation?: BookingCancellation;
}): BookingNotificationWrite[] {
  const data = buildNotificationData(booking, {
    actorName: actor.name,
    previousDuring,
    cancellation,
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
