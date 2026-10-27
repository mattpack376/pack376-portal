-- A buyer on a raffle is identified by name: selling to a name already on
-- the raffle (ignoring case and spaces at either end) adds boxes to that
-- buyer, and editing a buyer refuses a name another buyer there has. The
-- portal checks that under a lock on the raffle row (src/lib/actions/raffles.ts);
-- this unique index on the same normalized name backs it up in the database.
--
-- Prisma's schema can't describe an index on an expression, so it lives only
-- here. (`prisma migrate diff` leaves expression indexes alone, so a later
-- migration won't drop it.)
--
-- Existing data decides whether it can be added, and this migration must
-- never fail a deploy over it: the index is only a backup. If building it
-- fails for any reason — most likely two buyers on one raffle whose names
-- differ only in case, or a name too long for an index entry (names had no
-- length limit before) — the error is caught and the migration carries on
-- WITHOUT the index. The portal's own check applies either way. To add the
-- index later, fix the names on the raffle page (a last name or initial for
-- namesakes) and run the CREATE UNIQUE INDEX statement below by hand. (After
-- shortening a too-long name, run VACUUM "RaffleEntry" first: building an
-- index also reads the old version of a row changed only a moment ago.)
DO $$
BEGIN
  CREATE UNIQUE INDEX "RaffleEntry_raffleId_name_key" ON "RaffleEntry" ("raffleId", lower(btrim("name")));
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'RaffleEntry_raffleId_name_key was not created (%: %). Rename the buyers involved, then create the index by hand.', SQLSTATE, SQLERRM;
END $$;
