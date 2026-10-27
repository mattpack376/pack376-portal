-- One-time key from the guest sign-up form that created each group, so the
-- same form sent twice makes one group (see src/lib/guestGroupLimits.ts).
-- Every existing row gets NULL, and NULLs never collide in a unique index, so
-- this applies cleanly whatever is already in the table.

-- AlterTable
ALTER TABLE "EventGuestGroup" ADD COLUMN     "submissionKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "EventGuestGroup_submissionKey_key" ON "EventGuestGroup"("submissionKey");

-- Headcounts and the amount owed can't be negative. The forms have always
-- refused negatives, so no row should break this; if one somehow does, the
-- constraint is skipped instead of failing the deploy, and can be added by
-- hand once that row is fixed. Not in schema.prisma, which has no way to
-- express a CHECK constraint (Prisma leaves it alone).
--
-- `prisma migrate deploy` doesn't print the NOTICE below, so a skip is
-- silent in the deploy log. To check before deploying (no rows = it will be
-- added):
--   SELECT id FROM "EventGuestGroup"
--   WHERE "adultCount" < 0 OR "childCount" < 0 OR "amountOwedCents" < 0;
-- and after (one row = it was added):
--   SELECT conname FROM pg_constraint
--   WHERE conname = 'EventGuestGroup_nonnegative_check';
-- Adding the constraint NOT VALID instead would not be safer: the
-- ON DELETE SET NULL links (Guest Of, Added By) update the old row when a
-- scout or login is deleted, and that update would then fail.
DO $$
BEGIN
  LOCK TABLE "EventGuestGroup" IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (
    SELECT 1 FROM "EventGuestGroup"
    WHERE "adultCount" < 0 OR "childCount" < 0 OR "amountOwedCents" < 0
  ) THEN
    RAISE NOTICE 'EventGuestGroup has a row with a negative headcount or amount owed; skipped adding EventGuestGroup_nonnegative_check.';
  ELSE
    ALTER TABLE "EventGuestGroup"
      ADD CONSTRAINT "EventGuestGroup_nonnegative_check"
      CHECK ("adultCount" >= 0 AND "childCount" >= 0 AND "amountOwedCents" >= 0);
  END IF;
END $$;
