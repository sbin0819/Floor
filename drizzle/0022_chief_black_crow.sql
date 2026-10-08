CREATE TYPE "public"."avatar_color" AS ENUM('blue', 'green', 'orange', 'purple', 'pink', 'teal', 'yellow', 'gray');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_color" "avatar_color";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_photo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "chat_toasts" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tab_badge" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "reminder_minutes" smallint[] DEFAULT '{30,10,5,0}'::smallint[] NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_reminder_minutes_valid" CHECK ("users"."reminder_minutes" <@ '{30,10,5,0}'::smallint[]);