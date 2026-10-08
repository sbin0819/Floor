CREATE TYPE "public"."report_reason" AS ENUM('spam', 'harassment', 'inappropriate', 'other');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('online', 'away', 'dnd');--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'message_request';--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_id" uuid NOT NULL,
	"target_user_id" uuid NOT NULL,
	"message_id" uuid,
	"reason" "report_reason" NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reports_detail_length" CHECK ("reports"."detail" IS NULL OR char_length("reports"."detail") <= 500)
);
--> statement-breakpoint
CREATE TABLE "user_blocks" (
	"blocker_id" uuid NOT NULL,
	"blocked_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_blocks_blocker_id_blocked_id_pk" PRIMARY KEY("blocker_id","blocked_id"),
	CONSTRAINT "user_blocks_not_self" CHECK ("user_blocks"."blocker_id" <> "user_blocks"."blocked_id")
);
--> statement-breakpoint
ALTER TABLE "chat_rooms" DROP CONSTRAINT "chat_rooms_kind_ref";--> statement-breakpoint
ALTER TABLE "chat_room_members" ADD COLUMN "requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "system_data" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status" "user_status" DEFAULT 'online' NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocker_id_users_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocked_id_users_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reports_message_unique" ON "reports" USING btree ("reporter_id","message_id") WHERE "reports"."message_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "reports_target_user_id_idx" ON "reports" USING btree ("target_user_id");--> statement-breakpoint
CREATE INDEX "reports_reporter_created_idx" ON "reports" USING btree ("reporter_id","created_at");--> statement-breakpoint
CREATE INDEX "user_blocks_blocked_id_idx" ON "user_blocks" USING btree ("blocked_id");--> statement-breakpoint
ALTER TABLE "chat_room_members" ADD CONSTRAINT "chat_room_members_requested" CHECK ("chat_room_members"."status" NOT IN ('requested', 'declined') OR "chat_room_members"."requested_at" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "chat_rooms" ADD CONSTRAINT "chat_rooms_kind_ref" CHECK (("chat_rooms"."kind" IN ('text', 'voice') AND "chat_rooms"."space_id" IS NOT NULL AND "chat_rooms"."name" IS NOT NULL AND "chat_rooms"."dm_low_user_id" IS NULL AND "chat_rooms"."dm_high_user_id" IS NULL) OR ("chat_rooms"."kind" = 'dm' AND "chat_rooms"."dm_low_user_id" IS NOT NULL AND "chat_rooms"."dm_high_user_id" IS NOT NULL AND "chat_rooms"."dm_low_user_id" < "chat_rooms"."dm_high_user_id" AND "chat_rooms"."space_id" IS NULL AND "chat_rooms"."name" IS NULL) OR ("chat_rooms"."kind" = 'group_dm' AND "chat_rooms"."space_id" IS NULL AND "chat_rooms"."dm_low_user_id" IS NULL AND "chat_rooms"."dm_high_user_id" IS NULL) OR "chat_rooms"."kind" = 'meeting');--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_system_data" CHECK (("messages"."kind" = 'system' AND "messages"."system_data" IS NOT NULL) OR ("messages"."kind" = 'text' AND "messages"."system_data" IS NULL));