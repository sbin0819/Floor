CREATE TYPE "public"."notification_type" AS ENUM('booking_invited', 'booking_changed', 'booking_cancelled', 'booking_removed', 'participant_left', 'booking_reminder');--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"booking_id" uuid,
	"actor_id" uuid,
	"data" jsonb NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_user_scheduled_idx" ON "notifications" USING btree ("user_id","scheduled_for" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_unread_user_idx" ON "notifications" USING btree ("user_id") WHERE "notifications"."read_at" is null;--> statement-breakpoint
CREATE INDEX "notifications_booking_id_idx" ON "notifications" USING btree ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_reminder_unique" ON "notifications" USING btree ("user_id","booking_id","scheduled_for") WHERE "notifications"."type" = 'booking_reminder';