CREATE TYPE "public"."call_kind" AS ENUM('voice', 'huddle');--> statement-breakpoint
CREATE TABLE "call_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	"left_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"kind" "call_kind" NOT NULL,
	"started_by" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "call_sessions_time" CHECK ("call_sessions"."ended_at" IS NULL OR "call_sessions"."ended_at" >= "call_sessions"."started_at")
);
--> statement-breakpoint
ALTER TABLE "chat_rooms" ADD COLUMN "voice_capacity" integer;--> statement-breakpoint
UPDATE "chat_rooms" SET "voice_capacity" = 10 WHERE "kind" = 'voice' AND "voice_capacity" IS NULL;--> statement-breakpoint
ALTER TABLE "call_participants" ADD CONSTRAINT "call_participants_session_id_call_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."call_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_participants" ADD CONSTRAINT "call_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_room_id_chat_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."chat_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "call_participants_one_active" ON "call_participants" USING btree ("user_id") WHERE "call_participants"."left_at" IS NULL;--> statement-breakpoint
CREATE INDEX "call_participants_session_id_idx" ON "call_participants" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "call_sessions_one_open" ON "call_sessions" USING btree ("room_id") WHERE "call_sessions"."ended_at" IS NULL;--> statement-breakpoint
ALTER TABLE "chat_rooms" ADD CONSTRAINT "chat_rooms_voice_capacity" CHECK (("chat_rooms"."kind" = 'voice' AND "chat_rooms"."voice_capacity" IS NOT NULL AND "chat_rooms"."voice_capacity" BETWEEN 2 AND 25) OR ("chat_rooms"."kind" <> 'voice' AND "chat_rooms"."voice_capacity" IS NULL));--> statement-breakpoint
INSERT INTO "chat_rooms" ("kind", "space_id", "name", "voice_capacity")
SELECT 'voice', s."id", CASE s."kind" WHEN 'team' THEN '회의실' WHEN 'branch' THEN '라운지-음성' ELSE '음성' END, 10
FROM "chat_spaces" s
WHERE s."deleted_at" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "chat_rooms" r WHERE r."space_id" = s."id" AND r."kind" = 'voice')
ON CONFLICT DO NOTHING;
