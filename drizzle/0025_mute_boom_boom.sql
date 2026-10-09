CREATE TYPE "public"."booking_cancel_kind" AS ENUM('operator', 'maintenance');--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "cancel_kind" "booking_cancel_kind";--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_cancel_kind_consistent" CHECK (("bookings"."cancel_kind" IS NULL OR "bookings"."status" = 'cancelled') AND (("bookings"."cancel_kind" IS NULL) = ("bookings"."cancel_reason" IS NULL)));--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_cancel_reason_length" CHECK ("bookings"."cancel_reason" IS NULL OR char_length("bookings"."cancel_reason") BETWEEN 1 AND 200);