-- Receipts: a submission key so a retried Download/Email can't save a second
-- copy, a record of every email request (written before the email is handed
-- to Resend) so a retried request can't send a second copy, and the PDF
-- exactly as issued.
--
-- Additive only. The one new Receipt column is nullable, so existing rows
-- need no value; its unique index is safe on existing data because they all
-- start with a NULL key, which a unique index allows any number of. The two
-- new tables start empty: receipts emailed before this change keep showing
-- their emailedTo/emailedAt as before and have no request to retry.

-- CreateEnum
CREATE TYPE "ReceiptEmailStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "Receipt" ADD COLUMN     "idempotencyKey" TEXT;

-- CreateTable
CREATE TABLE "ReceiptDocument" (
    "receiptId" TEXT NOT NULL,
    "pdf" BYTEA NOT NULL,
    "sha256" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceiptDocument_pkey" PRIMARY KEY ("receiptId")
);

-- CreateTable
CREATE TABLE "ReceiptEmailAttempt" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "addressKey" TEXT NOT NULL,
    "status" "ReceiptEmailStatus" NOT NULL,
    "tryCount" INTEGER NOT NULL DEFAULT 1,
    "providerKey" TEXT NOT NULL,
    "providerKeyAt" TIMESTAMP(3) NOT NULL,
    "mayHaveSent" BOOLEAN NOT NULL DEFAULT false,
    "replyTo" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceiptEmailAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_idempotencyKey_key" ON "Receipt"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ReceiptEmailAttempt_receiptId_requestKey_addressKey_key" ON "ReceiptEmailAttempt"("receiptId", "requestKey", "addressKey");

-- AddForeignKey
ALTER TABLE "ReceiptDocument" ADD CONSTRAINT "ReceiptDocument_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptEmailAttempt" ADD CONSTRAINT "ReceiptEmailAttempt_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
