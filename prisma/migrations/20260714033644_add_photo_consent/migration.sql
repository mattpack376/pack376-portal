-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('PENDING', 'CONSENT', 'DECLINE');

-- CreateTable
CREATE TABLE "PhotoConsent" (
    "id" TEXT NOT NULL,
    "scoutId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "facebook" "ConsentStatus" NOT NULL DEFAULT 'PENDING',
    "website" "ConsentStatus" NOT NULL DEFAULT 'PENDING',
    "fliers" "ConsentStatus" NOT NULL DEFAULT 'PENDING',
    "signedByName" TEXT,
    "signedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhotoConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PhotoConsent_scoutId_key" ON "PhotoConsent"("scoutId");

-- CreateIndex
CREATE UNIQUE INDEX "PhotoConsent_token_key" ON "PhotoConsent"("token");

-- AddForeignKey
ALTER TABLE "PhotoConsent" ADD CONSTRAINT "PhotoConsent_scoutId_fkey" FOREIGN KEY ("scoutId") REFERENCES "Scout"("id") ON DELETE CASCADE ON UPDATE CASCADE;
