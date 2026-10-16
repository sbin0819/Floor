import { z } from "zod";
import { avatarSchema } from "@/lib/avatar";
import { requestJson } from "@/lib/http/client";
import {
  bookingNotificationDataSchema,
  bookingNotificationTypes,
  branchAnnouncementNotificationDataSchema,
  personNotificationDataSchema,
  personNotificationTypes,
  spaceInviteNotificationDataSchema,
  teamNotificationDataSchema,
  teamRoleNotificationDataSchema,
  parseNotificationData,
  type NotificationSummary,
} from "./types";

const instant = z.iso.datetime({ offset: true });
const itemFields = {
  id: z.string().min(1),
  actorAvatar: avatarSchema.nullable(),
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
      type: z.literal("branch_announcement"),
      data: branchAnnouncementNotificationDataSchema,
      bookingId: z.null(),
      href: z.null(),
    }),
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
    z.strictObject({
      ...itemFields,
      type: z.literal("space_invite"),
      data: spaceInviteNotificationDataSchema,
    }),
    z.strictObject({
      ...itemFields,
      type: z.enum(["team_removed", "team_deleted"]),
      data: teamNotificationDataSchema,
    }),
    z.strictObject({
      ...itemFields,
      type: z.literal("team_role_changed"),
      data: teamRoleNotificationDataSchema,
    }),
  ])
  .refine((item) => parseNotificationData(item.type, item.data) !== null);
const summarySchema = z.strictObject({
  items: z.array(itemSchema).max(20),
  unreadCount: z.number().int().nonnegative(),
  now: instant,
  nextAt: instant.nullable(),
});

export type FetchNotificationSummary = (
  signal: AbortSignal,
) => Promise<NotificationSummary>;

export const fetchNotificationSummary: FetchNotificationSummary = (signal) =>
  requestJson("/api/notifications", summarySchema, { signal });
