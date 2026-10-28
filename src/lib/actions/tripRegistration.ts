"use server";

import { headers } from "next/headers";
import { isRateLimited } from "@/lib/rateLimit";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertAdmin } from "@/lib/authorize";
import {
  currentTripPriceCents,
  lockTripPage,
  registrationClosed,
  tripFormResult,
  TripInputError,
  TRIP_FORM_OUT_OF_DATE,
  TRIP_PAGE_GONE,
  TRIP_TRANSACTION_OPTIONS,
  type TripFormResult,
} from "@/lib/tripPageData";
import { tripRegistrationEditVersion } from "@/lib/tripEditVersion";
import { tripSiteBySlug } from "@/lib/tripSites";
import { revalidateTripAdminPages, revalidateTripPages } from "@/lib/tripRevalidate";
import { formatPhoneNumber } from "@/lib/phone";
import {
  dollarsToCents,
  isValidEmail,
  multiplyCents,
  parseCount,
  textField,
  MAX_NAME_LENGTH,
  MAX_PHONE_LENGTH,
} from "@/lib/formValues";
import { parseDateOnlyString, todayDateOnly } from "@/lib/dateOnly";
import { recordAudit, recordAuditInTransaction, changedFields, auditMoney, auditDate } from "@/lib/audit";
import type { TripAffiliation } from "@/generated/prisma/enums";

/*
 * Bounds for the registration fields. Nothing here is a business rule —
 * these are the limits that stop a caller from writing rows of arbitrary
 * size, or an unbounded number of them, into the database. The public form
 * and the admin forms share them (and the name/email/phone limits in
 * formValues.ts), so a registration can't hold anything through one door
 * that the other would refuse.
 */
const MAX_ATTENDEES = 50;
/**
 * A persistent ceiling on how many separate registrations one email address
 * can file for one trip. The Vercel Firewall rate limit below is the first
 * line, but it's configured outside this repo and fails open if the rule is
 * missing — this one is enforced by the database read that precedes the
 * write, so it holds regardless.
 */
const MAX_REGISTRATIONS_PER_EMAIL = 10;

/** A form field a registration error is about, so the public form can mark that field (aria-invalid) and point it at the message. */
export type TripRegistrationField =
  | "familyName"
  | "guestOfName"
  | "contactEmail"
  | "contactPhone"
  | "affiliation"
  | "payingCount"
  | "freeCount";

export type RegisterForTripState = {
  error?: string;
  /** The field `error` is about, when it's about one. */
  field?: TripRegistrationField;
  success?: boolean;
  /**
   * Identifies the submission a success belongs to: a fresh id each time one
   * goes through, and the previous one carried over unchanged when one
   * doesn't. Two successes in a row are otherwise indistinguishable
   * ({ success: true } both times) and the form has to tell them apart — it
   * clears itself by keying its fields off this value
   * (TripRegistrationForm.tsx), so every success has to read as new while a
   * failure that follows one must not.
   */
  submissionId?: string;
};

type RegistrationFields = {
  familyName: string;
  contactEmail: string;
  contactPhone: string;
  guestOfName: string;
  affiliation: TripAffiliation;
  payingCount: number;
  freeCount: number;
};

/**
 * Reads and bounds the family, contact and attendee fields that the public
 * form, the admin "add by hand" form and the admin edit form all send. The
 * attendee ceiling is left to the caller: the edit form lets a registration
 * that is already larger than MAX_ATTENDEES keep its size.
 */
function readRegistrationFields(
  formData: FormData,
): { fields: RegistrationFields; error?: undefined } | { error: string; field?: TripRegistrationField } {
  const familyName = textField(formData.get("familyName"));
  const contactEmail = textField(formData.get("contactEmail"));
  const contactPhone = formatPhoneNumber(textField(formData.get("contactPhone")));
  const guestOfName = textField(formData.get("guestOfName"));
  const affiliation = textField(formData.get("affiliation"));
  const payingCount = parseCount(formData.get("payingCount"));
  const freeCount = parseCount(formData.get("freeCount"));

  const missing: TripRegistrationField | null = !familyName
    ? "familyName"
    : !guestOfName
      ? "guestOfName"
      : !contactEmail
        ? "contactEmail"
        : !contactPhone
          ? "contactPhone"
          : null;
  if (missing) return { error: "Name, email, phone, and guest-of are required.", field: missing };
  // Nothing on the public form has a length limit in the browser, and the
  // Server Action body allowance is 8MB for photo uploads — so without these
  // a caller can store a 100,000-character name.
  if (familyName.length > MAX_NAME_LENGTH) {
    return { error: `Names must be ${MAX_NAME_LENGTH} characters or fewer.`, field: "familyName" };
  }
  if (guestOfName.length > MAX_NAME_LENGTH) {
    return { error: `Names must be ${MAX_NAME_LENGTH} characters or fewer.`, field: "guestOfName" };
  }
  if (!isValidEmail(contactEmail)) return { error: "Enter a valid email address.", field: "contactEmail" };
  if (contactPhone.length > MAX_PHONE_LENGTH) return { error: "Enter a valid phone number.", field: "contactPhone" };
  if (affiliation !== "PACK" && affiliation !== "TROOP") {
    return { error: "Choose Pack 376 or Troop 376.", field: "affiliation" };
  }
  if (payingCount === null) return { error: "Invalid attendee counts.", field: "payingCount" };
  if (freeCount === null) return { error: "Invalid attendee counts.", field: "freeCount" };
  if (payingCount + freeCount === 0) return { error: "Enter at least one attendee.", field: "payingCount" };

  return { fields: { familyName, contactEmail, contactPhone, guestOfName, affiliation, payingCount, freeCount } };
}

/** The admin forms' reading of the same fields: a problem is a TripInputError, shown on the form. */
function readAdminRegistrationFields(formData: FormData): RegistrationFields {
  const read = readRegistrationFields(formData);
  if (read.error !== undefined) throw new TripInputError(read.error);
  return read.fields;
}

const ADMIN_TOO_MANY_ATTENDEES = `That's more than ${MAX_ATTENDEES} attendees for one registration — split the group into two registrations.`;
const REGISTRATION_GONE = "This registration has been removed. Reload the page.";
/** What the public form says when the save itself fails — a database hiccup, or a wait for the trip's lock that ran out. */
const REGISTRATION_NOT_SAVED =
  "We couldn't save your registration just now. Please try again in a moment — if it keeps happening, contact us and we'll add your group.";
/** Only reachable with a per-person price in the tens of thousands of dollars, but a total has to fit what a form can store. */
const TOTAL_TOO_LARGE = "That total is more than $1,000,000.00 — check the attendee counts and the price.";

/**
 * Public, unauthenticated registration for an event's micro-site (conron.pack376nyc.org, …) — anyone
 * can submit this, no portal account involved. `website` is a hidden
 * honeypot field real visitors never see or fill; a bot that fills every
 * field on the form trips it and the submission is silently dropped (empty
 * state, same as a real success from the bot's point of view — an error
 * would tell it which field to leave blank). amountOwedCents is computed
 * here from the trip's currently-active price tier — never trust a
 * client-submitted amount. Returns state (via useActionState in the form,
 * same convention as loginAction) rather than throwing, so the client can
 * show a confirmation popup on success or an inline message on failure
 * instead of hitting Next's default error boundary.
 *
 * Not written to the AuditLog: there's no actor to attribute it to, and the
 * TripRegistration row itself (with its createdAt) already is the record of a
 * family signing up. The log covers what staff do to these rows afterwards —
 * the edit, payment and delete actions below.
 */
export async function registerForTripAction(
  prevState: RegisterForTripState,
  formData: FormData,
): Promise<RegisterForTripState> {
  const result = await submitTripRegistration(formData);
  // Only a submission that actually went through mints a new submissionId.
  // Everything else — a validation error, a rate limit, the honeypot —
  // hands back the one already in state, so a failed attempt after a
  // successful one doesn't read as a second success to the form.
  return result.success
    ? { ...result, submissionId: crypto.randomUUID() }
    : { ...result, submissionId: prevState.submissionId };
}

/** The work itself; registerForTripAction above owns the returned state's submissionId. */
async function submitTripRegistration(formData: FormData): Promise<RegisterForTripState> {
  if (String(formData.get("website") || "").trim() !== "") return {};

  // Before any database work, the same way loginAction does it. Counted per IP
  // under the shared Firewall rule, separately from sign-in (see
  // rateLimit.ts). If the rule is missing this is a no-op, which is why the
  // per-email ceiling further down is enforced in the database rather than
  // relying on this.
  if (await isRateLimited("trip-registration", await headers())) {
    return { error: "Too many registration attempts from this connection. Try again in a few minutes." };
  }

  const tripPageId = textField(formData.get("tripPageId"));
  if (!tripPageId) return { error: "Name, email, phone, guest-of, and trip are required." };
  const read = readRegistrationFields(formData);
  if (read.error !== undefined) return { error: read.error, field: read.field };
  const fields = read.fields;
  if (fields.payingCount + fields.freeCount > MAX_ATTENDEES) {
    return {
      error: `That's more than ${MAX_ATTENDEES} attendees — email us instead and we'll add your group.`,
      field: "payingCount",
    };
  }

  const normalizedEmail = fields.contactEmail.toLowerCase();
  const outcome = await prisma.$transaction(async (tx) => {
    // Everything this decides on — whether the trip is open, its free tier,
    // the price or "TBD" — is read under the trip's lock (see lockTripPage),
    // never before it. Read earlier, a submission that saw "TBD" could still
    // be saving after the admin posted the price and the waiting
    // registrations were filled in, and its row would be left pending at $0
    // with nothing left to price it. With the lock, it either commits first
    // (and the price posting then fills it in) or reads the posted price.
    const trip = await lockTripPage(tx, tripPageId);
    const noun = (trip && tripSiteBySlug(trip.slug)?.noun) || "trip";
    // Three separate reasons, one answer: an id that doesn't exist, a trip
    // that isn't published, and a trip past its RSVP deadline all get the
    // same message. The id comes straight from the form, so this check is
    // what keeps an unpublished draft or a closed trip out of reach. An admin
    // can still add a late family by hand from the event's admin page
    // (addTripRegistrationAction below).
    if (!trip || !trip.published || registrationClosed(trip)) return { kind: "closed", noun } as const;
    // An event with no free age has no free tier, and the form doesn't offer one.
    if (trip.freeAgeAndUnder === null && fields.freeCount > 0) return { kind: "noFreeTier", noun } as const;

    // The replay check and the per-email cap are both read-then-write. The
    // trip lock above already makes submissions to one trip take turns; this
    // transaction-scoped advisory lock on trip + email keeps same-address
    // submissions in line on its own as well, so the cap and the replay
    // check never depend on how the trip happens to be locked. Taken after
    // the trip lock, never before (lockTripPage has the order).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`trip-registration:${tripPageId}:${normalizedEmail}`}))`;

    const sameEmail = await tx.tripRegistration.findMany({
      where: { tripPageId, contactEmail: { equals: normalizedEmail, mode: "insensitive" } },
      select: { familyName: true, payingCount: true, freeCount: true },
    });
    // A resubmitted form — a double-click, a refresh, a replayed request —
    // reports the success it would have reported the first time rather than
    // filing a second identical row. A genuinely different second group from
    // the same address still goes through.
    const isReplay = sameEmail.some(
      (r) => r.familyName === fields.familyName && r.payingCount === fields.payingCount && r.freeCount === fields.freeCount,
    );
    if (isReplay) return { kind: "replay" } as const;
    if (sameEmail.length >= MAX_REGISTRATIONS_PER_EMAIL) return { kind: "capped", noun } as const;

    // While the price is unreleased nothing can be owed yet: the row is saved
    // pending (amount 0) and filled in when an admin posts the price.
    const owedPending = trip.priceTbd;
    const amountOwedCents = owedPending ? 0 : multiplyCents(fields.payingCount, currentTripPriceCents(trip));
    if (amountOwedCents === null) return { kind: "tooLarge" } as const;

    await tx.tripRegistration.create({
      data: { tripPageId, ...fields, amountOwedCents, owedPending },
    });
    return { kind: "created" } as const;
  }, TRIP_TRANSACTION_OPTIONS).catch((error: unknown) => {
    // Every submission to a trip queues for its lock, so a burst — or a price
    // posting charging many families — can outlast the transaction's time
    // limit, and the database can fail like any other. That's not the
    // visitor's doing, and a generic error page would lose what they typed:
    // say so on the form and let them try again. Nothing was saved (the
    // transaction rolled back), and if it had been, the retry is a replay.
    // The log line leaves out the error's structured details, which for a
    // database error can repeat the family's row back.
    const code = typeof error === "object" && error && "code" in error ? ` [${String(error.code)}]` : "";
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error(`[trip registration] couldn't save a registration${code}: ${message}`);
    return { kind: "failed" } as const;
  });

  switch (outcome.kind) {
    case "closed":
      return { error: `Registration for this ${outcome.noun} is closed. Please contact us and we'll help you out.` };
    case "noFreeTier":
      return {
        error: `This ${outcome.noun} has no free-attendee option. Please enter everyone as a paying attendee.`,
        field: "freeCount",
      };
    case "capped":
      return { error: `This email already has several registrations for this ${outcome.noun}. Please contact us to add more.` };
    case "tooLarge":
      return { error: "That total is more than we can take online — email us instead and we'll add your group." };
    case "failed":
      return { error: REGISTRATION_NOT_SAVED };
    case "replay":
      return { success: true };
    case "created":
      revalidateTripPages();
      return { success: true };
  }
}

/**
 * The staffed way in after the public form has closed — an admin adding a
 * family who registered late, called in, or signed up on paper. This is the
 * "controlled exception" that lets registerForTripAction above enforce the
 * RSVP deadline without stranding anyone: the deadline closes the public
 * door, not the pack's ability to take a registration.
 *
 * Audited, unlike the public action, because here there is an actor — and in
 * the same transaction as the row, since it sets what a family owes.
 */
export async function addTripRegistrationAction(formData: FormData): Promise<TripFormResult> {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  return tripFormResult(async () => {
    const tripPageId = textField(formData.get("tripPageId"));
    if (!tripPageId) throw new TripInputError("Missing trip page id.");
    const fields = readAdminRegistrationFields(formData);
    if (fields.payingCount + fields.freeCount > MAX_ATTENDEES) throw new TripInputError(ADMIN_TOO_MANY_ATTENDEES);

    await prisma.$transaction(async (tx) => {
      // Priced under the trip's lock, the same way the public form prices it
      // (see registerForTripAction), so a family added while the price is
      // being posted is either filled in by the posting or priced here.
      const trip = await lockTripPage(tx, tripPageId);
      if (!trip) throw new TripInputError(TRIP_PAGE_GONE, { stale: true });

      // A late addition costs what the tier in effect today costs (or stays
      // pending while the price is TBD). Edit the amount afterwards if this
      // family was promised the early-bird rate.
      const owedPending = trip.priceTbd;
      const amountOwedCents = owedPending ? 0 : multiplyCents(fields.payingCount, currentTripPriceCents(trip));
      if (amountOwedCents === null) throw new TripInputError(TOTAL_TOO_LARGE);

      const created = await tx.tripRegistration.create({
        data: { tripPageId, ...fields, amountOwedCents, owedPending },
      });

      await recordAuditInTransaction(tx, session, {
        action: "tripRegistration.create",
        summary: `Added the trip registration for ${fields.familyName} by hand${
          registrationClosed(trip) ? " — after the RSVP deadline" : ""
        }`,
        entityType: "TripRegistration",
        entityId: created.id,
        details: [
          { label: "Family name", from: "—", to: fields.familyName },
          { label: "Email", from: "—", to: fields.contactEmail },
          { label: "Attendees", from: "—", to: `${fields.payingCount} paying, ${fields.freeCount} free` },
          { label: "Amount owed", from: "—", to: owedPending ? "TBD (price not released)" : auditMoney(amountOwedCents) },
        ],
      });
    }, TRIP_TRANSACTION_OPTIONS);

    revalidateTripPages();
  });
}

/**
 * Admin-only, same population as the payment actions below — junior admin can
 * view registrations but not edit them.
 *
 * Runs under the trip's lock, like price posting, because what a blank
 * "Amount owed" means depends on the trip's current price: a registration
 * still waiting for a price stays waiting while it's TBD, and is charged
 * attendees × the price once it's posted. An attendee change that commits
 * before the price is posted is therefore what the posting charges for, and
 * one that arrives after it is turned down — it never puts a priced
 * registration back to $0.
 *
 * The form sends back a fingerprint of the registration it was filled in
 * with (tripRegistrationEditVersion). If the registration changed after the
 * page loaded — another Admin's correction or discount, the price being
 * posted, a save from another tab — the edit is refused rather than writing
 * back the Amount Owed and everything else the form still showed. That holds
 * even when the amount was retyped here: it was typed without seeing the
 * change it would replace.
 */
export async function updateTripRegistrationAction(formData: FormData): Promise<TripFormResult> {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  return tripFormResult(async () => {
    const id = textField(formData.get("id"));
    if (!id) throw new TripInputError("Missing registration id.");
    const version = textField(formData.get("version"));
    if (!version) throw new TripInputError(TRIP_FORM_OUT_OF_DATE, { stale: true });

    // A registration never moves to another trip, so which trip to lock can
    // be read before the lock; everything else is re-read under it.
    const registration = await prisma.tripRegistration.findUnique({ where: { id }, select: { tripPageId: true } });
    if (!registration) throw new TripInputError(REGISTRATION_GONE, { stale: true });

    await prisma.$transaction(async (tx) => {
      const trip = await lockTripPage(tx, registration.tripPageId);
      const before = await tx.tripRegistration.findUnique({
        where: { id },
        select: {
          familyName: true,
          contactEmail: true,
          contactPhone: true,
          guestOfName: true,
          affiliation: true,
          payingCount: true,
          freeCount: true,
          amountOwedCents: true,
          owedPending: true,
        },
      });
      if (!trip || !before) throw new TripInputError(REGISTRATION_GONE, { stale: true });
      if (tripRegistrationEditVersion(before) !== version) {
        const owes = before.owedPending ? "is still waiting for the price" : `owes ${auditMoney(before.amountOwedCents)}`;
        throw new TripInputError(
          `This registration was changed after this page loaded — it now has ${before.payingCount} paying, ${before.freeCount} free and ${owes}. Nothing was saved. Review it on the refreshed page (reload the page if it hasn't updated), then make your change again.`,
          { stale: true },
        );
      }

      // Read only after that check, for the reason updateTripPricingAction
      // gives: a refusal about what was typed puts the entries back next to
      // the refreshed page's fingerprint, so it must come from a current form.
      const fields = readAdminRegistrationFields(formData);
      const amountOwedRaw = textField(formData.get("amountOwed"));
      const typedAmountCents = amountOwedRaw === "" ? null : dollarsToCents(amountOwedRaw);
      if (amountOwedRaw !== "" && typedAmountCents === null) {
        throw new TripInputError("Enter a valid amount owed (up to $1,000,000.00).");
      }
      // The per-person price the form said a blank amount would be charged at
      // — sent only by a form that said so (TripRegistrationCountFields), for a
      // registration still waiting on a trip whose price is posted.
      const shownChargeRaw = textField(formData.get("chargePricePerPersonCents"));
      const shownChargeCents = /^\d{1,9}$/.test(shownChargeRaw) ? Number(shownChargeRaw) : null;

      // A group already over the ceiling (added before it applied to admins)
      // can still be edited, as long as its counts stay as they are.
      const countsUnchanged = fields.payingCount === before.payingCount && fields.freeCount === before.freeCount;
      if (fields.payingCount + fields.freeCount > MAX_ATTENDEES && !countsUnchanged) {
        throw new TripInputError(ADMIN_TOO_MANY_ATTENDEES);
      }

      let amountOwedCents: number;
      let owedPending: boolean;
      if (typedAmountCents !== null) {
        // Typing an amount sets it, and ends any wait for the price.
        amountOwedCents = typedAmountCents;
        owedPending = false;
      } else if (before.owedPending && trip.priceTbd) {
        // Left blank while still waiting: stays waiting.
        amountOwedCents = 0;
        owedPending = true;
      } else if (before.owedPending) {
        // Left blank, but the price is already posted: a registration the
        // posting missed (only possible before posting took this lock). It's
        // charged what posting would have charged — attendees × the price —
        // as long as that's the price the form said it would charge at, the
        // same check the "still waiting" banner's Charge button makes. A form
        // that said nothing about a charge (loaded while the price was TBD)
        // or quoted another price is turned down for a fresh look instead.
        const pricePerPersonCents = currentTripPriceCents(trip);
        if (shownChargeCents !== pricePerPersonCents) {
          throw new TripInputError(
            shownChargeCents === null
              ? `The price was posted after this page loaded: ${auditMoney(pricePerPersonCents)}/person. Review this registration's charge on the refreshed page, then save again.`
              : `The price is now ${auditMoney(pricePerPersonCents)}/person, not ${auditMoney(shownChargeCents)}. Review this registration's charge on the refreshed page, then save again.`,
            { stale: true },
          );
        }
        const priced = multiplyCents(fields.payingCount, pricePerPersonCents);
        if (priced === null) throw new TripInputError(TOTAL_TOO_LARGE);
        amountOwedCents = priced;
        owedPending = false;
      } else {
        // Already priced, and the amount left blank. A form loaded while the
        // registration was waiting has already been turned away as out of
        // date above (its fingerprint says "waiting"), and a current form for
        // a priced registration requires the field — so this is a cleared
        // field the browser let through, never a reason to drop the amount.
        throw new TripInputError("Enter the amount owed — once a registration has one, it can't be left blank.");
      }

      // Removing a registration doesn't take the trip's lock, so it can still
      // land between the read above and this write; that's a refusal, not a fault.
      const { count } = await tx.tripRegistration.updateMany({
        where: { id },
        data: { ...fields, amountOwedCents, owedPending },
      });
      if (count === 0) throw new TripInputError(REGISTRATION_GONE, { stale: true });

      await recordAuditInTransaction(tx, session, {
        action: "tripRegistration.update",
        summary: `Edited the trip registration for ${fields.familyName}`,
        entityType: "TripRegistration",
        entityId: id,
        details: changedFields({
          "Family name": [before.familyName, fields.familyName],
          Email: [before.contactEmail, fields.contactEmail],
          Phone: [before.contactPhone, fields.contactPhone],
          "Guest of": [before.guestOfName, fields.guestOfName],
          Affiliation: [before.affiliation, fields.affiliation],
          "Paying attendees": [before.payingCount, fields.payingCount],
          "Free attendees": [before.freeCount, fields.freeCount],
          "Amount owed": [
            before.owedPending ? "TBD" : auditMoney(before.amountOwedCents),
            owedPending ? "TBD" : auditMoney(amountOwedCents),
          ],
        }),
      });
    }, TRIP_TRANSACTION_OPTIONS);

    revalidateTripPages();
  });
}


/** Admin-only, same convention as requireEventPaymentSession — junior admin can view registrations but not record money. */
export async function addTripPaymentAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const tripRegistrationId = String(formData.get("tripRegistrationId") || "");
  const amountCents = dollarsToCents(String(formData.get("amount") || ""));
  const paidOnRaw = String(formData.get("paidOn") || "").trim();
  const note = String(formData.get("note") || "").trim() || null;
  if (!tripRegistrationId || amountCents === null || amountCents === 0) {
    throw new Error("A valid payment amount is required.");
  }

  const paidOn = parseDateOnlyString(paidOnRaw, "Invalid payment date.") ?? todayDateOnly();

  const payment = await prisma.tripPayment.create({
    data: { tripRegistrationId, amountCents, paidOn, note, recordedByUserId: session.userId },
  });

  const registration = await prisma.tripRegistration.findUnique({
    where: { id: tripRegistrationId },
    select: { familyName: true },
  });
  await recordAudit(session, {
    action: "tripPayment.add",
    summary: `Recorded a ${auditMoney(amountCents)} trip payment from ${registration?.familyName ?? "a family"}`,
    entityType: "TripPayment",
    entityId: payment.id,
    details: [
      { label: "Amount", from: "—", to: auditMoney(amountCents) },
      { label: "Paid on", from: "—", to: auditDate(paidOn) },
      ...(note ? [{ label: "Note", from: "—", to: note }] : []),
    ],
  });

  revalidateTripAdminPages();
}

export async function deleteTripPaymentAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const paymentId = String(formData.get("paymentId") || "");
  if (!paymentId) throw new Error("Missing payment id.");

  // Read before deleting — the amount is only recoverable from this entry after.
  const payment = await prisma.tripPayment.findUnique({
    where: { id: paymentId },
    select: { amountCents: true, paidOn: true, note: true, tripRegistration: { select: { familyName: true } } },
  });

  await prisma.tripPayment.delete({ where: { id: paymentId } });

  await recordAudit(session, {
    action: "tripPayment.delete",
    summary: payment
      ? `Deleted a ${auditMoney(payment.amountCents)} trip payment from ${payment.tripRegistration.familyName}`
      : "Deleted a trip payment",
    entityType: "TripPayment",
    entityId: paymentId,
    details: payment
      ? [
          { label: "Amount", from: auditMoney(payment.amountCents), to: "—" },
          { label: "Paid on", from: auditDate(payment.paidOn), to: "—" },
          ...(payment.note ? [{ label: "Note", from: payment.note, to: "—" }] : []),
        ]
      : null,
  });

  revalidateTripAdminPages();
}

export async function deleteTripRegistrationAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const id = String(formData.get("id") || "");
  if (!id) throw new Error("Missing registration id.");

  const registration = await prisma.tripRegistration.findUnique({
    where: { id },
    select: {
      familyName: true,
      contactEmail: true,
      payingCount: true,
      freeCount: true,
      amountOwedCents: true,
      _count: { select: { payments: true } },
    },
  });

  await prisma.tripRegistration.delete({ where: { id } });

  await recordAudit(session, {
    action: "tripRegistration.delete",
    summary: `Deleted the trip registration for ${registration?.familyName ?? id}${
      registration && registration._count.payments > 0
        ? ` — along with ${registration._count.payments} recorded payment(s)`
        : ""
    }`,
    entityType: "TripRegistration",
    entityId: id,
    details: registration
      ? [
          { label: "Family name", from: registration.familyName, to: "—" },
          { label: "Email", from: registration.contactEmail, to: "—" },
          { label: "Attendees", from: `${registration.payingCount} paying, ${registration.freeCount} free`, to: "—" },
          { label: "Amount owed", from: auditMoney(registration.amountOwedCents), to: "—" },
        ]
      : null,
  });

  revalidateTripAdminPages();
}
