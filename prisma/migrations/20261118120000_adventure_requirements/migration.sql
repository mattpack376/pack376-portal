-- Per-requirement tracking under each adventure. AdventureRequirement holds the
-- official requirements (loaded by the next migration); RequirementRecord is a
-- scout's check on one of them. AdvancementRecord is unchanged and stays the
-- source of truth for whether an adventure is complete.
-- AlterTable
ALTER TABLE "Adventure" ADD COLUMN     "requirementsNote" TEXT,
ADD COLUMN     "requirementsPick" INTEGER;

-- CreateTable
CREATE TABLE "AdventureRequirement" (
    "id" TEXT NOT NULL,
    "adventureId" TEXT NOT NULL,
    "parentId" TEXT,
    "code" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "pick" INTEGER,
    "isGroup" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "AdventureRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequirementRecord" (
    "id" TEXT NOT NULL,
    "scoutId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedDate" DATE,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT,

    CONSTRAINT "RequirementRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdventureRequirement_parentId_idx" ON "AdventureRequirement"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "AdventureRequirement_adventureId_code_key" ON "AdventureRequirement"("adventureId", "code");

-- CreateIndex
CREATE INDEX "RequirementRecord_requirementId_idx" ON "RequirementRecord"("requirementId");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementRecord_scoutId_requirementId_key" ON "RequirementRecord"("scoutId", "requirementId");

-- AddForeignKey
ALTER TABLE "AdventureRequirement" ADD CONSTRAINT "AdventureRequirement_adventureId_fkey" FOREIGN KEY ("adventureId") REFERENCES "Adventure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdventureRequirement" ADD CONSTRAINT "AdventureRequirement_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "AdventureRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementRecord" ADD CONSTRAINT "RequirementRecord_scoutId_fkey" FOREIGN KEY ("scoutId") REFERENCES "Scout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementRecord" ADD CONSTRAINT "RequirementRecord_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "AdventureRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementRecord" ADD CONSTRAINT "RequirementRecord_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

