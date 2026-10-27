-- Reset/invite link generations (see src/lib/resetTokens.ts).
--
-- Additive only. Both columns default to 0, so every existing account starts
-- at generation 0 and every link already sitting in someone's inbox reads 0
-- too: links issued before this migration keep working until they expire or
-- are used, exactly as before. The next link issued for an account (or its
-- next Admin reset or completed link) moves the account to generation 1 and
-- leaves the older links behind. A constant default makes each ADD COLUMN a
-- catalog-only change on Postgres 11+, so neither table is rewritten.

-- AlterTable
ALTER TABLE "PasswordResetToken" ADD COLUMN     "credentialVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "credentialVersion" INTEGER NOT NULL DEFAULT 0;
