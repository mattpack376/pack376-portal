-- CreateEnum
CREATE TYPE "SignerRelationship" AS ENUM ('PARENT', 'GUARDIAN', 'GRANDPARENT', 'AUNT_UNCLE', 'ADULT_SIBLING');

-- AlterTable
ALTER TABLE "PhotoConsent" ADD COLUMN     "signedRelationship" "SignerRelationship";
