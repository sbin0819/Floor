ALTER TYPE "public"."notification_type" ADD VALUE 'team_removed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'team_role_changed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'team_deleted';--> statement-breakpoint
DROP INDEX "teams_name_unique";--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "teams_name_unique" ON "teams" USING btree (lower("name")) WHERE "teams"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_deleted_consistent" CHECK (("teams"."deleted_at" is null) = ("teams"."deleted_by" is null));