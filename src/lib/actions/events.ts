"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertAdmin, canViewParentContacts } from "@/lib/authorize";
import { RANK_ORDER } from "@/lib/rankConfig";
import { DEADLINE_CATEGORY_LABELS } from "@/lib/deadlineCategories";
import { recordAudit, recordAuditInTransaction, changedFields, auditMoney, auditDate } from "@/lib/audit";
import { deleteUploadedBlob } from "@/lib/blobCleanup";
import { uploadFlyer } from "@/lib/flyerUpload";
import { UploadRejectedError } from "@/lib/uploadValidation";
import {
  MAX_CENTS,
  MAX_NAME_LENGTH,
  MAX_NOTE_LENGTH,
  dollarsToCents,
  multiplyCents,
  parseCount,
  textField,
} from "@/lib/formValues";
import { readDateOnlyField, todayDateOnly } from "@/lib/dateOnly";
import { upcomingVisibleEventWhere } from "@/lib/eventsData";
import {
  ADMIN_GUEST_GROUP_MAX_PEOPLE,
  SELF_SERVICE_GUEST_GROUP_MAX_PEOPLE,
  SELF_SERVICE_GUEST_GROUPS_PER_EVENT,
  adminGuestGroupEditMaxPeople,
  isSubmissionKey,
} from "@/lib/guestGroupLimits";
import { centsFieldText, isUnchangedText, textLengthAsTyped } from "@/lib/savedFormValues";
import { guestGroupEditVersion, registrationEditVersion } from "@/lib/eventEditVersion";
import { keepPaymentRecords, lockPaymentRowForDelete } from "@/lib/paymentRecords";
import type { Prisma } from "@/generated/prisma/client";
import type { DeadlineCategory } from "@/generated/prisma/enums";
import type { SessionPayload } from "@/lib/session";

/**
 * What the forms built on ActionForm or TripAdminForm get back: `error` is
 * shown above the fields. Nothing (or {}) means it saved. `stale` marks a
 * refusal about something that changed after the page loaded rather than
 * about what was typed; the action refreshes the page with it, and
 * TripAdminForm then shows the page as it now stands instead of putting the
 * Admin's entries back. A row deleted since the page loaded is the exception
 * (see EVENT_GONE): its page can only refresh to a not-found page, which
 * would replace the message, so that refusal leaves the page as it loaded.
 */
export type EventFormResult = { error?: string; stale?: boolean };

/**
 * A mistake in what was entered, or a sign-up or edit that's no longer
 * possible (the event closed, the group already exists, someone else changed
 * the row first). Actions behind ActionForm or TripAdminForm return its
 * message as { error } instead of throwing to the error page — in production
 * Next replaces a thrown message with a generic one, so a family or Admin
 * would never see why. Thrown rather than returned so that, thrown inside a
 * transaction, it also rolls back everything that transaction wrote.
 * Anything else (not signed in, a tampered request, the database down) is
 * still thrown.
 */
class EventInputError extends Error {
  readonly stale: boolean;

  constructor(message: string, options: { stale?: boolean } = {}) {
    super(message);
    this.stale = options.stale ?? false;
  }
}

async function asResult(work: () => Promise<void>): Promise<EventFormResult> {
  try {
    await work();
    return {};
  } catch (error) {
    if (!(error instanceof EventInputError)) throw error;
    return error.stale ? { error: error.message, stale: true } : { error: error.message };
  }
}

/** Interactive transactions here lock one row and do a handful of small queries. */
const TX = { timeout: 15_000, maxWait: 10_000 };

const MAX_AMOUNT_TEXT = `$${(MAX_CENTS / 100).toLocaleString("en-US")}`;
const NOT_OPEN = "This event isn't open for self-registration.";
const STALE_FORM = "This form was already used or is out of date. Reload the page and try again.";

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

/** A row id from a hidden field. "" when missing, or longer than any id this app makes (a cuid is 25 characters). */
function idField(raw: FormDataEntryValue | null): string {
  const value = textField(raw);
  return value.length <= 64 ? value : "";
}

/**
 * Locks an event's row until the transaction ends; false if the event is
 * gone. Every sign-up for an event takes this lock before it checks anything,
 * so the checks (still open, the fee, how many groups this login has, whether
 * this form was already sent) and the insert happen one sign-up at a time, and
 * an Admin's edit to the event either lands before a sign-up reads it or waits
 * until that sign-up is saved.
 */
async function lockEvent(tx: Prisma.TransactionClient, eventId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Event" WHERE id = ${eventId} FOR UPDATE`;
  return rows.length > 0;
}

/**
 * " — 3 payments ($45.00) kept in Payment Records" for a delete's audit
 * summary, or "" when it took no payments with it.
 */
function keptPaymentsText(kept: { count: number; totalCents: number }) {
  if (kept.count === 0) return "";
  const n = kept.count === 1 ? "1 payment" : `${kept.count} payments`;
  return ` — ${n} (${auditMoney(kept.totalCents)}) kept in Payment Records`;
}

/** An event's title for audit text, falling back to the raw id. */
async function eventTitle(eventId: string, db: Prisma.TransactionClient = prisma) {
  if (!eventId) return "an event";
  const event = await db.event.findUnique({ where: { id: eventId }, select: { title: true } });
  return event?.title ?? eventId;
}

/** A registration's scout name + den + event title, for audit text on registration/payment changes. */
async function registrationContext(registrationId: string) {
  const registration = await prisma.eventRegistration.findUnique({
    where: { id: registrationId },
    select: {
      eventId: true,
      event: { select: { title: true } },
      scout: { select: { firstName: true, lastName: true, denId: true } },
    },
  });
  if (!registration) return { scoutName: registrationId, eventTitle: "an event", denId: null, eventId: null };
  return {
    scoutName: `${registration.scout.firstName} ${registration.scout.lastName}`,
    eventTitle: registration.event.title,
    denId: registration.scout.denId,
    eventId: registration.eventId,
  };
}

// ---------------------------------------------------------------------------
// Reading form fields. Every limit is checked here, on the server, before
// anything is written: the browser's max/maxLength hints are only hints.
//
// The limits are newer than some saved rows (see src/lib/savedFormValues.ts).
// The edit actions pass in the row as it's saved, and a value saved before a
// limit is accepted when it comes back unchanged, so an old event or group
// can still be edited; anything new or changed has to fit.
// ---------------------------------------------------------------------------

function isDeadlineCategory(value: string): value is DeadlineCategory {
  return Object.hasOwn(DEADLINE_CATEGORY_LABELS, value);
}

/**
 * A dollars field, or null if it isn't a valid amount. `saved` is the amount
 * the edit form was loaded with: one above MAX_CENTS, saved before that
 * ceiling, is still accepted when sent back exactly as the form showed it.
 */
function readCents(text: string, saved: number | null | undefined): number | null {
  const cents = dollarsToCents(text);
  if (cents !== null) return cents;
  if (saved !== null && saved !== undefined && text === centsFieldText(saved)) return saved;
  return null;
}

/** An optional fee field: blank is null (no default fee). */
function optionalCents(raw: FormDataEntryValue | null, label: string, saved?: number | null): number | null {
  const text = textField(raw);
  if (!text) return null;
  const cents = readCents(text, saved);
  if (cents === null) {
    throw new EventInputError(`${label} isn't a valid amount. Use dollars and cents, up to ${MAX_AMOUNT_TEXT}.`);
  }
  return cents;
}

/** The fields of a saved event its edit form sends back and readEventFields checks against. */
type SavedEventFields = {
  title: string;
  description: string | null;
  feeCents: number | null;
  adultFeeCents: number | null;
  guestChildFeeCents: number | null;
};

/** What updateEventAction reads of the saved event: the fields above, plus what its audit entry compares. */
const SAVED_EVENT_SELECT = {
  title: true,
  category: true,
  eventDate: true,
  description: true,
  feeCents: true,
  adultFeeCents: true,
  guestChildFeeCents: true,
  flyerUrl: true,
} as const;

/**
 * Title, category, date, description and default fees from the create/edit
 * event forms. `saved` (edit only) is the event as it's saved now.
 */
function readEventFields(formData: FormData, saved?: SavedEventFields) {
  const title = textField(formData.get("title"));
  if (!title) throw new EventInputError("Enter a title.");
  if (title.length > MAX_NAME_LENGTH && !isUnchangedText(title, saved?.title)) {
    throw new EventInputError(`Keep the title to ${MAX_NAME_LENGTH} characters or fewer.`);
  }

  const category = textField(formData.get("category")) || "GENERAL";
  if (!isDeadlineCategory(category)) throw new EventInputError("Choose a category from the list.");

  const eventDate = readDateOnlyField(formData.get("eventDate"), "Event date");
  if (eventDate.error !== undefined) throw new EventInputError(eventDate.error);
  if (!eventDate.date) throw new EventInputError("Enter the event date.");

  // Counted the way the textarea's maxLength counts it (a line break is one
  // character), so whatever the browser let through fits here too.
  const description = textField(formData.get("description"));
  if (textLengthAsTyped(description) > MAX_NOTE_LENGTH && !isUnchangedText(description, saved?.description)) {
    throw new EventInputError(`Keep the description to ${MAX_NOTE_LENGTH} characters or fewer.`);
  }

  return {
    title,
    category,
    eventDate: eventDate.date,
    description: description || null,
    feeCents: optionalCents(formData.get("fee"), "The fee per scout", saved?.feeCents),
    adultFeeCents: optionalCents(formData.get("adultFee"), "The fee per adult", saved?.adultFeeCents),
    guestChildFeeCents: optionalCents(formData.get("guestChildFee"), "The fee per guest child", saved?.guestChildFeeCents),
  };
}

/** A payment from the Record a Payment forms: amount above $0, optional date (today) and note. */
function readPayment(formData: FormData) {
  const amountCents = dollarsToCents(textField(formData.get("amount")));
  if (amountCents === null || amountCents === 0) {
    throw new EventInputError(`Enter a payment amount above $0, in dollars and cents, up to ${MAX_AMOUNT_TEXT}.`);
  }
  const paidOn = readDateOnlyField(formData.get("paidOn"), "Payment date");
  if (paidOn.error !== undefined) throw new EventInputError(paidOn.error);
  const note = textField(formData.get("note"));
  if (note.length > MAX_NOTE_LENGTH) {
    throw new EventInputError(`Keep the note to ${MAX_NOTE_LENGTH} characters or fewer.`);
  }
  return { amountCents, paidOn: paidOn.date ?? todayDateOnly(), note: note || null };
}

/** The scouts checked on a sign-up form, each once. More than the whole pack is a hand-built request. */
function checkedScoutIds(formData: FormData): string[] {
  const ids = [...new Set(formData.getAll("scoutId").map(idField).filter(Boolean))];
  if (ids.length > 500) throw new Error("Too many scouts in one sign-up.");
  return ids;
}

/** A guest group's "Family Name / Guest Name". `saved` (edit only) is the name as it's saved now. */
function readGroupName(formData: FormData, saved?: string): string {
  const name = textField(formData.get("familyName"));
  if (!name) throw new EventInputError("Enter a family or guest name.");
  if (name.length > MAX_NAME_LENGTH && !isUnchangedText(name, saved)) {
    throw new EventInputError(`Keep the name to ${MAX_NAME_LENGTH} characters or fewer.`);
  }
  return name;
}

/**
 * One headcount field, up to `max`. parseCount takes plain digits only, so
 * "1e3", "0x10", "2.0", "-1" and "+3" fail as not-a-number; plain digits
 * that only failed the ceiling get the group-size message instead.
 */
function readCount(raw: FormDataEntryValue | null, what: string, max: number, tooMany: string): number {
  const count = parseCount(raw, max);
  if (count !== null) return count;
  if (typeof raw === "string" && /^\d+$/.test(raw.trim())) throw new EventInputError(tooMany);
  throw new EventInputError(`Enter the number of ${what} as a whole number, like 2.`);
}

/** Adults and kids for one guest group: at least one person, at most `maxPeople` together. */
function readHeadcounts(formData: FormData, maxPeople: number, tooMany: string) {
  const adultCount = readCount(formData.get("adultCount"), "adults", maxPeople, tooMany);
  const childCount = readCount(formData.get("childCount"), "kids", maxPeople, tooMany);
  if (adultCount + childCount === 0) throw new EventInputError("Enter at least one adult or child.");
  if (adultCount + childCount > maxPeople) throw new EventInputError(tooMany);
  return { adultCount, childCount };
}

const SELF_SERVICE_TOO_MANY =
  `Online sign-up is limited to ${SELF_SERVICE_GUEST_GROUP_MAX_PEOPLE} people per group. ` +
  "For a bigger group, ask an Admin to register it for you.";

const ADMIN_TOO_MANY =
  `A guest group can have at most ${ADMIN_GUEST_GROUP_MAX_PEOPLE} people. ` +
  "Split a bigger group into more than one.";

/**
 * Adults and kids from an Admin's edit of a saved group: up to the Admin
 * ceiling, or, for a group saved bigger than that before the ceiling existed,
 * up to its saved size (adminGuestGroupEditMaxPeople).
 */
function readEditedHeadcounts(formData: FormData, saved: { adultCount: number; childCount: number }) {
  const savedPeople = saved.adultCount + saved.childCount;
  const maxPeople = adminGuestGroupEditMaxPeople(savedPeople);
  if (maxPeople === ADMIN_GUEST_GROUP_MAX_PEOPLE) return readHeadcounts(formData, maxPeople, ADMIN_TOO_MANY);
  return readHeadcounts(
    formData,
    maxPeople,
    `This group was saved with ${savedPeople} people, more than the ${ADMIN_GUEST_GROUP_MAX_PEOPLE} a group can ` +
      "have now. It can keep that many or fewer, but not more.",
  );
}

/** The amount owed an Admin types for a guest group. `saved` (edit only) is the amount saved now. */
function readAmountOwed(formData: FormData, saved?: number): number {
  const cents = readCents(textField(formData.get("amountOwed")), saved);
  if (cents === null) {
    throw new EventInputError(`Enter the amount owed in dollars and cents, up to ${MAX_AMOUNT_TEXT}.`);
  }
  return cents;
}

/**
 * A group's total at the event's per-head fees, or null when it's more than
 * any one amount can be (MAX_CENTS). multiplyCents refuses an unsafe or
 * oversize product before it can round or overflow the 32-bit column.
 */
function guestTotalCents(
  adultCount: number,
  adultFeeCents: number | null,
  childCount: number,
  guestChildFeeCents: number | null,
): number | null {
  const adults = multiplyCents(adultCount, adultFeeCents ?? 0);
  const kids = multiplyCents(childCount, guestChildFeeCents ?? 0);
  if (adults === null || kids === null || adults + kids > MAX_CENTS) return null;
  return adults + kids;
}

type GuestOf = { guestOfScoutId: string | null; guestOfUserId: string | null };

/**
 * Parses a "Guest Of" <select> value of the form "scout:<id>" | "user:<id>" |
 * "" into the two mutually-exclusive FK fields. Anything else isn't one of
 * the options the picker offers.
 */
function readGuestOf(raw: FormDataEntryValue | null): GuestOf {
  const value = textField(raw);
  if (!value) return { guestOfScoutId: null, guestOfUserId: null };
  const match = /^(scout|user):([^:\s]{1,64})$/.exec(value);
  if (!match) throw new EventInputError("Choose a Guest Of option from the list.");
  return match[1] === "scout"
    ? { guestOfScoutId: match[2], guestOfUserId: null }
    : { guestOfScoutId: null, guestOfUserId: match[2] };
}

/** The scout or login a group is linked to still exists (an inactive one stays a valid link). */
async function assertGuestOfExists(tx: Prisma.TransactionClient, guestOf: GuestOf) {
  if (guestOf.guestOfScoutId) {
    const scout = await tx.scout.findUnique({ where: { id: guestOf.guestOfScoutId }, select: { id: true } });
    if (!scout) throw new EventInputError("That scout is no longer on the roster. Reload the page and choose again.");
  }
  if (guestOf.guestOfUserId) {
    const user = await tx.user.findUnique({ where: { id: guestOf.guestOfUserId }, select: { id: true } });
    if (!user) throw new EventInputError("That login no longer exists. Reload the page and choose again.");
  }
}

// ---------------------------------------------------------------------------
// Flyers
// ---------------------------------------------------------------------------

/** Uploads the flyer from the form, if one was chosen. */
async function uploadEventFlyer(raw: FormDataEntryValue | null): Promise<string | null> {
  if (!(raw instanceof File) || raw.size === 0) return null;
  try {
    return await uploadFlyer(raw, "event-flyers");
  } catch (error) {
    // uploadFlyer's own refusals (wrong type, too big, not really an image or
    // PDF) are written for the Admin; anything else is a storage failure and
    // goes to the error page as before.
    if (error instanceof UploadRejectedError) throw new EventInputError(error.message);
    throw error;
  }
}

/**
 * Runs the database write that will point at a flyer just uploaded. If the
 * write fails, the upload is deleted again — otherwise it would sit in Blob
 * storage, public at its URL, with no row referring to it.
 */
async function writeWithFlyer<T>(uploadedUrl: string | null, write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (uploadedUrl) await deleteUploadedBlob(uploadedUrl);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export async function createEventAction(formData: FormData): Promise<EventFormResult> {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  let eventId = "";
  const result = await asResult(async () => {
    const fields = readEventFields(formData);
    const flyerUrl = await uploadEventFlyer(formData.get("flyer"));
    const event = await writeWithFlyer(flyerUrl, () => prisma.event.create({ data: { ...fields, flyerUrl } }));
    eventId = event.id;

    await recordAudit(session, {
      action: "event.create",
      summary: `Created the event “${fields.title}” on ${auditDate(fields.eventDate)}`,
      entityType: "Event",
      entityId: event.id,
      details: [
        { label: "Title", from: "—", to: fields.title },
        { label: "Category", from: "—", to: DEADLINE_CATEGORY_LABELS[fields.category] ?? fields.category },
        { label: "Event date", from: "—", to: auditDate(fields.eventDate) },
        ...(fields.feeCents !== null ? [{ label: "Scout fee", from: "—", to: auditMoney(fields.feeCents) }] : []),
        ...(fields.adultFeeCents !== null
          ? [{ label: "Adult fee", from: "—", to: auditMoney(fields.adultFeeCents) }]
          : []),
        ...(fields.guestChildFeeCents !== null
          ? [{ label: "Guest child fee", from: "—", to: auditMoney(fields.guestChildFeeCents) }]
          : []),
        ...(flyerUrl ? [{ label: "Flyer", from: "—", to: "Uploaded" }] : []),
      ],
    });
  });
  if (result.error) return result;

  revalidatePath("/portal/admin/events");
  revalidatePath("/portal/parent");
  revalidatePath("/portal/roster/family-view");
  redirect(`/portal/admin/events/${eventId}`);
}

/**
 * The edit forms' answer when what they edit was deleted after the page
 * loaded. Not `stale`, although it is out of date: the pages for an event, a
 * registration and a guest group call notFound() once the row is gone, so
 * refreshing the page would put the not-found page in place of this message
 * and leave the Admin wondering where their edit went. Left as it loaded,
 * the page shows the message above what they typed.
 */
const EVENT_GONE = "This event no longer exists — someone may have just deleted it. Nothing was saved.";
const REGISTRATION_GONE = "This registration no longer exists — someone may have just removed it. Nothing was saved.";
const GUEST_GROUP_GONE = "This guest group no longer exists — someone may have just removed it. Nothing was saved.";

function revalidateEventPages(eventId: string) {
  revalidatePath(`/portal/admin/events/${eventId}`);
  revalidatePath("/portal/admin/events");
  revalidatePath("/portal/parent");
  revalidatePath("/portal/roster/family-view");
}

/**
 * The Edit Event Details form (TripAdminForm, so a refusal is shown above
 * the fields with what the Admin typed put back, and its SaveButton only
 * says "Saved ✓" after a save that went through). A mistake in a field or a
 * flyer the upload checks turn down comes back as { error }, with nothing
 * uploaded or written; so does an event deleted meanwhile (EVENT_GONE).
 */
export async function updateEventAction(formData: FormData): Promise<EventFormResult> {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const id = idField(formData.get("id"));
  if (!id) throw new Error("Missing event id.");
  const removeFlyer = textField(formData.get("removeFlyer")) === "true";

  const result = await asResult(async () => {
    // Turned away, and the fields checked against the event as saved, before
    // anything is uploaded for it.
    const saved = await prisma.event.findUnique({ where: { id }, select: SAVED_EVENT_SELECT });
    if (!saved) throw new EventInputError(EVENT_GONE);
    readEventFields(formData, saved);

    // Only touch flyerUrl when a new file was uploaded or "remove" was
    // checked, so leaving both alone keeps whatever flyer is already saved.
    // A file the upload checks refuse (the wrong type, too big, labeled as
    // one kind of file but really another) stops here, with nothing written.
    const uploadedUrl = await uploadEventFlyer(formData.get("flyer"));
    const flyerUrl: string | null | undefined = uploadedUrl ?? (removeFlyer ? null : undefined);

    const { before, fields } = await writeWithFlyer(uploadedUrl, () =>
      prisma.$transaction(async (tx) => {
        // Re-read under the lock, so the flyer this replaces is the one saved
        // right now: two Admins replacing it at once would otherwise both
        // delete the same old file and leave one of the new uploads behind.
        if (!(await lockEvent(tx, id))) throw new EventInputError(EVENT_GONE);
        const previous = await tx.event.findUniqueOrThrow({ where: { id }, select: SAVED_EVENT_SELECT });
        // Checked again against the locked row: an over-limit title kept "as
        // is" has to still be the saved one, not one another Admin has just
        // replaced.
        const fields = readEventFields(formData, previous);
        await tx.event.update({
          where: { id },
          data: { ...fields, ...(flyerUrl !== undefined ? { flyerUrl } : {}) },
        });
        return { before: previous, fields };
      }, TX),
    );

    // After the row is updated: a stray object is a better failure than a row
    // pointing at a flyer that's already gone. Same helper as albums.ts.
    if (flyerUrl !== undefined && before.flyerUrl && before.flyerUrl !== flyerUrl) {
      await deleteUploadedBlob(before.flyerUrl);
    }

    const money = (cents: number | null) => (cents === null ? null : auditMoney(cents));
    await recordAudit(session, {
      action: "event.update",
      summary: `Edited the event “${fields.title}”`,
      entityType: "Event",
      entityId: id,
      details: [
        ...changedFields({
          Title: [before.title, fields.title],
          Category: [
            DEADLINE_CATEGORY_LABELS[before.category] ?? before.category,
            DEADLINE_CATEGORY_LABELS[fields.category] ?? fields.category,
          ],
          "Event date": [before.eventDate, fields.eventDate],
          Description: [before.description, fields.description],
          "Scout fee": [money(before.feeCents), money(fields.feeCents)],
          "Adult fee": [money(before.adultFeeCents), money(fields.adultFeeCents)],
          "Guest child fee": [money(before.guestChildFeeCents), money(fields.guestChildFeeCents)],
        }),
        ...(flyerUrl === undefined
          ? []
          : [{ label: "Flyer", from: "Previous", to: flyerUrl === null ? "—" : "Replaced" }]),
      ],
    });
  });

  // A refusal about what was typed, or about a row deleted meanwhile (see
  // EVENT_GONE), leaves the page as it loaded, so the Admin's entries go back
  // over it; a stale one refreshes it.
  if (result.error && !result.stale) return result;
  revalidateEventPages(id);
  return result;
}

export async function toggleEventVisibilityAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const id = String(formData.get("id") || "");
  const visible = String(formData.get("visible") || "") === "true";
  if (!id) throw new Error("Missing event id.");

  const event = await prisma.event.update({ where: { id }, data: { visible: !visible } });

  await recordAudit(session, {
    action: "event.toggleVisibility",
    summary: `${event.visible ? "Opened" : "Hid"} the event “${event.title}” ${
      event.visible ? "for" : "from"
    } family self-registration`,
    entityType: "Event",
    entityId: id,
    details: [{ label: "Visible", from: visible ? "Yes" : "No", to: event.visible ? "Yes" : "No" }],
  });

  revalidatePath(`/portal/admin/events/${id}`);
  revalidatePath("/portal/admin/events");
  revalidatePath("/portal/parent");
  revalidatePath("/portal/roster/family-view");
}

export async function deleteEventAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const id = idField(formData.get("id"));
  if (!id) throw new Error("Missing event id.");

  const deleted = await prisma.$transaction(async (tx) => {
    // The same lock updateEventAction takes, and the flyer read under it. An
    // edit that's replacing the flyer right now finishes first; it deletes
    // the flyer it replaced, and this then deletes the one it left. Read
    // before the lock, this would delete the replaced one a second time and
    // leave the new upload public with nothing pointing at it.
    if (!(await lockEvent(tx, id))) return null; // Already gone (a second click, or another Admin).
    const event = await tx.event.findUniqueOrThrow({
      where: { id },
      select: {
        title: true,
        eventDate: true,
        flyerUrl: true,
        _count: { select: { registrations: true, guestGroups: true } },
      },
    });

    // Every scout's and guest group's payment goes with the event (the
    // cascade); copy them to Payment Records first so the money isn't lost.
    const kept = await keepPaymentRecords(
      tx,
      { eventId: id },
      { session, reason: `Event "${event.title}" deleted` },
    );

    await tx.event.delete({ where: { id } });

    await recordAuditInTransaction(tx, session, {
      action: "event.delete",
      summary: `Deleted the event “${event.title}”${
        event._count.registrations + event._count.guestGroups > 0
          ? ` — along with ${event._count.registrations} scout registration(s) and ${event._count.guestGroups} guest group(s)`
          : ""
      }${keptPaymentsText(kept)}`,
      entityType: "Event",
      entityId: id,
      details: [
        { label: "Title", from: event.title, to: "—" },
        { label: "Event date", from: auditDate(event.eventDate), to: "—" },
        { label: "Scout registrations", from: String(event._count.registrations), to: "—" },
        { label: "Guest groups", from: String(event._count.guestGroups), to: "—" },
        ...(kept.count > 0
          ? [{ label: "Payments kept in Payment Records", from: "—", to: `${kept.count} (${auditMoney(kept.totalCents)})` }]
          : []),
      ],
    });
    return event;
  }, TX);

  // The uploaded flyer goes with the event; otherwise it stays public at its
  // original URL with nothing left linking to it. After the commit, like
  // every other cleanup: a stray object is a better failure than a row
  // pointing at a flyer that's already gone.
  if (deleted) await deleteUploadedBlob(deleted.flyerUrl);

  revalidatePath("/portal/admin/events");
  revalidatePath("/portal/admin/payment-records");
  redirect("/portal/admin/events");
}

// ---------------------------------------------------------------------------
// Scout registrations and their payments
// ---------------------------------------------------------------------------

/**
 * The scouts a sign-up names, read inside its transaction. New sign-ups are
 * for active scouts only; the pickers don't offer anyone else, this stops a
 * request built by hand or a form left open while a scout was switched off.
 */
async function activeScoutsForSignUp(tx: Prisma.TransactionClient, scoutIds: string[]) {
  const scouts = await tx.scout.findMany({
    where: { id: { in: scoutIds } },
    select: { id: true, firstName: true, lastName: true, denId: true, active: true },
  });
  if (scouts.length !== scoutIds.length) {
    throw new EventInputError("One or more of those scouts is no longer on the roster. Reload the page and try again.");
  }
  if (scouts.some((s) => !s.active)) throw new EventInputError("One or more of those scouts is inactive.");
  return scouts;
}

export async function registerScoutForEventAction(formData: FormData): Promise<EventFormResult> {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const eventId = idField(formData.get("eventId"));
  if (!eventId) throw new Error("Missing event id.");

  const result = await asResult(async () => {
    const scoutIds = checkedScoutIds(formData);
    if (scoutIds.length === 0) throw new EventInputError("Check at least one scout to register.");
    const amountOwedCents = readAmountOwed(formData);

    await prisma.$transaction(async (tx) => {
      if (!(await lockEvent(tx, eventId))) throw new EventInputError("This event no longer exists.");
      const scouts = await activeScoutsForSignUp(tx, scoutIds);

      const existing = await tx.eventRegistration.findMany({
        where: { eventId, scoutId: { in: scoutIds } },
        select: { scoutId: true },
      });
      const alreadyRegistered = new Set(existing.map((r) => r.scoutId));
      const added = scouts.filter((s) => !alreadyRegistered.has(s.id));
      if (added.length === 0) throw new EventInputError("Those scouts are already registered for this event.");

      await tx.eventRegistration.createMany({
        data: added.map((s) => ({ eventId, scoutId: s.id, amountOwedCents })),
      });

      const names = added.map((sc) => `${sc.firstName} ${sc.lastName}`).sort();
      await recordAuditInTransaction(tx, session, {
        action: "eventRegistration.create",
        summary: `Registered ${names.join(", ")} for “${await eventTitle(eventId, tx)}” at ${auditMoney(
          amountOwedCents,
        )} each`,
        entityType: "Event",
        entityId: eventId,
        // Only tagged with a den when every scout came from the same one.
        denId: new Set(added.map((sc) => sc.denId)).size === 1 ? added[0].denId : null,
        details: [
          { label: "Scouts registered", from: "—", to: names.join(", ") },
          { label: "Amount owed each", from: "—", to: auditMoney(amountOwedCents) },
        ],
      });
    }, TX);
  });
  if (result.error) return result;

  revalidatePath(`/portal/admin/events/${eventId}`);
  return {};
}

/**
 * A scout registration's amount owed, from its Manage Payments page
 * (TripAdminForm). The form carries registrationEditVersion of the amount it
 * loaded with. If another Admin changed the amount since, the save is
 * refused and the page refreshed: the new figure was decided against one
 * that's no longer there, and saving it anyway would quietly replace the
 * other Admin's change (a discount, a correction) with neither of them
 * knowing.
 */
export async function updateRegistrationAmountAction(formData: FormData): Promise<EventFormResult> {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const registrationId = idField(formData.get("registrationId"));
  const eventId = idField(formData.get("eventId"));
  if (!registrationId) throw new Error("Missing registration id.");

  const result = await asResult(async () => {
    const version = textField(formData.get("version"));

    await prisma.$transaction(async (tx) => {
      // The same row lock recording a payment takes, held until the new
      // amount and its audit entry commit.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "EventRegistration" WHERE id = ${registrationId} FOR UPDATE`;
      if (locked.length === 0) throw new EventInputError(REGISTRATION_GONE);
      const registration = await tx.eventRegistration.findUniqueOrThrow({
        where: { id: registrationId },
        select: {
          amountOwedCents: true,
          event: { select: { title: true } },
          scout: { select: { firstName: true, lastName: true, denId: true } },
        },
      });
      // Before the amount is read: a page that's out of date says so, rather
      // than that what was typed doesn't fit.
      if (registrationEditVersion(registration) !== version) {
        throw new EventInputError(
          `Someone changed this amount owed after this page loaded (it's now ${auditMoney(
            registration.amountOwedCents,
          )}). Nothing was saved — the page now shows the current amount; change it again if it still needs changing.`,
          { stale: true },
        );
      }
      const amountOwedCents = readAmountOwed(formData, registration.amountOwedCents);
      const scoutName = `${registration.scout.firstName} ${registration.scout.lastName}`;

      await tx.eventRegistration.update({ where: { id: registrationId }, data: { amountOwedCents } });

      await recordAuditInTransaction(tx, session, {
        action: "eventRegistration.updateAmount",
        summary: `Changed what ${scoutName} owes for “${registration.event.title}” to ${auditMoney(amountOwedCents)}`,
        entityType: "EventRegistration",
        entityId: registrationId,
        denId: registration.scout.denId,
        details: changedFields({
          "Amount owed": [auditMoney(registration.amountOwedCents), auditMoney(amountOwedCents)],
        }),
      });
    }, TX);
  });
  // A refusal about what was typed, or about a row deleted meanwhile (see
  // EVENT_GONE), leaves the page as it loaded, so the Admin's entry goes back
  // over it; a stale one refreshes it.
  if (result.error && !result.stale) return result;

  revalidatePath(`/portal/admin/events/${eventId}/${registrationId}`);
  revalidatePath(`/portal/admin/events/${eventId}`);
  revalidatePath("/portal/admin/events");
  return result;
}

export async function removeRegistrationAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const registrationId = idField(formData.get("registrationId"));
  const eventId = idField(formData.get("eventId"));
  if (!registrationId) throw new Error("Missing registration id.");

  await prisma.$transaction(async (tx) => {
    // The same row lock addEventPaymentAction takes: a payment recorded while
    // this runs either lands first (and is kept below) or waits and then
    // finds the registration gone.
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "EventRegistration" WHERE id = ${registrationId} FOR UPDATE`;
    if (locked.length === 0) return; // Already gone (a second click, or another Admin).
    const registration = await tx.eventRegistration.findUniqueOrThrow({
      where: { id: registrationId },
      select: {
        amountOwedCents: true,
        event: { select: { title: true } },
        scout: { select: { firstName: true, lastName: true, denId: true } },
      },
    });
    const scoutName = `${registration.scout.firstName} ${registration.scout.lastName}`;

    // The cascade takes the payments with it; Payment Records keeps them.
    const kept = await keepPaymentRecords(
      tx,
      { eventRegistrationId: registrationId },
      { session, reason: `${scoutName} removed from "${registration.event.title}"` },
    );

    await tx.eventRegistration.delete({ where: { id: registrationId } });

    await recordAuditInTransaction(tx, session, {
      action: "eventRegistration.delete",
      summary: `Removed ${scoutName} from “${registration.event.title}”${keptPaymentsText(kept)}`,
      entityType: "EventRegistration",
      entityId: registrationId,
      denId: registration.scout.denId,
      details: [
        { label: "Amount owed", from: auditMoney(registration.amountOwedCents), to: "—" },
        { label: "Payments removed", from: String(kept.count), to: "—" },
        ...(kept.count > 0
          ? [{ label: "Payments kept in Payment Records", from: "—", to: `${kept.count} (${auditMoney(kept.totalCents)})` }]
          : []),
      ],
    });
  }, TX);

  revalidatePath(`/portal/admin/events/${eventId}`);
  revalidatePath("/portal/admin/events");
  revalidatePath("/portal/admin/payment-records");
}

export async function addEventPaymentAction(formData: FormData): Promise<EventFormResult> {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const registrationId = idField(formData.get("registrationId"));
  const eventId = idField(formData.get("eventId"));
  if (!registrationId) throw new Error("Missing registration id.");

  const result = await asResult(async () => {
    const { amountCents, paidOn, note } = readPayment(formData);

    await prisma.$transaction(async (tx) => {
      // The registration first, so removing it (which takes its payments
      // with it) can't interleave with this payment being added.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "EventRegistration" WHERE id = ${registrationId} FOR UPDATE`;
      if (locked.length === 0) throw new EventInputError("This registration no longer exists.");
      const registration = await tx.eventRegistration.findUniqueOrThrow({
        where: { id: registrationId },
        select: {
          event: { select: { title: true } },
          scout: { select: { firstName: true, lastName: true, denId: true } },
        },
      });

      const payment = await tx.eventPayment.create({
        data: { eventRegistrationId: registrationId, amountCents, paidOn, note, recordedByUserId: session.userId },
      });

      await recordAuditInTransaction(tx, session, {
        action: "eventPayment.add",
        summary: `Recorded a ${auditMoney(amountCents)} payment for ${registration.scout.firstName} ${
          registration.scout.lastName
        } on “${registration.event.title}”`,
        entityType: "EventPayment",
        entityId: payment.id,
        denId: registration.scout.denId,
        details: [
          { label: "Amount", from: "—", to: auditMoney(amountCents) },
          { label: "Paid on", from: "—", to: auditDate(paidOn) },
          ...(note ? [{ label: "Note", from: "—", to: note }] : []),
        ],
      });
    }, TX);
  });
  if (result.error) return result;

  revalidatePath(`/portal/admin/events/${eventId}/${registrationId}`);
  revalidatePath(`/portal/admin/events/${eventId}`);
  revalidatePath("/portal/admin/events");
  return {};
}

export async function registerMyScoutsForEventAction(formData: FormData): Promise<EventFormResult> {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  if (session.role !== "PARENT") throw new Error("Not authorized.");

  const eventId = idField(formData.get("eventId"));
  const scoutIds = checkedScoutIds(formData);
  // Only the family's own scouts; scoutIds is baked into the signed session.
  const allowedScoutIds = new Set(session.scoutIds);
  if (!scoutIds.every((id) => allowedScoutIds.has(id))) {
    throw new Error("Not authorized for one or more of those scouts.");
  }

  const result = await asResult(async () => {
    if (!eventId) throw new EventInputError(NOT_OPEN);
    if (scoutIds.length === 0) throw new EventInputError("Select at least one scout.");

    await prisma.$transaction(async (tx) => {
      if (!(await lockEvent(tx, eventId))) throw new EventInputError(NOT_OPEN);
      const event = await tx.event.findFirst({
        where: { id: eventId, ...upcomingVisibleEventWhere() },
        select: { feeCents: true, title: true },
      });
      if (!event || event.feeCents === null) throw new EventInputError(NOT_OPEN);
      const feeCents = event.feeCents;
      const scouts = await activeScoutsForSignUp(tx, scoutIds);

      const existing = await tx.eventRegistration.findMany({
        where: { eventId, scoutId: { in: scoutIds } },
        select: { scoutId: true },
      });
      const alreadyRegistered = new Set(existing.map((r) => r.scoutId));
      const added = scouts.filter((s) => !alreadyRegistered.has(s.id));
      if (added.length === 0) throw new EventInputError("Already registered for this event.");

      await tx.eventRegistration.createMany({
        data: added.map((s) => ({ eventId, scoutId: s.id, amountOwedCents: feeCents })),
      });

      const names = added.map((sc) => `${sc.firstName} ${sc.lastName}`).sort();
      await recordAuditInTransaction(tx, session, {
        action: "eventRegistration.selfRegister",
        summary: `Signed ${names.join(", ")} up for “${event.title}” at ${auditMoney(feeCents)} each`,
        entityType: "Event",
        entityId: eventId,
        denId: new Set(added.map((sc) => sc.denId)).size === 1 ? added[0].denId : null,
      });
    }, TX);
  });
  if (result.error) return result;

  revalidatePath("/portal/parent");
  return {};
}

// ---------------------------------------------------------------------------
// Guest groups
// ---------------------------------------------------------------------------

/**
 * A parent's oldest scout (furthest-along den, e.g. AOL beats Lion), used so
 * a parent's self-registered guest group is linked to their child instead of
 * to themselves. Ties within the same den are broken arbitrarily — either
 * scout is an equally correct answer. Returns null for non-parents (empty
 * scoutIds), who fall back to guestOfUserId = self.
 */
async function oldestScoutId(tx: Prisma.TransactionClient, scoutIds: string[]): Promise<string | null> {
  if (scoutIds.length === 0) return null;
  const scouts = await tx.scout.findMany({
    where: { id: { in: scoutIds } },
    select: { id: true, den: { select: { rank: true } } },
  });
  if (scouts.length === 0) return null;
  return scouts.reduce((oldest, s) =>
    RANK_ORDER.indexOf(s.den.rank) > RANK_ORDER.indexOf(oldest.den.rank) ? s : oldest,
  ).id;
}

/**
 * Who can sign a guest group up themselves: a parent (Parent Dashboard), and
 * the staff Family View offers the same form to — Admin, Den Leader, and a
 * Committee Member assigned to a den. Junior Admin, Attendance Only,
 * Photographer and the shared Trip Viewer login never get the form, so a
 * request from one is refused here too.
 */
function canSelfRegisterGuestGroups(session: SessionPayload) {
  if (session.role === "PARENT") return true;
  return session.role !== "JUNIOR_ADMIN" && canViewParentContacts(session);
}

/**
 * A guest group (a family, or a leader bringing guests) signed up by the
 * person bringing them; ownership (addedByUserId) is what lets them withdraw
 * it later (removeMyGuestGroupAction). Editing it, or recording money against
 * it, is admin-only.
 *
 * Bounded so one login can't fill an event's roster or run up a balance by
 * accident or on purpose: at most SELF_SERVICE_GUEST_GROUP_MAX_PEOPLE people
 * per group, at most SELF_SERVICE_GUEST_GROUPS_PER_EVENT groups per login per
 * event, and the total has to fit in one amount (MAX_CENTS). The form's
 * one-time submission key makes a repeated request a no-op rather than a
 * second group: the event lock makes a repeat wait for the first to finish
 * and then find its group, and the unique index on submissionKey backs that
 * up in the database.
 */
export async function registerMyGuestGroupForEventAction(formData: FormData): Promise<EventFormResult> {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  if (!canSelfRegisterGuestGroups(session)) throw new Error("Not authorized.");

  const result = await asResult(async () => {
    const eventId = idField(formData.get("eventId"));
    if (!eventId) throw new EventInputError(NOT_OPEN);
    const submissionKey = textField(formData.get("submissionKey"));
    if (!isSubmissionKey(submissionKey)) throw new EventInputError(STALE_FORM);
    const familyName = readGroupName(formData);
    const { adultCount, childCount } = readHeadcounts(
      formData,
      SELF_SERVICE_GUEST_GROUP_MAX_PEOPLE,
      SELF_SERVICE_TOO_MANY,
    );

    try {
      await prisma.$transaction(async (tx) => {
        if (!(await lockEvent(tx, eventId))) throw new EventInputError(NOT_OPEN);

        // Checked before whether the event is still open: a repeat of a
        // sign-up that already went through should say so, not report that
        // sign-up has since closed.
        const earlier = await tx.eventGuestGroup.findUnique({
          where: { submissionKey },
          select: { eventId: true, addedByUserId: true },
        });
        if (earlier) {
          if (earlier.eventId === eventId && earlier.addedByUserId === session.userId) return;
          throw new EventInputError(STALE_FORM);
        }

        const event = await tx.event.findFirst({
          where: { id: eventId, ...upcomingVisibleEventWhere() },
          select: { title: true, adultFeeCents: true, guestChildFeeCents: true },
        });
        if (!event) throw new EventInputError(NOT_OPEN);
        if (adultCount > 0 && event.adultFeeCents === null) {
          throw new EventInputError("This event isn't open for adult guest self-registration.");
        }
        if (childCount > 0 && event.guestChildFeeCents === null) {
          throw new EventInputError("This event isn't open for guest child self-registration.");
        }

        const amountOwedCents = guestTotalCents(adultCount, event.adultFeeCents, childCount, event.guestChildFeeCents);
        if (amountOwedCents === null) {
          throw new EventInputError(
            "That group's total is more than the portal can record. Ask an Admin to register it for you.",
          );
        }

        const mine = await tx.eventGuestGroup.count({ where: { eventId, addedByUserId: session.userId } });
        if (mine >= SELF_SERVICE_GUEST_GROUPS_PER_EVENT) {
          throw new EventInputError(
            `You already have ${SELF_SERVICE_GUEST_GROUPS_PER_EVENT} guest groups signed up for this event, the most ` +
              "one account can add. Remove one, or ask an Admin to add another.",
          );
        }

        // Parents are "guest of" their oldest scout, not themselves — a den
        // leader/admin with no linked scout still falls back to guestOfUserId.
        const guestOfScoutId = session.role === "PARENT" ? await oldestScoutId(tx, session.scoutIds) : null;

        const group = await tx.eventGuestGroup.create({
          data: {
            eventId,
            familyName,
            adultCount,
            childCount,
            amountOwedCents,
            addedByUserId: session.userId,
            guestOfScoutId,
            guestOfUserId: guestOfScoutId ? null : session.userId,
            submissionKey,
          },
        });

        await recordAuditInTransaction(tx, session, {
          action: "guestGroup.selfRegister",
          summary: `Signed up the guest group “${familyName}” (${adultCount} adult(s), ${childCount} child(ren)) for “${
            event.title
          }” — ${auditMoney(amountOwedCents)} owed`,
          entityType: "EventGuestGroup",
          entityId: group.id,
          details: [
            { label: "Guest group", from: "—", to: familyName },
            { label: "Adults", from: "—", to: String(adultCount) },
            { label: "Children", from: "—", to: String(childCount) },
            { label: "Amount owed", from: "—", to: auditMoney(amountOwedCents) },
          ],
        });
      }, TX);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // The same key was saved meanwhile by a request for a different event
      // (one for this event would have waited on the event lock and found
      // it above). Only a form reused by hand gets here.
      throw new EventInputError(STALE_FORM);
    }
  });
  if (result.error) return result;

  revalidatePath("/portal/parent");
  revalidatePath("/portal/roster/family-view");
  return {};
}

export async function removeMyGuestGroupAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");

  const guestGroupId = String(formData.get("guestGroupId") || "");
  if (!guestGroupId) throw new Error("Missing guest group id.");

  // Deleting the group cascades to every payment recorded against it (see
  // schema.prisma). Once an admin has logged money against a group, only an
  // admin can remove it (removeGuestGroupAction), so the financial record
  // can't be unilaterally erased by whoever registered it.
  //
  // The check and the delete share one transaction that locks the group row
  // first. Recording a payment has to take a key-share lock on that same row
  // (the foreign key check), which FOR UPDATE blocks — so a payment either
  // commits before the count (and the withdrawal is refused) or waits until
  // the group is gone (and fails). Without the lock, a payment landing
  // between the count and the delete was silently cascaded away.
  const removed = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "EventGuestGroup" WHERE id = ${guestGroupId} FOR UPDATE`;
    const group = await tx.eventGuestGroup.findUnique({
      where: { id: guestGroupId },
      select: { addedByUserId: true, _count: { select: { payments: true } } },
    });
    if (!group || group.addedByUserId !== session.userId) throw new Error("Not authorized for this guest group.");
    if (group._count.payments > 0) {
      // Refused, not kept-and-deleted: once the pack holds a family's money,
      // cancelling is a conversation about a refund, so an Admin does it
      // (removeGuestGroupAction keeps the payments in Payment Records).
      throw new Error("This guest group can't be removed here. Contact the pack to cancel it.");
    }
    return tx.eventGuestGroup.delete({ where: { id: guestGroupId } });
  });

  await recordAudit(session, {
    action: "guestGroup.selfRemove",
    summary: `Withdrew their guest group “${removed.familyName}” from “${await eventTitle(removed.eventId)}”`,
    entityType: "EventGuestGroup",
    entityId: guestGroupId,
    details: [
      { label: "Guest group", from: removed.familyName, to: "—" },
      { label: "Amount owed", from: auditMoney(removed.amountOwedCents), to: "—" },
    ],
  });

  revalidatePath("/portal/parent");
  revalidatePath("/portal/roster/family-view");
}

export async function deleteEventPaymentAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");

  const paymentId = String(formData.get("paymentId") || "");
  const registrationId = String(formData.get("registrationId") || "");
  const eventId = String(formData.get("eventId") || "");
  if (!paymentId) throw new Error("Missing payment id.");

  // Look up den access from the payment's own registration — never trust a
  // client-submitted registrationId for this check, since it travels in the
  // same form as (and independently of) paymentId.
  const payment = await prisma.eventPayment.findUnique({
    where: { id: paymentId },
    select: { eventRegistration: { select: { id: true, scout: { select: { denId: true } } } } },
  });
  if (!payment || payment.eventRegistration.id !== registrationId) throw new Error("Payment not found.");
  assertAdmin(session);

  const context = await registrationContext(registrationId);

  await prisma.$transaction(async (tx) => {
    // Locked first, then read, in the same transaction as the delete and the
    // copy to Payment Records, so a second click waits and finds nothing to do.
    if (!(await lockPaymentRowForDelete(tx, "EventPayment", paymentId))) return;
    const deleted = await tx.eventPayment.findUnique({
      where: { id: paymentId },
      select: { amountCents: true, paidOn: true, note: true },
    });
    if (!deleted) return; // Already gone.

    const kept = await keepPaymentRecords(tx, { eventPaymentId: paymentId }, { session, reason: "Payment deleted" });

    await tx.eventPayment.delete({ where: { id: paymentId } });

    await recordAuditInTransaction(tx, session, {
      action: "eventPayment.delete",
      summary: `Deleted a ${auditMoney(deleted.amountCents)} payment for ${context.scoutName} on “${
        context.eventTitle
      }”${kept.count > 0 ? " — kept in Payment Records" : ""}`,
      entityType: "EventPayment",
      entityId: paymentId,
      denId: context.denId,
      details: [
        { label: "Amount", from: auditMoney(deleted.amountCents), to: "—" },
        { label: "Paid on", from: auditDate(deleted.paidOn), to: "—" },
        ...(deleted.note ? [{ label: "Note", from: deleted.note, to: "—" }] : []),
      ],
    });
  }, TX);

  revalidatePath("/portal/admin/payment-records");
  revalidatePath(`/portal/admin/events/${eventId}/${registrationId}`);
  revalidatePath(`/portal/admin/events/${eventId}`);
  revalidatePath("/portal/admin/events");
}

// Managing guest groups — creating, editing amounts/linkage, and recording or
// removing payments — is admin-only, the same as every other money action.
// Den leaders see no money; the only thing a registrant can do to their own
// group is withdraw it (removeMyGuestGroupAction). An Admin can enter a group
// of up to ADMIN_GUEST_GROUP_MAX_PEOPLE, far more than self-registration
// allows, and sets its amount owed by hand.

export async function addGuestGroupAction(formData: FormData): Promise<EventFormResult> {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const eventId = idField(formData.get("eventId"));
  if (!eventId) throw new Error("Missing event id.");

  const result = await asResult(async () => {
    const submissionKey = textField(formData.get("submissionKey"));
    if (!isSubmissionKey(submissionKey)) throw new EventInputError(STALE_FORM);
    const familyName = readGroupName(formData);
    const guestOf = readGuestOf(formData.get("guestOf"));
    const { adultCount, childCount } = readHeadcounts(formData, ADMIN_GUEST_GROUP_MAX_PEOPLE, ADMIN_TOO_MANY);
    const amountOwedCents = readAmountOwed(formData);

    try {
      await prisma.$transaction(async (tx) => {
        if (!(await lockEvent(tx, eventId))) throw new EventInputError("This event no longer exists.");

        // The same Add pressed twice (or a retried request): the first one
        // already added the group.
        const earlier = await tx.eventGuestGroup.findUnique({
          where: { submissionKey },
          select: { eventId: true, addedByUserId: true },
        });
        if (earlier) {
          if (earlier.eventId === eventId && earlier.addedByUserId === null) return;
          throw new EventInputError(STALE_FORM);
        }

        await assertGuestOfExists(tx, guestOf);

        const group = await tx.eventGuestGroup.create({
          data: { eventId, familyName, adultCount, childCount, amountOwedCents, ...guestOf, submissionKey },
        });

        await recordAuditInTransaction(tx, session, {
          action: "guestGroup.create",
          summary: `Added the guest group “${familyName}” (${adultCount} adult(s), ${childCount} child(ren)) to “${await eventTitle(
            eventId,
            tx,
          )}” — ${auditMoney(amountOwedCents)} owed`,
          entityType: "EventGuestGroup",
          entityId: group.id,
          details: [
            { label: "Guest group", from: "—", to: familyName },
            { label: "Adults", from: "—", to: String(adultCount) },
            { label: "Children", from: "—", to: String(childCount) },
            { label: "Amount owed", from: "—", to: auditMoney(amountOwedCents) },
          ],
        });
      }, TX);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      throw new EventInputError(STALE_FORM);
    }
  });
  if (result.error) return result;

  revalidatePath(`/portal/admin/events/${eventId}`);
  revalidatePath("/portal/admin/events/guests");
  return {};
}

/** "2 adults, 1 kid" */
function headcountText(adultCount: number, childCount: number) {
  return `${adultCount} adult${adultCount === 1 ? "" : "s"}, ${childCount} kid${childCount === 1 ? "" : "s"}`;
}

/**
 * An Admin's edit of a guest group: its name, Guest Of link, headcounts and
 * amount owed (TripAdminForm on the group's page). The form carries
 * guestGroupEditVersion of the values it was filled in with. If another
 * Admin changed any of them since, the save is refused and the page
 * refreshed, rather than putting this page's old values back over theirs —
 * a discount on the amount owed quietly undone by someone fixing the name.
 */
export async function updateGuestGroupAction(formData: FormData): Promise<EventFormResult> {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const guestGroupId = idField(formData.get("guestGroupId"));
  const eventId = idField(formData.get("eventId"));
  if (!guestGroupId) throw new Error("Missing guest group id.");

  const result = await asResult(async () => {
    const version = textField(formData.get("version"));

    await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "EventGuestGroup" WHERE id = ${guestGroupId} FOR UPDATE`;
      if (locked.length === 0) throw new EventInputError(GUEST_GROUP_GONE);
      const existing = await tx.eventGuestGroup.findUniqueOrThrow({
        where: { id: guestGroupId },
        select: {
          familyName: true,
          adultCount: true,
          childCount: true,
          amountOwedCents: true,
          guestOfScoutId: true,
          guestOfUserId: true,
          eventId: true,
        },
      });
      // Before the fields are read: a page that's out of date says so, rather
      // than that what was typed doesn't fit.
      if (guestGroupEditVersion(existing) !== version) {
        throw new EventInputError(
          `Someone changed this guest group after this page loaded (it's now ${existing.familyName}: ${headcountText(
            existing.adultCount,
            existing.childCount,
          )}, ${auditMoney(existing.amountOwedCents)} owed). Nothing was saved — the page now shows the current ` +
            "details; make your change again.",
          { stale: true },
        );
      }
      // Checked against the group as it's saved now, under the lock, so a
      // name, size or amount saved before the limits can stay as it is (see
      // "Reading form fields" above). A refusal here writes nothing.
      const familyName = readGroupName(formData, existing.familyName);
      const guestOf = readGuestOf(formData.get("guestOf"));
      const { adultCount, childCount } = readEditedHeadcounts(formData, existing);
      const amountOwedCents = readAmountOwed(formData, existing.amountOwedCents);
      await assertGuestOfExists(tx, guestOf);

      await tx.eventGuestGroup.update({
        where: { id: guestGroupId },
        data: { familyName, adultCount, childCount, amountOwedCents, ...guestOf },
      });

      await recordAuditInTransaction(tx, session, {
        action: "guestGroup.update",
        summary: `Edited the guest group “${familyName}” on “${await eventTitle(existing.eventId, tx)}”`,
        entityType: "EventGuestGroup",
        entityId: guestGroupId,
        details: changedFields({
          "Guest group": [existing.familyName, familyName],
          Adults: [existing.adultCount, adultCount],
          Children: [existing.childCount, childCount],
          "Amount owed": [auditMoney(existing.amountOwedCents), auditMoney(amountOwedCents)],
        }),
      });
    }, TX);
  });
  // A refusal about what was typed, or about a row deleted meanwhile (see
  // EVENT_GONE), leaves the page as it loaded, so the Admin's entries go back
  // over it; a stale one refreshes it.
  if (result.error && !result.stale) return result;

  revalidatePath(`/portal/admin/events/${eventId}/guests/${guestGroupId}`);
  revalidatePath(`/portal/admin/events/${eventId}`);
  revalidatePath("/portal/admin/events");
  revalidatePath("/portal/admin/events/guests");
  return result;
}

export async function removeGuestGroupAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const guestGroupId = idField(formData.get("guestGroupId"));
  const eventId = idField(formData.get("eventId"));
  if (!guestGroupId) throw new Error("Missing guest group id.");

  await prisma.$transaction(async (tx) => {
    // The same row lock addGuestGroupPaymentAction takes: a payment recorded
    // while this runs either lands first (and is kept below) or waits and
    // then finds the group gone.
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "EventGuestGroup" WHERE id = ${guestGroupId} FOR UPDATE`;
    if (locked.length === 0) return; // Already gone (a second click, or another Admin).
    const group = await tx.eventGuestGroup.findUniqueOrThrow({
      where: { id: guestGroupId },
      select: { familyName: true, amountOwedCents: true, event: { select: { title: true } } },
    });

    // The cascade takes the group's payments with it; Payment Records keeps them.
    const kept = await keepPaymentRecords(
      tx,
      { eventGuestGroupId: guestGroupId },
      { session, reason: `Guest group "${group.familyName}" removed from "${group.event.title}"` },
    );

    await tx.eventGuestGroup.delete({ where: { id: guestGroupId } });

    await recordAuditInTransaction(tx, session, {
      action: "guestGroup.delete",
      summary: `Removed the guest group “${group.familyName}” from “${group.event.title}”${keptPaymentsText(kept)}`,
      entityType: "EventGuestGroup",
      entityId: guestGroupId,
      details: [
        { label: "Guest group", from: group.familyName, to: "—" },
        { label: "Amount owed", from: auditMoney(group.amountOwedCents), to: "—" },
        { label: "Payments removed", from: String(kept.count), to: "—" },
        ...(kept.count > 0
          ? [{ label: "Payments kept in Payment Records", from: "—", to: `${kept.count} (${auditMoney(kept.totalCents)})` }]
          : []),
      ],
    });
  }, TX);

  revalidatePath("/portal/admin/payment-records");
  revalidatePath(`/portal/admin/events/${eventId}`);
  revalidatePath("/portal/admin/events");
}

export async function addGuestGroupPaymentAction(formData: FormData): Promise<EventFormResult> {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const guestGroupId = idField(formData.get("guestGroupId"));
  const eventId = idField(formData.get("eventId"));
  if (!guestGroupId) throw new Error("Missing guest group id.");

  const result = await asResult(async () => {
    const { amountCents, paidOn, note } = readPayment(formData);

    await prisma.$transaction(async (tx) => {
      // The same row lock removeMyGuestGroupAction takes: a payment and a
      // family withdrawing the group can't interleave. If the withdrawal won,
      // the group is gone by the time this lock is granted.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "EventGuestGroup" WHERE id = ${guestGroupId} FOR UPDATE`;
      if (locked.length === 0) throw new EventInputError("This guest group no longer exists.");
      const group = await tx.eventGuestGroup.findUniqueOrThrow({
        where: { id: guestGroupId },
        select: { familyName: true, event: { select: { title: true } } },
      });

      const payment = await tx.eventGuestGroupPayment.create({
        data: { eventGuestGroupId: guestGroupId, amountCents, paidOn, note, recordedByUserId: session.userId },
      });

      await recordAuditInTransaction(tx, session, {
        action: "guestGroupPayment.add",
        summary: `Recorded a ${auditMoney(amountCents)} payment from the guest group “${group.familyName}” on “${
          group.event.title
        }”`,
        entityType: "EventGuestGroupPayment",
        entityId: payment.id,
        details: [
          { label: "Amount", from: "—", to: auditMoney(amountCents) },
          { label: "Paid on", from: "—", to: auditDate(paidOn) },
          ...(note ? [{ label: "Note", from: "—", to: note }] : []),
        ],
      });
    }, TX);
  });
  if (result.error) return result;

  revalidatePath(`/portal/admin/events/${eventId}/guests/${guestGroupId}`);
  revalidatePath(`/portal/admin/events/${eventId}`);
  revalidatePath("/portal/admin/events");
  return {};
}

export async function deleteGuestGroupPaymentAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");

  const paymentId = String(formData.get("paymentId") || "");
  const guestGroupId = String(formData.get("guestGroupId") || "");
  const eventId = String(formData.get("eventId") || "");
  if (!paymentId) throw new Error("Missing payment id.");

  // Look up ownership from the payment's own guest group — never trust a
  // client-submitted guestGroupId for this check, since it travels in the
  // same form as (and independently of) paymentId.
  const payment = await prisma.eventGuestGroupPayment.findUnique({
    where: { id: paymentId },
    select: { eventGuestGroupId: true, eventGuestGroup: { select: { addedByUserId: true } } },
  });
  if (!payment || payment.eventGuestGroupId !== guestGroupId) throw new Error("Payment not found.");
  assertAdmin(session);

  await prisma.$transaction(async (tx) => {
    // Locked first, then read, in the same transaction as the delete and the
    // copy to Payment Records, so a second click waits and finds nothing to do.
    if (!(await lockPaymentRowForDelete(tx, "EventGuestGroupPayment", paymentId))) return;
    const deleted = await tx.eventGuestGroupPayment.findUnique({
      where: { id: paymentId },
      select: { amountCents: true, paidOn: true, note: true, eventGuestGroup: { select: { familyName: true } } },
    });
    if (!deleted) return; // Already gone.

    const kept = await keepPaymentRecords(
      tx,
      { guestGroupPaymentId: paymentId },
      { session, reason: "Payment deleted" },
    );

    await tx.eventGuestGroupPayment.delete({ where: { id: paymentId } });

    await recordAuditInTransaction(tx, session, {
      action: "guestGroupPayment.delete",
      summary: `Deleted a ${auditMoney(deleted.amountCents)} payment from the guest group “${
        deleted.eventGuestGroup.familyName
      }”${kept.count > 0 ? " — kept in Payment Records" : ""}`,
      entityType: "EventGuestGroupPayment",
      entityId: paymentId,
      details: [
        { label: "Amount", from: auditMoney(deleted.amountCents), to: "—" },
        { label: "Paid on", from: auditDate(deleted.paidOn), to: "—" },
        ...(deleted.note ? [{ label: "Note", from: deleted.note, to: "—" }] : []),
      ],
    });
  }, TX);

  revalidatePath("/portal/admin/payment-records");
  revalidatePath(`/portal/admin/events/${eventId}/guests/${guestGroupId}`);
  revalidatePath(`/portal/admin/events/${eventId}`);
  revalidatePath("/portal/admin/events");
}
