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
export const chatRoomKind = pgEnum("chat_room_kind", [
  "booking",
  "channel",
  "inquiry",
  "team",
]);
export const messageKind = pgEnum("message_kind", ["text", "system"]);
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
