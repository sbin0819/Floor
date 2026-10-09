ALTER TYPE "public"."notification_type" ADD VALUE 'branch_announcement';--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"lounge_message_id" uuid,
	"audience" jsonb,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "announcements_text_length" CHECK (char_length("announcements"."title") between 1 and 60 and char_length("announcements"."body") between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_lounge_message_id_messages_id_fk" FOREIGN KEY ("lounge_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcements_branch_created_idx" ON "announcements" USING btree ("branch_id","created_at" DESC NULLS LAST);