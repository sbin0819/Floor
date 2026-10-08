CREATE TYPE "public"."attachment_kind" AS ENUM('file', 'image');--> statement-breakpoint
CREATE TABLE "message_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"uploader_id" uuid NOT NULL,
	"message_id" uuid,
	"position" smallint,
	"storage_key" text NOT NULL,
	"name" text NOT NULL,
	"size" bigint NOT NULL,
	"content_type" text NOT NULL,
	"kind" "attachment_kind" DEFAULT 'file' NOT NULL,
	"width" integer,
	"height" integer,
	"uploaded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_attachments_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "message_attachments_position_range" CHECK ("message_attachments"."position" BETWEEN 0 AND 9),
	CONSTRAINT "message_attachments_name_length" CHECK (char_length("message_attachments"."name") BETWEEN 1 AND 200),
	CONSTRAINT "message_attachments_size_range" CHECK ("message_attachments"."size" BETWEEN 1 AND 26214400),
	CONSTRAINT "message_attachments_attached" CHECK ("message_attachments"."message_id" IS NULL OR ("message_attachments"."position" IS NOT NULL AND "message_attachments"."uploaded_at" IS NOT NULL)),
	CONSTRAINT "message_attachments_image_size" CHECK (("message_attachments"."kind" = 'image' AND "message_attachments"."width" IS NOT NULL AND "message_attachments"."height" IS NOT NULL AND "message_attachments"."width" >= 1 AND "message_attachments"."height" >= 1) OR ("message_attachments"."kind" = 'file' AND "message_attachments"."width" IS NULL AND "message_attachments"."height" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_body_length";--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_room_id_chat_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."chat_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "message_attachments_position_unique" ON "message_attachments" USING btree ("message_id","position") WHERE "message_attachments"."message_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "message_attachments_message_id_idx" ON "message_attachments" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "message_attachments_uploader_created_idx" ON "message_attachments" USING btree ("uploader_id","created_at");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_body_length" CHECK (("messages"."deleted_at" IS NULL AND (("messages"."kind" = 'text' AND char_length("messages"."body") BETWEEN 0 AND 4000) OR ("messages"."kind" = 'system' AND char_length("messages"."body") BETWEEN 1 AND 4000))) OR ("messages"."deleted_at" IS NOT NULL AND "messages"."body" = ''));