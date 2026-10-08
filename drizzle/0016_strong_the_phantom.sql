CREATE TYPE "public"."chat_member_status" AS ENUM('active', 'requested', 'declined', 'left');--> statement-breakpoint
CREATE TYPE "public"."friendship_status" AS ENUM('pending', 'accepted', 'declined', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'friend_request';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'friend_accepted';--> statement-breakpoint
CREATE TABLE "chat_room_members" (
	"room_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "chat_member_status" NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	"status_changed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_room_members_room_id_user_id_pk" PRIMARY KEY("room_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "friendships" (
	"user_low_id" uuid NOT NULL,
	"user_high_id" uuid NOT NULL,
	"status" "friendship_status" NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"status_changed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friendships_user_low_id_user_high_id_pk" PRIMARY KEY("user_low_id","user_high_id"),
	CONSTRAINT "friendships_order" CHECK ("friendships"."user_low_id" < "friendships"."user_high_id"),
	CONSTRAINT "friendships_requester" CHECK ("friendships"."requested_by" IN ("friendships"."user_low_id", "friendships"."user_high_id"))
);
--> statement-breakpoint
ALTER TABLE "chat_rooms" DROP CONSTRAINT "chat_rooms_kind_ref";--> statement-breakpoint
ALTER TABLE "chat_rooms" ADD COLUMN "dm_low_user_id" uuid;--> statement-breakpoint
ALTER TABLE "chat_rooms" ADD COLUMN "dm_high_user_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "username_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chat_room_members" ADD CONSTRAINT "chat_room_members_room_id_chat_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."chat_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_room_members" ADD CONSTRAINT "chat_room_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_low_id_users_id_fk" FOREIGN KEY ("user_low_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_high_id_users_id_fk" FOREIGN KEY ("user_high_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_room_members_user_id_idx" ON "chat_room_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "friendships_user_high_id_idx" ON "friendships" USING btree ("user_high_id");--> statement-breakpoint
CREATE INDEX "friendships_requester_idx" ON "friendships" USING btree ("requested_by","requested_at");--> statement-breakpoint
ALTER TABLE "chat_rooms" ADD CONSTRAINT "chat_rooms_dm_low_user_id_users_id_fk" FOREIGN KEY ("dm_low_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_rooms" ADD CONSTRAINT "chat_rooms_dm_high_user_id_users_id_fk" FOREIGN KEY ("dm_high_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_rooms_dm_pair_unique" ON "chat_rooms" USING btree ("dm_low_user_id","dm_high_user_id") WHERE "chat_rooms"."kind" = 'dm';--> statement-breakpoint
CREATE INDEX "chat_rooms_dm_high_user_id_idx" ON "chat_rooms" USING btree ("dm_high_user_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_username_unique" UNIQUE("username");--> statement-breakpoint
ALTER TABLE "chat_rooms" ADD CONSTRAINT "chat_rooms_kind_ref" CHECK (("chat_rooms"."kind" IN ('text', 'voice') AND "chat_rooms"."space_id" IS NOT NULL AND "chat_rooms"."name" IS NOT NULL AND "chat_rooms"."dm_low_user_id" IS NULL AND "chat_rooms"."dm_high_user_id" IS NULL) OR ("chat_rooms"."kind" = 'dm' AND "chat_rooms"."dm_low_user_id" IS NOT NULL AND "chat_rooms"."dm_high_user_id" IS NOT NULL AND "chat_rooms"."dm_low_user_id" < "chat_rooms"."dm_high_user_id" AND "chat_rooms"."space_id" IS NULL AND "chat_rooms"."name" IS NULL) OR "chat_rooms"."kind" IN ('group_dm', 'meeting'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_username_format" CHECK ("users"."username" ~ '^[a-z0-9._]{3,20}$');