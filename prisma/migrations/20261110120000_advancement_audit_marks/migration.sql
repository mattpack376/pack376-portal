-- Audits -> Advancement: an Admin's "resolved" or "needs correction" decision
-- on one advancement record. See model AdvancementAuditMark.
CREATE TYPE "AdvancementAuditMarkKind" AS ENUM ('RESOLVED', 'NEEDS_CORRECTION');

CREATE TABLE "AdvancementAuditMark" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "kind" "AdvancementAuditMarkKind" NOT NULL,
    "note" TEXT NOT NULL,
    "recordUpdatedAt" TIMESTAMP(3) NOT NULL,
    "markedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdvancementAuditMark_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdvancementAuditMark_recordId_key" ON "AdvancementAuditMark"("recordId");

ALTER TABLE "AdvancementAuditMark" ADD CONSTRAINT "AdvancementAuditMark_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "AdvancementRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AdvancementAuditMark" ADD CONSTRAINT "AdvancementAuditMark_markedByUserId_fkey" FOREIGN KEY ("markedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
