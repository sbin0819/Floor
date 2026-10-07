ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap
EXCLUDE USING gist (space_id WITH =, during WITH &&)
WHERE (status = 'confirmed');
