CREATE TABLE "chat_room_reads" (
	"room_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"last_read_seq" bigint NOT NULL,
	"muted" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_room_reads_room_id_user_id_pk" PRIMARY KEY("room_id","user_id"),
	CONSTRAINT "chat_room_reads_seq_valid" CHECK ("chat_room_reads"."last_read_seq" >= 0)
);
--> statement-breakpoint
ALTER TABLE "chat_room_reads" ADD CONSTRAINT "chat_room_reads_room_id_chat_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."chat_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_room_reads" ADD CONSTRAINT "chat_room_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;