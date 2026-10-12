-- The Camp Conron October 2026 raffle was imported from a record file that
-- didn't say how or when the prize was handed over. The organizer has since
-- confirmed it: cash, on October 11, 2026. This only fills the blanks — if the
-- payout details were already entered on the page, they are left alone, and on
-- a database without that raffle it changes nothing.
UPDATE "Raffle"
SET "prizePaidOn" = DATE '2026-10-11',
    "prizePaidMethod" = 'CASH'
WHERE "name" LIKE 'Camp Conron 50/50 Raffle%'
  AND "drawingDate" = DATE '2026-10-10'
  AND "winningBox" = 28
  AND "prizePaid" = true
  AND "prizePaidOn" IS NULL
  AND "prizePaidMethod" IS NULL;
