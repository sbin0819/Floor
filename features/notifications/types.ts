import { z } from "zod";
import type { Avatar } from "@/lib/avatar";
import { isValidTimeZone } from "@/lib/time/zoned";
import {
  cancellationKindSchema,
  cancellationReasonSchema,
} from "@/features/bookings/cancellation";

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
  "message_request",
] as const;
export const teamNotificationTypes = [
  "team_removed",
  "team_role_changed",
  "team_deleted",
] as const;
export const notificationTypes = [
  ...bookingNotificationTypes,
  ...personNotificationTypes,
  ...teamNotificationTypes,
  "space_invite",
  "branch_announcement",
  "welcome",
] as const;

export type NotificationType = (typeof notificationTypes)[number];
export type BookingNotificationType = (typeof bookingNotificationTypes)[number];
export type PersonNotificationType = (typeof personNotificationTypes)[number];
export type TeamNotificationType = (typeof teamNotificationTypes)[number];
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
    cancelKind: cancellationKindSchema.optional(),
    cancelReason: cancellationReasonSchema.optional(),
    minutesBefore: z
      .union([z.literal(30), z.literal(10), z.literal(5), z.literal(0)])
      .optional(),
  })
  .refine((value) => Date.parse(value.end) > Date.parse(value.start))
  .refine(
    (value) =>
      (value.cancelKind === undefined) === (value.cancelReason === undefined),
  );

export const personNotificationDataSchema = z.strictObject({
  actorName: z.string().min(1),
});
export const spaceInviteNotificationDataSchema = z.strictObject({
  actorName: z.string().min(1),
  spaceName: z.string().min(1),
  inviteCode: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
});
export const teamNotificationDataSchema = z.strictObject({
  actorName: z.string().min(1),
  teamName: z.string().min(1),
});
export const teamRoleNotificationDataSchema = teamNotificationDataSchema.extend(
  {
    teamId: z.uuid(),
    role: z.enum(["admin", "member"]),
  },
);
const announcementText = (max: number) =>
  z.string().refine((value) => {
    const length = Array.from(value).length;
    return length >= 1 && length <= max && !value.includes("\0");
  });
export const branchAnnouncementNotificationDataSchema = z.strictObject({
  branchName: z.string().min(1),
  title: announcementText(60),
  body: announcementText(500),
  announcementId: z.uuid(),
});
// 가입 직후 한 번 보내는 환영 알림. 받는 사람의 가입 때 이름만 담는다.
export const welcomeNotificationDataSchema = z.strictObject({
  name: z.string().min(1),
});
export const notificationDataSchema = z.union([
  bookingNotificationDataSchema,
  personNotificationDataSchema,
  spaceInviteNotificationDataSchema,
  teamNotificationDataSchema,
  teamRoleNotificationDataSchema,
  branchAnnouncementNotificationDataSchema,
  welcomeNotificationDataSchema,
]);
export type WelcomeNotificationData = z.infer<
  typeof welcomeNotificationDataSchema
>;
export type BranchAnnouncementNotificationData = z.infer<
  typeof branchAnnouncementNotificationDataSchema
>;
export type BookingNotificationData = z.infer<
  typeof bookingNotificationDataSchema
>;
export type PersonNotificationData = z.infer<
  typeof personNotificationDataSchema
>;
export type SpaceInviteNotificationData = z.infer<
  typeof spaceInviteNotificationDataSchema
>;
export type TeamNotificationData = z.infer<typeof teamNotificationDataSchema>;
export type TeamRoleNotificationData = z.infer<
  typeof teamRoleNotificationDataSchema
>;
export type NotificationData =
  | BookingNotificationData
  | PersonNotificationData
  | SpaceInviteNotificationData
  | TeamNotificationData
  | TeamRoleNotificationData
  | BranchAnnouncementNotificationData
  | WelcomeNotificationData;
export type NotificationSnapshot =
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
    }[PersonNotificationType]
  | { type: "space_invite"; data: SpaceInviteNotificationData }
  | { type: "team_removed"; data: TeamNotificationData }
  | { type: "team_deleted"; data: TeamNotificationData }
  | { type: "team_role_changed"; data: TeamRoleNotificationData }
  | { type: "branch_announcement"; data: BranchAnnouncementNotificationData }
  | { type: "welcome"; data: WelcomeNotificationData };
export type NotificationContent = NotificationSnapshot & {
  bookingId: string | null;
};

export function isPersonNotificationType(
  type: NotificationType,
): type is PersonNotificationType {
  return (
    type === "friend_request" ||
    type === "friend_accepted" ||
    type === "message_request"
  );
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
  type: "space_invite",
  input: unknown,
): SpaceInviteNotificationData | null;
export function parseNotificationData(
  type: "team_removed" | "team_deleted",
  input: unknown,
): TeamNotificationData | null;
export function parseNotificationData(
  type: "team_role_changed",
  input: unknown,
): TeamRoleNotificationData | null;
export function parseNotificationData(
  type: "branch_announcement",
  input: unknown,
): BranchAnnouncementNotificationData | null;
export function parseNotificationData(
  type: "welcome",
  input: unknown,
): WelcomeNotificationData | null;
export function parseNotificationData(
  type: NotificationType,
  input: unknown,
): NotificationData | null;
export function parseNotificationData(
  type: NotificationType,
  input: unknown,
): NotificationData | null {
  if (type === "welcome") {
    const result = welcomeNotificationDataSchema.safeParse(input);
    return result.success ? result.data : null;
  }
  if (type === "branch_announcement") {
    const result = branchAnnouncementNotificationDataSchema.safeParse(input);
    return result.success ? result.data : null;
  }
  if (type === "team_removed" || type === "team_deleted") {
    const result = teamNotificationDataSchema.safeParse(input);
    return result.success ? result.data : null;
  }
  if (type === "team_role_changed") {
    const result = teamRoleNotificationDataSchema.safeParse(input);
    return result.success ? result.data : null;
  }
  if (type === "space_invite") {
    const result = spaceInviteNotificationDataSchema.safeParse(input);
    return result.success ? result.data : null;
  }
  if (isPersonNotificationType(type)) {
    const result = personNotificationDataSchema.safeParse(input);
    return result.success ? result.data : null;
  }
  const result = bookingNotificationDataSchema.safeParse(input);
  if (!result.success) return null;
  const value = result.data;
  if (type !== "booking_cancelled" && value.cancelKind !== undefined)
    return null;
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
  bookingId: string | null,
): NotificationContent | null {
  if (type === "welcome") {
    const data = parseNotificationData(type, input);
    return data ? { type, data, bookingId: null } : null;
  }
  if (type === "branch_announcement") {
    const data = parseNotificationData(type, input);
    return data ? { type, data, bookingId: null } : null;
  }
  if (type === "team_removed" || type === "team_deleted") {
    const data = parseNotificationData(type, input);
    return data ? { type, data, bookingId: null } : null;
  }
  if (type === "team_role_changed") {
    const data = parseNotificationData(type, input);
    return data ? { type, data, bookingId: null } : null;
  }
  if (type === "space_invite") {
    const data = parseNotificationData(type, input);
    return data ? { type, data, bookingId: null } : null;
  }
  if (isPersonNotificationType(type)) {
    const data = parseNotificationData(type, input);
    return data ? { type, data, bookingId: null } : null;
  }
  const data = parseNotificationData(type, input);
  return data ? { type, data, bookingId } : null;
}

export type NotificationItem = NotificationContent & {
  id: string;
  actorAvatar: Avatar | null;
  read: boolean;
  scheduledFor: string;
  href: string | null;
};

export type NotificationSummary = {
  items: NotificationItem[];
  unreadCount: number;
  now: string;
  nextAt: string | null;
};

export type NotificationListData = Omit<NotificationSummary, "nextAt">;
