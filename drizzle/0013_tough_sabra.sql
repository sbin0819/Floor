CREATE TYPE "public"."chat_room_kind" AS ENUM('text', 'voice', 'dm', 'group_dm', 'meeting');--> statement-breakpoint
CREATE TYPE "public"."chat_space_kind" AS ENUM('team', 'branch', 'community');--> statement-breakpoint
CREATE TABLE "chat_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "chat_room_kind" NOT NULL,
	"space_id" uuid,
	"name" text,
	"topic" text,
	"admin_only" boolean DEFAULT false NOT NULL,
	"last_seq" bigint DEFAULT 0 NOT NULL,
	"last_message_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_rooms_kind_ref" CHECK ("chat_rooms"."kind" NOT IN ('text', 'voice') OR ("chat_rooms"."space_id" IS NOT NULL AND "chat_rooms"."name" IS NOT NULL)),
	CONSTRAINT "chat_rooms_name_length" CHECK (("chat_rooms"."name" IS NULL OR char_length("chat_rooms"."name") BETWEEN 1 AND 30) AND ("chat_rooms"."topic" IS NULL OR char_length("chat_rooms"."topic") <= 200))
);
--> statement-breakpoint
CREATE TABLE "chat_spaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "chat_space_kind" NOT NULL,
	"team_id" uuid,
	"branch_id" uuid,
	"name" text,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_spaces_team_unique" UNIQUE("team_id"),
	CONSTRAINT "chat_spaces_branch_unique" UNIQUE("branch_id"),
	CONSTRAINT "chat_spaces_kind_ref" CHECK (("chat_spaces"."kind" = 'team' AND "chat_spaces"."team_id" IS NOT NULL AND "chat_spaces"."branch_id" IS NULL AND "chat_spaces"."name" IS NULL) OR ("chat_spaces"."kind" = 'branch' AND "chat_spaces"."branch_id" IS NOT NULL AND "chat_spaces"."team_id" IS NULL AND "chat_spaces"."name" IS NULL) OR ("chat_spaces"."kind" = 'community' AND "chat_spaces"."name" IS NOT NULL AND "chat_spaces"."created_by" IS NOT NULL AND "chat_spaces"."team_id" IS NULL AND "chat_spaces"."branch_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"author_id" uuid,
	"kind" "message_kind" DEFAULT 'text' NOT NULL,
	"body" text NOT NULL,
	"client_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_room_id_seq_unique" UNIQUE("room_id","seq"),
	CONSTRAINT "messages_author_kind" CHECK (("messages"."kind" = 'system' AND "messages"."author_id" IS NULL) OR ("messages"."kind" = 'text' AND "messages"."author_id" IS NOT NULL)),
	CONSTRAINT "messages_body_length" CHECK (char_length("messages"."body") BETWEEN 1 AND 4000)
);
--> statement-breakpoint
ALTER TABLE "chat_rooms" ADD CONSTRAINT "chat_rooms_space_id_chat_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."chat_spaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_spaces" ADD CONSTRAINT "chat_spaces_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_spaces" ADD CONSTRAINT "chat_spaces_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_spaces" ADD CONSTRAINT "chat_spaces_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_room_id_chat_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."chat_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_rooms_space_name_unique" ON "chat_rooms" USING btree ("space_id",lower("name")) WHERE "chat_rooms"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "chat_rooms_space_id_idx" ON "chat_rooms" USING btree ("space_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_room_id_client_id_unique" ON "messages" USING btree ("room_id","client_id") WHERE "messages"."client_id" IS NOT NULL;--> statement-breakpoint
INSERT INTO "chat_spaces" ("kind", "team_id")
SELECT 'team', "id" FROM "teams";--> statement-breakpoint
INSERT INTO "chat_rooms" ("kind", "space_id", "name")
SELECT 'text', "chat_spaces"."id", '일반'
FROM "teams"
INNER JOIN "chat_spaces" ON "chat_spaces"."team_id" = "teams"."id";
