-- Parent accounts never see the 50/50 raffles. Raffle Helper used to be
-- grantable to a PARENT login; take it away from any that held it.
UPDATE "User" SET "raffleHelper" = false WHERE "role" = 'PARENT' AND "raffleHelper" = true;
