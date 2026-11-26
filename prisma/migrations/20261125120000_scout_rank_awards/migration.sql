-- Rank awards: the day a scout was handed their rank badge (model
-- ScoutRankAward), a link from each promoted Scout row to last season's row
-- (Scout.previousScoutId), and audit marks on rank awards as well as on
-- adventure records.

CREATE TABLE "ScoutRankAward" (
    "id" TEXT NOT NULL,
    "scoutId" TEXT NOT NULL,
    "rank" "Rank" NOT NULL,
    "awardedDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT,

    CONSTRAINT "ScoutRankAward_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ScoutRankAward_scoutId_rank_key" ON "ScoutRankAward"("scoutId", "rank");

ALTER TABLE "ScoutRankAward" ADD CONSTRAINT "ScoutRankAward_scoutId_fkey" FOREIGN KEY ("scoutId") REFERENCES "Scout"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScoutRankAward" ADD CONSTRAINT "ScoutRankAward_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Scout" ADD COLUMN "previousScoutId" TEXT;
CREATE UNIQUE INDEX "Scout_previousScoutId_key" ON "Scout"("previousScoutId");
ALTER TABLE "Scout" ADD CONSTRAINT "Scout_previousScoutId_fkey" FOREIGN KEY ("previousScoutId") REFERENCES "Scout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AdvancementAuditMark" ALTER COLUMN "recordId" DROP NOT NULL;
ALTER TABLE "AdvancementAuditMark" ADD COLUMN "rankAwardId" TEXT;
CREATE UNIQUE INDEX "AdvancementAuditMark_rankAwardId_key" ON "AdvancementAuditMark"("rankAwardId");
ALTER TABLE "AdvancementAuditMark" ADD CONSTRAINT "AdvancementAuditMark_rankAwardId_fkey" FOREIGN KEY ("rankAwardId") REFERENCES "ScoutRankAward"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdvancementAuditMark" ADD CONSTRAINT "AdvancementAuditMark_one_target"
    CHECK (("recordId" IS NULL) <> ("rankAwardId" IS NULL));
