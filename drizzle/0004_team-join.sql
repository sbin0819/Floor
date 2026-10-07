CREATE TYPE "public"."join_request_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TABLE "team_join_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"message" text,
	"status" "join_request_status" DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "team_invites" ADD COLUMN "message" text;--> statement-breakpoint
ALTER TABLE "team_invites" ADD COLUMN "declined_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "team_invites" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "team_members" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "home_branch_id" uuid;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "headcount" integer;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "team_join_requests" ADD CONSTRAINT "team_join_requests_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_join_requests" ADD CONSTRAINT "team_join_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_join_requests" ADD CONSTRAINT "team_join_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "team_join_requests_one_pending" ON "team_join_requests" USING btree ("team_id","user_id") WHERE "team_join_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "team_join_requests_user_id_idx" ON "team_join_requests" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_home_branch_id_branches_id_fk" FOREIGN KEY ("home_branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "team_invites_one_pending" ON "team_invites" USING btree ("team_id","email") WHERE "team_invites"."email" is not null and "team_invites"."accepted_at" is null and "team_invites"."declined_at" is null and "team_invites"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "team_invites_email_idx" ON "team_invites" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_name_unique" ON "teams" USING btree (lower("name"));--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_headcount_valid" CHECK ("teams"."headcount" is null or "teams"."headcount" between 1 and 1000);