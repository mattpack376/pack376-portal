-- Receipts: a submission key so a retried Download/Email can't save a second
-- copy, the status of the latest email attempt (written before the email is
-- handed to Resend), and the PDF exactly as issued.
--
-- Additive only. Every new Receipt column is nullable, so existing rows need
-- no value; the unique index is safe on existing data because they all start
-- with a NULL key, which a unique index allows any number of.

-- CreateEnum
CREATE TYPE "ReceiptEmailStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "Receipt" ADD COLUMN     "emailAttemptAt" TIMESTAMP(3),
ADD COLUMN     "emailAttemptId" TEXT,
ADD COLUMN     "emailAttemptKey" TEXT,
ADD COLUMN     "emailAttemptTo" TEXT,
ADD COLUMN     "emailError" TEXT,
ADD COLUMN     "emailStatus" "ReceiptEmailStatus",
ADD COLUMN     "idempotencyKey" TEXT;

-- Before this change a receipt was saved as emailed only once Resend had
-- accepted the email, so every row with an address on it was a sent one.
UPDATE "Receipt"
SET "emailStatus" = 'SENT',
    "emailAttemptTo" = "emailedTo",
    "emailAttemptAt" = "emailedAt"
WHERE "emailedTo" IS NOT NULL;

-- CreateTable
CREATE TABLE "ReceiptDocument" (
    "receiptId" TEXT NOT NULL,
    "pdf" BYTEA NOT NULL,
    "sha256" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceiptDocument_pkey" PRIMARY KEY ("receiptId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_idempotencyKey_key" ON "Receipt"("idempotencyKey");

-- AddForeignKey
ALTER TABLE "ReceiptDocument" ADD CONSTRAINT "ReceiptDocument_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
