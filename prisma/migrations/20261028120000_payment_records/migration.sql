-- CreateEnum
CREATE TYPE "PaymentRecordKind" AS ENUM ('DUES', 'EVENT', 'GUEST_GROUP', 'TRIP', 'RAFFLE', 'TRIP_EXPENSE');

-- CreateEnum
CREATE TYPE "PaymentRecordStatus" AS ENUM ('NEEDS_DECISION', 'REFUNDED', 'KEPT_BY_PACK', 'ENTERED_IN_ERROR', 'NOT_APPLICABLE');

-- CreateTable
CREATE TABLE "PaymentRecord" (
    "id" TEXT NOT NULL,
    "kind" "PaymentRecordKind" NOT NULL,
    "originalId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "paidOn" DATE,
    "method" TEXT,
    "paidBy" TEXT,
    "paidFor" TEXT NOT NULL,
    "note" TEXT,
    "isCredit" BOOLEAN NOT NULL DEFAULT false,
    "wasVoided" BOOLEAN NOT NULL DEFAULT false,
    "voidReason" TEXT,
    "recordedByName" TEXT,
    "originalCreatedAt" TIMESTAMP(3),
    "details" JSONB,
    "deletionReason" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedByUserId" TEXT,
    "deletedByName" TEXT,
    "capturedBy" TEXT NOT NULL DEFAULT 'app',
    "status" "PaymentRecordStatus" NOT NULL DEFAULT 'NEEDS_DECISION',
    "refundedCents" INTEGER,
    "refundedOn" DATE,
    "resolutionNote" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByName" TEXT,

    CONSTRAINT "PaymentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentRecord_deletedAt_idx" ON "PaymentRecord"("deletedAt");

-- CreateIndex
CREATE INDEX "PaymentRecord_status_idx" ON "PaymentRecord"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRecord_kind_originalId_key" ON "PaymentRecord"("kind", "originalId");


-- Never lose a payment record ------------------------------------------------
--
-- The app copies every payment into "PaymentRecord", with full context, in the
-- same transaction that deletes it (src/lib/paymentRecords.ts). These BEFORE
-- DELETE triggers are the safety net for any delete path that forgets: they
-- copy whatever the app didn't, with what the row itself knows. ON CONFLICT DO
-- NOTHING means a row the app already wrote is left alone. The app passes who
-- is deleting and why through transaction-local settings (set_config(...,
-- true)); without them the record still gets written, just with less said.
-- During a cascade (an event deleted with its registrations) the parent row
-- may already be gone, so the lookups below fall back to plain text.

CREATE OR REPLACE FUNCTION pack376_payment_record_context(OUT reason TEXT, OUT by_user_id TEXT, OUT by_name TEXT)
LANGUAGE plpgsql AS $$
BEGIN
  reason := COALESCE(NULLIF(current_setting('pack376.deletion_reason', true), ''), 'Deleted (reason not recorded)');
  by_user_id := NULLIF(current_setting('pack376.deleted_by_user_id', true), '');
  by_name := NULLIF(current_setting('pack376.deleted_by_name', true), '');
END;
$$;

CREATE OR REPLACE FUNCTION pack376_new_payment_record_id() RETURNS TEXT
LANGUAGE sql AS $$ SELECT 'db' || md5(random()::text || clock_timestamp()::text) $$;

CREATE OR REPLACE FUNCTION pack376_keep_dues_payment() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE ctx RECORD; who TEXT;
BEGIN
  SELECT * INTO ctx FROM pack376_payment_record_context();
  SELECT s."firstName" || ' ' || s."lastName" INTO who FROM "Scout" s WHERE s.id = OLD."scoutId";
  INSERT INTO "PaymentRecord" ("id", "kind", "originalId", "amountCents", "paidOn", "paidBy", "paidFor", "note",
    "recordedByName", "originalCreatedAt", "details", "deletionReason", "deletedByUserId", "deletedByName", "capturedBy")
  VALUES (pack376_new_payment_record_id(), 'DUES', OLD.id, OLD."amountCents", OLD."paidOn", who,
    'Dues' || COALESCE(' — ' || who, ' (scout deleted)'), OLD.note,
    (SELECT COALESCE(u."displayName", u.username) FROM "User" u WHERE u.id = OLD."recordedByUserId"),
    OLD."createdAt", jsonb_build_object('scoutId', OLD."scoutId"), ctx.reason, ctx.by_user_id, ctx.by_name, 'database')
  ON CONFLICT ("kind", "originalId") DO NOTHING;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION pack376_keep_event_payment() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE ctx RECORD; who TEXT; what TEXT; reg RECORD;
BEGIN
  SELECT * INTO ctx FROM pack376_payment_record_context();
  SELECT r."eventId", r."scoutId" INTO reg FROM "EventRegistration" r WHERE r.id = OLD."eventRegistrationId";
  SELECT s."firstName" || ' ' || s."lastName" INTO who FROM "Scout" s WHERE s.id = reg."scoutId";
  SELECT e.title || ' (' || to_char(e."eventDate", 'Mon FMDD, YYYY') || ')' INTO what FROM "Event" e WHERE e.id = reg."eventId";
  INSERT INTO "PaymentRecord" ("id", "kind", "originalId", "amountCents", "paidOn", "paidBy", "paidFor", "note",
    "recordedByName", "originalCreatedAt", "details", "deletionReason", "deletedByUserId", "deletedByName", "capturedBy")
  VALUES (pack376_new_payment_record_id(), 'EVENT', OLD.id, OLD."amountCents", OLD."paidOn", who,
    COALESCE(what, 'Event registration (event or scout deleted)'), OLD.note,
    (SELECT COALESCE(u."displayName", u.username) FROM "User" u WHERE u.id = OLD."recordedByUserId"),
    OLD."createdAt", jsonb_build_object('eventRegistrationId', OLD."eventRegistrationId", 'eventId', reg."eventId", 'scoutId', reg."scoutId"),
    ctx.reason, ctx.by_user_id, ctx.by_name, 'database')
  ON CONFLICT ("kind", "originalId") DO NOTHING;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION pack376_keep_guest_group_payment() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE ctx RECORD; grp RECORD; what TEXT;
BEGIN
  SELECT * INTO ctx FROM pack376_payment_record_context();
  SELECT g."familyName", g."eventId" INTO grp FROM "EventGuestGroup" g WHERE g.id = OLD."eventGuestGroupId";
  SELECT e.title || ' (' || to_char(e."eventDate", 'Mon FMDD, YYYY') || ')' INTO what FROM "Event" e WHERE e.id = grp."eventId";
  INSERT INTO "PaymentRecord" ("id", "kind", "originalId", "amountCents", "paidOn", "paidBy", "paidFor", "note",
    "recordedByName", "originalCreatedAt", "details", "deletionReason", "deletedByUserId", "deletedByName", "capturedBy")
  VALUES (pack376_new_payment_record_id(), 'GUEST_GROUP', OLD.id, OLD."amountCents", OLD."paidOn", grp."familyName",
    COALESCE(what || ' — guests', 'Event guest group (event or group deleted)'), OLD.note,
    (SELECT COALESCE(u."displayName", u.username) FROM "User" u WHERE u.id = OLD."recordedByUserId"),
    OLD."createdAt", jsonb_build_object('eventGuestGroupId', OLD."eventGuestGroupId", 'eventId', grp."eventId"),
    ctx.reason, ctx.by_user_id, ctx.by_name, 'database')
  ON CONFLICT ("kind", "originalId") DO NOTHING;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION pack376_keep_trip_payment() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE ctx RECORD; reg RECORD; what TEXT;
BEGIN
  SELECT * INTO ctx FROM pack376_payment_record_context();
  SELECT r."familyName", r."contactEmail", r."contactPhone", r."tripPageId" INTO reg FROM "TripRegistration" r WHERE r.id = OLD."tripRegistrationId";
  SELECT t.title INTO what FROM "TripPage" t WHERE t.id = reg."tripPageId";
  INSERT INTO "PaymentRecord" ("id", "kind", "originalId", "amountCents", "paidOn", "paidBy", "paidFor", "note",
    "recordedByName", "originalCreatedAt", "details", "deletionReason", "deletedByUserId", "deletedByName", "capturedBy")
  VALUES (pack376_new_payment_record_id(), 'TRIP', OLD.id, OLD."amountCents", OLD."paidOn", reg."familyName",
    COALESCE(what, 'Trip registration (trip or registration deleted)'), OLD.note,
    (SELECT COALESCE(u."displayName", u.username) FROM "User" u WHERE u.id = OLD."recordedByUserId"),
    OLD."createdAt",
    jsonb_build_object('tripRegistrationId', OLD."tripRegistrationId", 'tripPageId', reg."tripPageId",
      'contactEmail', reg."contactEmail", 'contactPhone', reg."contactPhone"),
    ctx.reason, ctx.by_user_id, ctx.by_name, 'database')
  ON CONFLICT ("kind", "originalId") DO NOTHING;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION pack376_keep_raffle_payment() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE ctx RECORD; buyer TEXT; what TEXT;
BEGIN
  SELECT * INTO ctx FROM pack376_payment_record_context();
  SELECT en.name INTO buyer FROM "RaffleEntry" en WHERE en.id = OLD."entryId";
  SELECT 'Raffle: ' || r.name INTO what FROM "Raffle" r WHERE r.id = OLD."raffleId";
  INSERT INTO "PaymentRecord" ("id", "kind", "originalId", "amountCents", "paidOn", "method", "paidBy", "paidFor", "note",
    "wasVoided", "voidReason", "recordedByName", "originalCreatedAt", "details", "deletionReason", "deletedByUserId",
    "deletedByName", "capturedBy", "status")
  VALUES (pack376_new_payment_record_id(), 'RAFFLE', OLD.id, OLD."amountCents", OLD."receivedOn", OLD.method::text,
    COALESCE(OLD."payerName", buyer), COALESCE(what, 'Raffle (raffle deleted)'), OLD.note,
    OLD."voidedAt" IS NOT NULL, OLD."voidReason",
    (SELECT COALESCE(u."displayName", u.username) FROM "User" u WHERE u.id = OLD."recordedByUserId"),
    OLD."createdAt", jsonb_build_object('raffleId', OLD."raffleId", 'entryId', OLD."entryId", 'buyer', buyer),
    ctx.reason, ctx.by_user_id, ctx.by_name, 'database',
    CASE WHEN OLD."voidedAt" IS NOT NULL THEN 'NOT_APPLICABLE'::"PaymentRecordStatus" ELSE 'NEEDS_DECISION'::"PaymentRecordStatus" END)
  ON CONFLICT ("kind", "originalId") DO NOTHING;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION pack376_keep_trip_expense() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE ctx RECORD; what TEXT;
BEGIN
  SELECT * INTO ctx FROM pack376_payment_record_context();
  SELECT t.title INTO what FROM "TripPage" t WHERE t.id = OLD."tripPageId";
  INSERT INTO "PaymentRecord" ("id", "kind", "originalId", "amountCents", "paidOn", "paidBy", "paidFor", "note",
    "isCredit", "recordedByName", "originalCreatedAt", "details", "deletionReason", "deletedByUserId", "deletedByName",
    "capturedBy", "status")
  VALUES (pack376_new_payment_record_id(), 'TRIP_EXPENSE', OLD.id, OLD."amountCents", OLD."spentOn", OLD."paidBy",
    COALESCE(what, 'Trip (deleted)') || ' — ' || OLD.description, NULL, OLD."isCredit",
    (SELECT COALESCE(u."displayName", u.username) FROM "User" u WHERE u.id = OLD."recordedByUserId"),
    OLD."createdAt", jsonb_build_object('tripPageId', OLD."tripPageId"),
    ctx.reason, ctx.by_user_id, ctx.by_name, 'database', 'NOT_APPLICABLE')
  ON CONFLICT ("kind", "originalId") DO NOTHING;
  RETURN OLD;
END;
$$;

CREATE TRIGGER "DuesPayment_keep_record" BEFORE DELETE ON "DuesPayment"
  FOR EACH ROW EXECUTE FUNCTION pack376_keep_dues_payment();
CREATE TRIGGER "EventPayment_keep_record" BEFORE DELETE ON "EventPayment"
  FOR EACH ROW EXECUTE FUNCTION pack376_keep_event_payment();
CREATE TRIGGER "EventGuestGroupPayment_keep_record" BEFORE DELETE ON "EventGuestGroupPayment"
  FOR EACH ROW EXECUTE FUNCTION pack376_keep_guest_group_payment();
CREATE TRIGGER "TripPayment_keep_record" BEFORE DELETE ON "TripPayment"
  FOR EACH ROW EXECUTE FUNCTION pack376_keep_trip_payment();
CREATE TRIGGER "RafflePayment_keep_record" BEFORE DELETE ON "RafflePayment"
  FOR EACH ROW EXECUTE FUNCTION pack376_keep_raffle_payment();
CREATE TRIGGER "TripExpense_keep_record" BEFORE DELETE ON "TripExpense"
  FOR EACH ROW EXECUTE FUNCTION pack376_keep_trip_expense();
