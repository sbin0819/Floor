ALTER TABLE "chat_rooms" DROP CONSTRAINT "chat_rooms_kind_ref";--> statement-breakpoint
ALTER TABLE "booking_participants" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_rooms" ADD COLUMN "booking_id" uuid;--> statement-breakpoint
ALTER TABLE "chat_rooms" ADD CONSTRAINT "chat_rooms_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_rooms" ADD CONSTRAINT "chat_rooms_booking_unique" UNIQUE("booking_id");--> statement-breakpoint
ALTER TABLE "chat_rooms" ADD CONSTRAINT "chat_rooms_kind_ref" CHECK (("chat_rooms"."kind" IN ('text', 'voice') AND "chat_rooms"."space_id" IS NOT NULL AND "chat_rooms"."name" IS NOT NULL AND "chat_rooms"."dm_low_user_id" IS NULL AND "chat_rooms"."dm_high_user_id" IS NULL AND "chat_rooms"."booking_id" IS NULL) OR ("chat_rooms"."kind" = 'dm' AND "chat_rooms"."dm_low_user_id" IS NOT NULL AND "chat_rooms"."dm_high_user_id" IS NOT NULL AND "chat_rooms"."dm_low_user_id" < "chat_rooms"."dm_high_user_id" AND "chat_rooms"."space_id" IS NULL AND "chat_rooms"."name" IS NULL AND "chat_rooms"."booking_id" IS NULL) OR ("chat_rooms"."kind" = 'group_dm' AND "chat_rooms"."space_id" IS NULL AND "chat_rooms"."dm_low_user_id" IS NULL AND "chat_rooms"."dm_high_user_id" IS NULL AND "chat_rooms"."booking_id" IS NULL) OR ("chat_rooms"."kind" = 'meeting' AND "chat_rooms"."booking_id" IS NOT NULL AND "chat_rooms"."space_id" IS NULL AND "chat_rooms"."name" IS NULL AND "chat_rooms"."dm_low_user_id" IS NULL AND "chat_rooms"."dm_high_user_id" IS NULL));
--> statement-breakpoint
INSERT INTO "chat_rooms" ("kind", "booking_id")
SELECT 'meeting', b.id
FROM "bookings" b INNER JOIN "spaces" s ON s.id = b.space_id
WHERE b.status = 'confirmed' AND upper(b.during) > now() - interval '24 hours'
  AND s.type <> 'desk'
ON CONFLICT ("booking_id") DO NOTHING;
