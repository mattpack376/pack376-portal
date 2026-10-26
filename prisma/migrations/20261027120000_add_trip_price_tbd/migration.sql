-- AlterTable
ALTER TABLE "TripPage" ADD COLUMN "priceTbd" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "TripRegistration" ADD COLUMN "owedPending" BOOLEAN NOT NULL DEFAULT false;

-- The Brooklyn Cyclones Overnight starts with its price unreleased. Any
-- registration already on it was priced at the $0 placeholder, so it is
-- pending too rather than reading as paid in full.
UPDATE "TripPage" SET "priceTbd" = true WHERE "slug" = 'cyclones';

UPDATE "TripRegistration" SET "owedPending" = true
WHERE "amountOwedCents" = 0
  AND "payingCount" > 0
  AND "tripPageId" IN (SELECT "id" FROM "TripPage" WHERE "slug" = 'cyclones');
