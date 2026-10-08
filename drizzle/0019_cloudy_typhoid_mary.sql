CREATE TYPE "public"."chat_space_member_status" AS ENUM('active', 'banned');--> statement-breakpoint
CREATE TYPE "public"."chat_space_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."space_icon_color" AS ENUM('blue', 'green', 'orange', 'purple', 'pink', 'teal', 'yellow', 'gray');--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'space_invite';--> statement-breakpoint
CREATE TABLE "chat_space_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"code" text NOT NULL,
	"created_by" uuid NOT NULL,
	"target_user_id" uuid,
	"expires_at" timestamp with time zone,
	"max_uses" integer,
	"use_count" integer DEFAULT 0 NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_space_invites_code_unique" UNIQUE("code"),
	CONSTRAINT "chat_space_invites_uses" CHECK ("chat_space_invites"."use_count" >= 0 AND ("chat_space_invites"."max_uses" IS NULL OR ("chat_space_invites"."max_uses" >= 1 AND "chat_space_invites"."use_count" <= "chat_space_invites"."max_uses")))
);
--> statement-breakpoint
CREATE TABLE "chat_space_members" (
	"space_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "chat_space_role" DEFAULT 'member' NOT NULL,
	"status" "chat_space_member_status" DEFAULT 'active' NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	"status_changed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_space_members_space_id_user_id_pk" PRIMARY KEY("space_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "chat_spaces" ADD COLUMN "icon_color" "space_icon_color" DEFAULT 'blue' NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_space_invites" ADD CONSTRAINT "chat_space_invites_space_id_chat_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."chat_spaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_space_invites" ADD CONSTRAINT "chat_space_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_space_invites" ADD CONSTRAINT "chat_space_invites_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_space_members" ADD CONSTRAINT "chat_space_members_space_id_chat_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."chat_spaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_space_members" ADD CONSTRAINT "chat_space_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_space_invites_space_created_idx" ON "chat_space_invites" USING btree ("space_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_space_invites_creator_created_idx" ON "chat_space_invites" USING btree ("created_by","created_at");--> statement-breakpoint
CREATE INDEX "chat_space_invites_target_user_idx" ON "chat_space_invites" USING btree ("target_user_id");--> statement-breakpoint
CREATE INDEX "chat_space_members_user_id_idx" ON "chat_space_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_space_members_one_owner" ON "chat_space_members" USING btree ("space_id") WHERE "chat_space_members"."role" = 'owner';--> statement-breakpoint
WITH inserted AS (
  INSERT INTO "chat_spaces" ("kind", "branch_id")
  SELECT 'branch', "id" FROM "branches"
  ON CONFLICT ("branch_id") DO NOTHING
  RETURNING "id"
)
INSERT INTO "chat_rooms" ("kind", "space_id", "name", "admin_only")
SELECT 'text', inserted."id", defaults.name, defaults.admin_only
FROM inserted CROSS JOIN (VALUES ('라운지', false), ('공지', true)) AS defaults(name, admin_only)
ON CONFLICT DO NOTHING;
