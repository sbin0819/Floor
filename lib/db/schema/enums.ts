import { pgEnum } from "drizzle-orm/pg-core";

export const accessScope = pgEnum("access_scope", [
  "everyone",
  "teams",
  "closed",
]);
export const spaceType = pgEnum("space_type", [
  "meeting_room",
  "phone_booth",
  "seminar",
  "desk_area",
  "desk",
  "lounge",
]);
export const planStatus = pgEnum("plan_status", [
  "draft",
  "published",
  "archived",
]);
export const bookingStatus = pgEnum("booking_status", [
  "confirmed",
  "cancelled",
]);
export const chatSpaceKind = pgEnum("chat_space_kind", [
  "team",
  "branch",
  "community",
]);
export const chatRoomKind = pgEnum("chat_room_kind", [
  "text",
  "voice",
  "dm",
  "group_dm",
  "meeting",
]);
export const messageKind = pgEnum("message_kind", ["text", "system"]);
export const reactionEmoji = pgEnum("reaction_emoji", [
  "thumbs_up",
  "heart",
  "joy",
  "tada",
  "open_mouth",
  "cry",
  "pray",
  "check",
]);
export const teamRole = pgEnum("team_role", ["admin", "member"]);
export const joinRequestStatus = pgEnum("join_request_status", [
  "pending",
  "approved",
  "rejected",
  "cancelled",
]);
export const appRole = pgEnum("app_role", [
  "user",
  "team_member",
  "team_admin",
  "operator",
]);
export const grantTarget = pgEnum("grant_target", ["floor", "space"]);
export const notificationType = pgEnum("notification_type", [
  "booking_invited",
  "booking_changed",
  "booking_cancelled",
  "booking_removed",
  "participant_left",
  "booking_reminder",
]);
