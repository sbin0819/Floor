CREATE TABLE "booking_participants" (
	"booking_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "booking_participants_booking_id_user_id_pk" PRIMARY KEY("booking_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "booking_participants" ADD CONSTRAINT "booking_participants_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_participants" ADD CONSTRAINT "booking_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_participants_user_id_idx" ON "booking_participants" USING btree ("user_id");