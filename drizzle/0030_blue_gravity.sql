CREATE TYPE "public"."report_resolution" AS ENUM('dismissed', 'message_deleted', 'member_banned');--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "resolved_by" uuid;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "resolution" "report_resolution";--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reports_open_message_idx" ON "reports" USING btree ("message_id") WHERE "reports"."resolved_at" IS NULL AND "reports"."message_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolution_consistent" CHECK (("reports"."resolved_at" IS NULL) = ("reports"."resolved_by" IS NULL) AND ("reports"."resolved_at" IS NULL) = ("reports"."resolution" IS NULL));