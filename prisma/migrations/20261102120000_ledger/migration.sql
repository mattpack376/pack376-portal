-- The pack's bank ledger (/portal/admin/ledger), kept by the two ledger
-- accounts (LEDGER_USERNAMES in src/lib/masterAdmins.ts). Brand-new, empty
-- tables, so the CHECKs below can't trip on old rows and need no guarded DO
-- blocks. They back up rules src/lib/actions/ledger.ts already keeps.
--
-- After deploying, the site's limited database login needs the usual grants
-- on the four new tables (docs/security-operations.md §2.2).

-- CreateEnum
CREATE TYPE "LedgerDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "LedgerCategoryKind" AS ENUM ('FUND', 'EVENT');

-- CreateEnum
CREATE TYPE "LedgerEntryOrigin" AS ENUM ('MANUAL', 'IMPORTED', 'SNAPSHOT');

-- CreateTable
CREATE TABLE "LedgerCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "kind" "LedgerCategoryKind" NOT NULL DEFAULT 'FUND',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LedgerCategory_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LedgerCategory_name_check" CHECK (char_length(btrim("name")) BETWEEN 1 AND 60),
    CONSTRAINT "LedgerCategory_nameKey_check" CHECK (char_length("nameKey") BETWEEN 1 AND 60)
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "entryDate" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "note" TEXT,
    "origin" "LedgerEntryOrigin" NOT NULL DEFAULT 'MANUAL',
    "transferId" TEXT,
    "importBatchId" TEXT,
    "importRowNumber" INTEGER,
    "createdByUserId" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedByName" TEXT,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id"),
    -- Positive whole cents, at most MAX_CENTS ($1,000,000; src/lib/formValues.ts).
    CONSTRAINT "LedgerEntry_amountCents_check" CHECK ("amountCents" > 0 AND "amountCents" <= 100000000),
    CONSTRAINT "LedgerEntry_description_check" CHECK (char_length(btrim("description")) BETWEEN 1 AND 200),
    -- MAX_NOTE_LENGTH.
    CONSTRAINT "LedgerEntry_note_check" CHECK ("note" IS NULL OR char_length("note") <= 2000),
    -- An imported line always names its import, and only an imported line does.
    CONSTRAINT "LedgerEntry_import_check" CHECK (("importBatchId" IS NULL) = ("origin" <> 'IMPORTED')),
    CONSTRAINT "LedgerEntry_importRowNumber_check" CHECK ("importRowNumber" IS NULL OR "importRowNumber" > 0)
);

-- CreateTable
CREATE TABLE "LedgerImportBatch" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "sourceLabel" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "inflowCents" INTEGER NOT NULL,
    "outflowCents" INTEGER NOT NULL,
    "importedByName" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undoneAt" TIMESTAMP(3),
    "undoneByName" TEXT,

    CONSTRAINT "LedgerImportBatch_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LedgerImportBatch_totals_check" CHECK ("rowCount" >= 0 AND "inflowCents" >= 0 AND "outflowCents" >= 0)
);

-- CreateTable
CREATE TABLE "LedgerSettings" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "cutoverDate" DATE,
    "syncEnabled" BOOLEAN NOT NULL DEFAULT true,
    "spreadsheetId" TEXT,
    "sheetTabId" INTEGER,
    "syncRequestedAt" TIMESTAMP(3),
    "syncedThrough" TIMESTAMP(3),
    "syncLeaseUntil" TIMESTAMP(3),
    "lastSyncAttemptAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "lastSyncRowCount" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LedgerSettings_pkey" PRIMARY KEY ("id"),
    -- One row of settings, always "main".
    CONSTRAINT "LedgerSettings_singleton_check" CHECK ("id" = 'main'),
    CONSTRAINT "LedgerSettings_lastSyncError_check" CHECK ("lastSyncError" IS NULL OR char_length("lastSyncError") <= 500)
);

-- CreateIndex
CREATE UNIQUE INDEX "LedgerCategory_nameKey_key" ON "LedgerCategory"("nameKey");

-- CreateIndex
CREATE INDEX "LedgerEntry_entryDate_idx" ON "LedgerEntry"("entryDate");

-- CreateIndex
CREATE INDEX "LedgerEntry_categoryId_idx" ON "LedgerEntry"("categoryId");

-- CreateIndex
CREATE INDEX "LedgerEntry_transferId_idx" ON "LedgerEntry"("transferId");

-- CreateIndex
CREATE INDEX "LedgerEntry_importBatchId_idx" ON "LedgerEntry"("importBatchId");

-- CreateIndex
CREATE INDEX "LedgerImportBatch_fingerprint_idx" ON "LedgerImportBatch"("fingerprint");

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "LedgerCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "LedgerImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
