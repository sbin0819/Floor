CREATE TABLE "space_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"path" text NOT NULL,
	"alt" text NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "space_photos_space_order_unique" UNIQUE("space_id","sort_order"),
	CONSTRAINT "space_photos_sort_order_range" CHECK ("space_photos"."sort_order" between 0 and 9),
	CONSTRAINT "space_photos_path_format" CHECK ("space_photos"."path" ~ '^/[a-z0-9/_-]+\.(webp|png|jpg)$' and "space_photos"."path" !~ '//'),
	CONSTRAINT "space_photos_alt_length" CHECK (char_length("space_photos"."alt") between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "cover_photo_path" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "cover_photo_alt" text;--> statement-breakpoint
ALTER TABLE "space_photos" ADD CONSTRAINT "space_photos_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_cover_photo_pair" CHECK (("branches"."cover_photo_path" is null) = ("branches"."cover_photo_alt" is null));--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_cover_photo_path_format" CHECK ("branches"."cover_photo_path" is null or ("branches"."cover_photo_path" ~ '^/[a-z0-9/_-]+\.(webp|png|jpg)$' and "branches"."cover_photo_path" !~ '//'));--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_cover_photo_alt_length" CHECK ("branches"."cover_photo_alt" is null or char_length("branches"."cover_photo_alt") between 1 and 120);