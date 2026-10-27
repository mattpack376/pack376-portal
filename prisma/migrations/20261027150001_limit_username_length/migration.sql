-- No login longer than sign-in will look up.
--
-- Sign-in refuses a username over 254 characters before touching the
-- database (MAX_USERNAME_LENGTH in src/lib/credentialInput.ts). Some screens
-- that create logins don't check that limit, so an Admin could make a login
-- whose invite link works once and then never signs in again. This makes the
-- database refuse such a name, whichever screen sends it.
--
-- Counted in UTF-8 bytes (octet_length): never fewer than the UTF-16 units
-- sign-in counts, so everything this allows, sign-in accepts.
--
-- Safe on existing data: if any login is already longer, nothing is changed
-- and a NOTICE says so. The deploy doesn't fail, and that row stays editable.
-- Shorten it, then run the ALTER TABLE below by hand. The table lock comes
-- first so no new long name can arrive between the check and the ALTER,
-- which needs this same lock anyway. The User table is small, so it's held
-- for milliseconds.
DO $$
DECLARE
  too_long integer;
BEGIN
  LOCK TABLE "User" IN ACCESS EXCLUSIVE MODE;
  SELECT count(*) INTO too_long FROM "User" WHERE octet_length("username") > 254;
  IF too_long > 0 THEN
    RAISE NOTICE 'Skipped User_username_length_check: % existing username(s) are over 254 bytes', too_long;
  ELSE
    ALTER TABLE "User" ADD CONSTRAINT "User_username_length_check" CHECK (octet_length("username") <= 254);
  END IF;
END $$;
