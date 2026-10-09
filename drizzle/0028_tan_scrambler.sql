ALTER TABLE "floor_plans" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "floor_plans" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "floor_plans" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "floor_plans" ADD CONSTRAINT "floor_plans_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floor_plans" ADD CONSTRAINT "floor_plans_revision_nonnegative" CHECK ("floor_plans"."revision" >= 0);