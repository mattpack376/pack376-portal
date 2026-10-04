-- Den leader changes for 2026-27: Skylar Moeller now leads both the Lions and
-- the Tigers, Nicole Scivioli moves to the Bears (Jeanne Drago, the old Tiger
-- leader, was never on this list). Matched on name rather than the seed ids in
-- case either row was re-created through the admin page. sortOrder is swapped
-- so the section keeps reading in den order (Lion/Tiger before Bear); it isn't
-- an admin input, so this is the only place to change it.
UPDATE "AdultLeader"
SET "positions" = ARRAY['Lion Den Leader', 'Tiger Den Leader'], "sortOrder" = 3, "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'Skylar Moeller';

UPDATE "AdultLeader"
SET "positions" = ARRAY['Bear Den Leader'], "sortOrder" = 4, "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'Nicole Scivioli';
