-- Uploaded Blob objects still waiting to be deleted (src/lib/blobCleanup.ts).
-- A new, empty table: nothing existing is read or changed, so this is safe to
-- apply to a database with data in it.

-- CreateTable
CREATE TABLE "PendingBlobDeletion" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingBlobDeletion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PendingBlobDeletion_url_key" ON "PendingBlobDeletion"("url");

-- CreateIndex
CREATE INDEX "PendingBlobDeletion_nextAttemptAt_idx" ON "PendingBlobDeletion"("nextAttemptAt");
