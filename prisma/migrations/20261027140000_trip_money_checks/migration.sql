-- Database guards for rules the trip actions already keep (see
-- src/lib/actions/tripRegistration.ts and tripPage.ts), so no future code
-- path can store a registration that both "waits for the price" and owes
-- money, or a negative price, amount or headcount.
--
-- Nothing in the app has ever written such a row, but this runs against
-- existing production data it hasn't seen: each constraint is added only if
-- no current row breaks it. If one does, the constraint is skipped with a
-- NOTICE in the deploy log rather than failing the deploy, and the row can be
-- fixed by hand and this block run again (it skips constraints already
-- there). Additive only; no data is changed.

DO $$
BEGIN
  -- A registration still waiting for the price owes nothing yet: its $0 is a
  -- placeholder. Posting the price, or an admin typing an amount, sets the
  -- amount and clears the flag together.
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TripRegistration_pending_owes_nothing') THEN
    NULL;
  ELSIF EXISTS (SELECT 1 FROM "TripRegistration" WHERE "owedPending" AND "amountOwedCents" <> 0) THEN
    RAISE NOTICE 'Skipped TripRegistration_pending_owes_nothing: a registration waiting for a price has a nonzero amount owed.';
  ELSE
    BEGIN
      ALTER TABLE "TripRegistration"
        ADD CONSTRAINT "TripRegistration_pending_owes_nothing" CHECK (NOT "owedPending" OR "amountOwedCents" = 0);
    EXCEPTION WHEN check_violation THEN
      RAISE NOTICE 'Skipped TripRegistration_pending_owes_nothing: a row written during the deploy breaks it.';
    END;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TripRegistration_amounts_nonnegative') THEN
    NULL;
  ELSIF EXISTS (SELECT 1 FROM "TripRegistration" WHERE "amountOwedCents" < 0 OR "payingCount" < 0 OR "freeCount" < 0) THEN
    RAISE NOTICE 'Skipped TripRegistration_amounts_nonnegative: a registration has a negative amount owed or headcount.';
  ELSE
    BEGIN
      ALTER TABLE "TripRegistration"
        ADD CONSTRAINT "TripRegistration_amounts_nonnegative"
        CHECK ("amountOwedCents" >= 0 AND "payingCount" >= 0 AND "freeCount" >= 0);
    EXCEPTION WHEN check_violation THEN
      RAISE NOTICE 'Skipped TripRegistration_amounts_nonnegative: a row written during the deploy breaks it.';
    END;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TripPage_prices_nonnegative') THEN
    NULL;
  ELSIF EXISTS (SELECT 1 FROM "TripPage" WHERE "regularPriceCents" < 0 OR "earlyBirdPriceCents" < 0) THEN
    RAISE NOTICE 'Skipped TripPage_prices_nonnegative: a trip has a negative price.';
  ELSE
    BEGIN
      ALTER TABLE "TripPage"
        ADD CONSTRAINT "TripPage_prices_nonnegative"
        CHECK ("regularPriceCents" >= 0 AND ("earlyBirdPriceCents" IS NULL OR "earlyBirdPriceCents" >= 0));
    EXCEPTION WHEN check_violation THEN
      RAISE NOTICE 'Skipped TripPage_prices_nonnegative: a row written during the deploy breaks it.';
    END;
  END IF;
END $$;
