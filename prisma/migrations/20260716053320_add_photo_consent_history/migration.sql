-- CreateTable
CREATE TABLE "PhotoConsentHistory" (
    "id" TEXT NOT NULL,
    "photoConsentId" TEXT NOT NULL,
    "facebook" "ConsentStatus" NOT NULL,
    "website" "ConsentStatus" NOT NULL,
    "fliers" "ConsentStatus" NOT NULL,
    "signedByName" TEXT NOT NULL,
    "signedRelationship" "SignerRelationship" NOT NULL,
    "signedDate" DATE NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhotoConsentHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PhotoConsentHistory_photoConsentId_idx" ON "PhotoConsentHistory"("photoConsentId");

-- AddForeignKey
ALTER TABLE "PhotoConsentHistory" ADD CONSTRAINT "PhotoConsentHistory_photoConsentId_fkey" FOREIGN KEY ("photoConsentId") REFERENCES "PhotoConsent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
