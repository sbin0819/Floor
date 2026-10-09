ALTER TABLE "space_blocks" ADD CONSTRAINT "space_blocks_no_overlap"
EXCLUDE USING gist ("space_id" WITH =, "during" WITH &&);
