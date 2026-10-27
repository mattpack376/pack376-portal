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
-- Existing data decides whether it can be added. If any raffle already has two
-- buyers whose names differ only in case, building the index fails; that is
-- caught below and the migration carries on WITHOUT the index rather than
-- failing the deploy. The portal's own check still applies either way. To add
-- the index later, rename one of each pair on the raffle page (a last name or
-- initial) and run the CREATE UNIQUE INDEX statement below by hand.
DO $$
BEGIN
  CREATE UNIQUE INDEX "RaffleEntry_raffleId_name_key" ON "RaffleEntry" ("raffleId", lower(btrim("name")));
EXCEPTION
  WHEN unique_violation THEN
    RAISE NOTICE 'RaffleEntry_raffleId_name_key was not created: some raffle has two buyers with the same name (ignoring case). Rename them, then create the index by hand.';
END $$;
