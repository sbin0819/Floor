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
export const spaceIconColor = pgEnum("space_icon_color", [
  "blue",
  "green",
  "orange",
  "purple",
  "pink",
  "teal",
  "yellow",
  "gray",
]);
export const chatSpaceRole = pgEnum("chat_space_role", [
  "owner",
  "admin",
  "member",
]);
export const chatSpaceMemberStatus = pgEnum("chat_space_member_status", [
  "active",
  "banned",
]);
export const chatRoomKind = pgEnum("chat_room_kind", [
  "text",
  "voice",
  "dm",
  "group_dm",
  "meeting",
]);
export const messageKind = pgEnum("message_kind", ["text", "system"]);
export const attachmentKind = pgEnum("attachment_kind", ["file", "image"]);
export const callKind = pgEnum("call_kind", ["voice", "huddle"]);
export const userStatus = pgEnum("user_status", ["online", "away", "dnd"]);
export const avatarColor = pgEnum("avatar_color", [
  "blue",
  "green",
  "orange",
  "purple",
  "pink",
  "teal",
  "yellow",
  "gray",
]);
export const reportReason = pgEnum("report_reason", [
  "spam",
  "harassment",
  "inappropriate",
  "other",
]);
export const friendshipStatus = pgEnum("friendship_status", [
  "pending",
  "accepted",
  "declined",
  "cancelled",
]);
export const chatMemberStatus = pgEnum("chat_member_status", [
  "active",
  "requested",
  "declined",
  "left",
]);
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
  "friend_request",
  "friend_accepted",
  "message_request",
  "space_invite",
  "team_removed",
  "team_role_changed",
  "team_deleted",
]);
