-- Rules every raffle row already follows, written into the database so a
-- future bug or a hand-edit can't store a raffle the pages can't make sense
-- of. The portal enforces each of these before saving; these are a backstop.
--
--  - Raffle: at least one box, a price above zero, a winner's share of 0-100%,
--    and a prize that isn't negative.
--  - Raffle: the drawing is all or nothing. A winning box, the winner's name
--    and the fixed prize are recorded together and cleared together, and the
--    prize can only be marked paid once there is a winner.
--  - RaffleBox: box numbers start at 1.
--  - RafflePayment: an amount above zero (an IOU is not a payment row).
--
-- Each is added on its own. If adding one fails for any reason — existing
-- data that breaks it, or a constraint of that name already added by hand —
-- the failure is caught and the migration carries on without it rather than
-- failing the deploy. Prisma's schema doesn't describe CHECK constraints and
-- `prisma migrate diff` leaves them alone.
DO $$
BEGIN
  ALTER TABLE "Raffle" ADD CONSTRAINT "Raffle_terms_check"
    CHECK ("boxCount" >= 1 AND "priceCents" > 0 AND "prizePercent" BETWEEN 0 AND 100 AND ("prizeCents" IS NULL OR "prizeCents" >= 0));
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Raffle_terms_check was not added (%: %).', SQLSTATE, SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE "Raffle" ADD CONSTRAINT "Raffle_drawing_check"
    CHECK (
      ("winningBox" IS NULL) = ("winnerName" IS NULL)
      AND ("winningBox" IS NULL) = ("prizeCents" IS NULL)
      AND (NOT "prizePaid" OR "winningBox" IS NOT NULL)
    );
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Raffle_drawing_check was not added (%: %).', SQLSTATE, SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE "RaffleBox" ADD CONSTRAINT "RaffleBox_number_check" CHECK ("number" >= 1);
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'RaffleBox_number_check was not added (%: %).', SQLSTATE, SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE "RafflePayment" ADD CONSTRAINT "RafflePayment_amountCents_check" CHECK ("amountCents" > 0);
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'RafflePayment_amountCents_check was not added (%: %).', SQLSTATE, SQLERRM;
END $$;
