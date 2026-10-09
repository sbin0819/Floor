ALTER TABLE "public"."space_photos" DROP CONSTRAINT "space_photos_space_order_unique";
--> statement-breakpoint
ALTER TABLE "public"."space_photos" ADD CONSTRAINT "space_photos_space_order_unique" UNIQUE ("space_id", "sort_order") DEFERRABLE INITIALLY IMMEDIATE;
