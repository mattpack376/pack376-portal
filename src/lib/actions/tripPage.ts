"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertAdmin } from "@/lib/authorize";
import { recordAudit, recordAuditInTransaction, changedFields, auditMoney, auditDate } from "@/lib/audit";
import { deleteUploadedBlob } from "@/lib/blobCleanup";
import { uploadFlyer } from "@/lib/flyerUpload";
import { dollarsToCents, multiplyCents, parseCount, textField } from "@/lib/formValues";
import { parseDateOnlyString, readDateOnlyField, todayDateOnly } from "@/lib/dateOnly";
import { revalidateTripAdminPages, revalidateTripPages } from "@/lib/tripRevalidate";
import {
  currentTripPriceCents,
  lockTripPage,
  tripFormResult,
  TripInputError,
  TRIP_PAGE_GONE,
  TRIP_TRANSACTION_OPTIONS,
  type TripFormResult,
} from "@/lib/tripPageData";
import { tripSiteBySlug } from "@/lib/tripSites";
import type { Prisma } from "@/generated/prisma/client";
import type { TripDay, TripMealType } from "@/generated/prisma/enums";

/** The oldest "free age and under" the pricing form takes — anything above is a typo, not a policy. */
const MAX_FREE_AGE = 99;

/** "SATURDAY" -> "Saturday", "HOT_BREAKFAST" -> "Hot breakfast" — enums in audit text. */
function titleCase(value: string): string {
  const words = value.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Saves the Event Details form. Returns { error } for what an admin can fix —
 * a missing title, an impossible date, a flyer of the wrong type or size.
 *
 * The flyer is uploaded before the transaction, never inside it: an upload
 * can take seconds, and the trip's lock must not be held across it. If the
 * save then fails, the just-uploaded file is deleted again rather than left
 * public at a URL nothing points to. The row is locked while the old flyer's
 * URL is read and replaced, so two replacements at once each delete the
 * flyer they actually replaced.
 */
export async function updateTripDetailsAction(formData: FormData): Promise<TripFormResult> {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  return tripFormResult(async () => {
    const id = textField(formData.get("id"));
    const title = textField(formData.get("title"));
    const location = textField(formData.get("location"));
    const timeLabel = textField(formData.get("timeLabel"));
    const detailsHtml = textField(formData.get("detailsHtml"));
    if (!id || !title) throw new TripInputError("Title is required.");

    const startDate = dateField(formData.get("startDate"), "The start date");
    const endDate = dateField(formData.get("endDate"), "The end date");
    if (startDate && endDate && endDate < startDate) throw new TripInputError("The end date can't be before the start date.");

    let flyerUrl: string | null | undefined;
    let uploadedUrl: string | null = null;
    const flyer = formData.get("flyer");
    if (flyer instanceof File && flyer.size > 0) {
      try {
        uploadedUrl = await uploadFlyer(flyer, "trip-flyers");
      } catch (error) {
        // uploadFlyer's messages (wrong type, too large) are written for the
        // admin; a storage outage's is at least something to report.
        const message = error instanceof Error ? error.message : "The flyer couldn't be uploaded. Try again.";
        console.warn(`[trip flyer] upload refused or failed: ${message}`);
        throw new TripInputError(message);
      }
      flyerUrl = uploadedUrl;
    } else if (String(formData.get("removeFlyer") || "") === "true") {
      flyerUrl = null;
    }

    let before;
    try {
      before = await prisma.$transaction(async (tx) => {
        const current = await lockTripPage(tx, id);
        if (!current) throw new TripInputError(TRIP_PAGE_GONE, { stale: true });
        await tx.tripPage.update({
          where: { id },
          data: {
            title,
            location: location || null,
            startDate,
            endDate,
            timeLabel: timeLabel || null,
            detailsHtml: detailsHtml || null,
            ...(flyerUrl !== undefined ? { flyerUrl } : {}),
          },
        });
        return current;
      }, TRIP_TRANSACTION_OPTIONS);
    } catch (error) {
      // Nothing points at the new upload if the row wasn't saved.
      if (uploadedUrl) await deleteUploadedBlob(uploadedUrl);
      throw error;
    }

    // After the row is updated, same as albums.ts and events.ts: a flyer
    // that's been replaced or removed is deleted from Blob storage rather
    // than left public at its original URL.
    if (flyerUrl !== undefined && before.flyerUrl && before.flyerUrl !== flyerUrl) {
      await deleteUploadedBlob(before.flyerUrl);
    }

    await recordAudit(session, {
      action: "trip.updateDetails",
      summary: `Edited the trip details for “${title}”`,
      entityType: "TripPage",
      entityId: id,
      details: [
        ...changedFields({
          Title: [before.title, title],
          Location: [before.location, location || null],
          "Start date": [before.startDate, startDate],
          "End date": [before.endDate, endDate],
          Time: [before.timeLabel, timeLabel || null],
          Details: [before.detailsHtml, detailsHtml || null],
        }),
        ...(flyerUrl === undefined
          ? []
          : [{ label: "Flyer", from: "Previous", to: flyerUrl === null ? "—" : "Replaced" }]),
      ],
    });

    revalidateTripPages();
  });
}

export async function toggleTripPublishedAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const id = String(formData.get("id") || "");
  const published = String(formData.get("published") || "") === "true";
  if (!id) throw new Error("Missing trip page id.");

  // Sets the opposite of what the admin's page showed, so a second click from
  // a stale page leaves it as intended rather than flipping it back. The
  // UPDATE itself takes the TripPage row lock that registration holds (see
  // lockTripPage), so a submission in progress finishes first, and one that
  // starts after this reads the new state — no explicit lock needed.
  const trip = await prisma.tripPage.update({ where: { id }, data: { published: !published } });

  await recordAudit(session, {
    action: "trip.togglePublished",
    summary: `${trip.published ? "Published" : "Unpublished"} the public trip page for “${trip.title}”`,
    entityType: "TripPage",
    entityId: id,
    details: [{ label: "Published", from: published ? "Yes" : "No", to: trip.published ? "Yes" : "No" }],
  });

  revalidateTripPages();
}

/**
 * Saves the Price Structure form. Turning "TBD" off is what posts the price,
 * and posting it charges every registration that was waiting for it —
 * attendees × the price in effect — in the same transaction, so a family is
 * never left half-updated.
 *
 * Runs under the trip's lock (lockTripPage), which every registration path
 * takes too: a registration either committed before this and is filled in
 * here, or waits and reads the posted price itself. None can save as "TBD"
 * after the price is out.
 *
 * Whenever the save leaves the trip priced, it also fills in any registration
 * still waiting — one a race left behind before this lock existed — rather
 * than needing a second save to notice it. Registrations that already have an
 * amount keep it: what a family was charged at signup is never repriced here.
 */
export async function updateTripPricingAction(formData: FormData): Promise<TripFormResult> {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  return tripFormResult(async () => {
    const id = textField(formData.get("id"));
    const regularPriceRaw = textField(formData.get("regularPrice"));
    const earlyBirdPriceRaw = textField(formData.get("earlyBirdPrice"));
    const freeAgeRaw = textField(formData.get("freeAgeAndUnder"));
    const priceTbdRequested = String(formData.get("priceTbd") || "") === "true";
    if (!id) throw new TripInputError("Missing trip page id.");

    const regularPriceCents = dollarsToCents(regularPriceRaw);
    if (regularPriceCents === null) throw new TripInputError("Enter a valid regular price (up to $1,000,000.00).");

    const earlyBirdPriceCents = earlyBirdPriceRaw ? dollarsToCents(earlyBirdPriceRaw) : null;
    if (earlyBirdPriceRaw && earlyBirdPriceCents === null) {
      throw new TripInputError("Enter a valid early-bird price (up to $1,000,000.00), or leave it blank.");
    }

    const earlyBirdDeadline = dateField(formData.get("earlyBirdDeadline"), "The early-bird deadline");
    const rsvpDeadline = dateField(formData.get("rsvpDeadline"), "The RSVP deadline");

    let freeAgeAndUnder: number | null = null;
    if (freeAgeRaw) {
      freeAgeAndUnder = parseCount(freeAgeRaw, MAX_FREE_AGE);
      if (freeAgeAndUnder === null) throw new TripInputError("Free age and under must be a whole number of years.");
    }

    await prisma.$transaction(async (tx) => {
      const before = await lockTripPage(tx, id);
      if (!before) throw new TripInputError(TRIP_PAGE_GONE, { stale: true });

      // Only an event whose site has a TBD message has the toggle on its form,
      // so for any other this is always false.
      const priceTbd = !!tripSiteBySlug(before.slug)?.priceTbdMessage && priceTbdRequested;
      // Turning TBD off is what posts the price, and a $0 one is almost
      // certainly a form saved before the price was typed in. (A free event
      // is a priced one at $0 — it just never goes through TBD.)
      const postingPrice = before.priceTbd && !priceTbd;
      if (postingPrice && regularPriceCents === 0) {
        throw new TripInputError("Enter the regular price before posting it — it is still $0.00.");
      }

      // While the price stays TBD, waiting registrations keep waiting.
      const pricePerPersonCents = currentTripPriceCents({ regularPriceCents, earlyBirdPriceCents, earlyBirdDeadline });
      const settled = priceTbd ? [] : await settleWaitingRegistrations(tx, id, pricePerPersonCents);

      await tx.tripPage.update({
        where: { id },
        data: { regularPriceCents, priceTbd, earlyBirdPriceCents, earlyBirdDeadline, rsvpDeadline, freeAgeAndUnder },
      });

      const plural = (n: number) => `${n} ${n === 1 ? "registration" : "registrations"}`;
      await recordAuditInTransaction(tx, session, {
        action: "trip.updatePricing",
        summary: postingPrice
          ? `Posted the price for “${before.title}” — regular ${auditMoney(regularPriceCents)}${
              settled.length > 0 ? `; set the amount owed on ${plural(settled.length)} waiting for it` : ""
            }`
          : `Changed the pricing for “${before.title}” — regular ${auditMoney(regularPriceCents)}${
              settled.length > 0 ? `; set the amount owed on ${plural(settled.length)} still waiting for a price` : ""
            }`,
        entityType: "TripPage",
        entityId: id,
        details: [
          ...changedFields({
            "Price TBD": [before.priceTbd, priceTbd],
            "Regular price": [auditMoney(before.regularPriceCents), auditMoney(regularPriceCents)],
            "Early-bird price": [
              before.earlyBirdPriceCents === null ? null : auditMoney(before.earlyBirdPriceCents),
              earlyBirdPriceCents === null ? null : auditMoney(earlyBirdPriceCents),
            ],
            "Early-bird deadline": [before.earlyBirdDeadline, earlyBirdDeadline],
            "RSVP deadline": [before.rsvpDeadline, rsvpDeadline],
            "Free age and under": [before.freeAgeAndUnder, freeAgeAndUnder],
          }),
          ...settled.map((reg) => ({ label: `${reg.familyName} owes`, from: "TBD", to: auditMoney(reg.amountOwedCents) })),
        ],
      });
    }, TRIP_TRANSACTION_OPTIONS);

    revalidateTripPages();
  });
}

/**
 * The reviewable way to fill in registrations still waiting for a price on a
 * trip whose price is already posted — rows a race left pending before price
 * posting and registration took the same lock. The admin page lists how many
 * there are and the per-person price they'll be charged; this charges exactly
 * that (attendees × the price), one audit entry per family, and turns the
 * click down if the price changed after the page loaded.
 */
export async function settleWaitingTripRegistrationsAction(formData: FormData): Promise<TripFormResult> {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  return tripFormResult(async () => {
    const id = textField(formData.get("id"));
    const shownPriceRaw = textField(formData.get("pricePerPersonCents"));
    if (!id || !/^\d{1,9}$/.test(shownPriceRaw)) throw new TripInputError("Missing trip page id or price. Reload the page.", { stale: true });
    const shownPriceCents = Number(shownPriceRaw);

    await prisma.$transaction(async (tx) => {
      const trip = await lockTripPage(tx, id);
      if (!trip) throw new TripInputError(TRIP_PAGE_GONE, { stale: true });
      if (trip.priceTbd) {
        throw new TripInputError(
          "The price is TBD again, so these registrations wait for it. Post the price under Price Structure and they're filled in then.",
          { stale: true },
        );
      }
      const pricePerPersonCents = currentTripPriceCents(trip);
      if (pricePerPersonCents !== shownPriceCents) {
        throw new TripInputError(
          `The price is now ${auditMoney(pricePerPersonCents)}/person, not ${auditMoney(shownPriceCents)}. Review it and try again.`,
          { stale: true },
        );
      }

      const settled = await settleWaitingRegistrations(tx, id, pricePerPersonCents);
      for (const reg of settled) {
        await recordAuditInTransaction(tx, session, {
          action: "tripRegistration.settlePrice",
          summary: `Set the amount owed for ${reg.familyName} at the posted price — ${reg.payingCount} × ${auditMoney(
            pricePerPersonCents,
          )} = ${auditMoney(reg.amountOwedCents)}`,
          entityType: "TripRegistration",
          entityId: reg.id,
          details: [{ label: "Amount owed", from: "TBD", to: auditMoney(reg.amountOwedCents) }],
        });
      }
    }, TRIP_TRANSACTION_OPTIONS);

    revalidateTripPages();
  });
}

/**
 * Charges every registration of this trip that is still waiting for a price:
 * attendees × `pricePerPersonCents`. Call it with the trip locked
 * (lockTripPage). A total too large to store throws a TripInputError before
 * any row is written, and the throw rolls back the rest of the save with it.
 *
 * Each row is written only if it is still waiting with the attendee count
 * read here. Every writer of those columns holds the same lock, so that only
 * misses a registration deleted in between, which is then simply left out.
 */
async function settleWaitingRegistrations(tx: Prisma.TransactionClient, tripPageId: string, pricePerPersonCents: number) {
  const waiting = await tx.tripRegistration.findMany({
    where: { tripPageId, owedPending: true },
    select: { id: true, familyName: true, payingCount: true },
    orderBy: { createdAt: "asc" },
  });
  const planned = waiting.map((reg) => ({ ...reg, amountOwedCents: multiplyCents(reg.payingCount, pricePerPersonCents) }));
  const tooLarge = planned.find((reg) => reg.amountOwedCents === null);
  if (tooLarge) {
    throw new TripInputError(
      `${tooLarge.familyName}'s total (${tooLarge.payingCount} × ${auditMoney(pricePerPersonCents)}) would be more than $1,000,000.00. Check the price.`,
    );
  }

  const settled: { id: string; familyName: string; payingCount: number; amountOwedCents: number }[] = [];
  for (const reg of planned) {
    const amountOwedCents = reg.amountOwedCents as number;
    const { count } = await tx.tripRegistration.updateMany({
      where: { id: reg.id, owedPending: true, payingCount: reg.payingCount },
      data: { amountOwedCents, owedPending: false },
    });
    if (count === 1) settled.push({ ...reg, amountOwedCents });
  }
  return settled;
}

/** A date field read for a form that shows its problems (see TripInputError). */
function dateField(raw: FormDataEntryValue | null, label: string): Date | null {
  const read = readDateOnlyField(raw, label);
  if (read.error !== undefined) throw new TripInputError(read.error);
  return read.date;
}

export async function updateTripPaymentInstructionsAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const id = String(formData.get("id") || "");
  const packPaymentInstructions = String(formData.get("packPaymentInstructions") || "").trim();
  const troopPaymentInstructions = String(formData.get("troopPaymentInstructions") || "").trim();
  if (!id) throw new Error("Missing trip page id.");

  const before = await prisma.tripPage.findUnique({
    where: { id },
    select: { title: true, packPaymentInstructions: true, troopPaymentInstructions: true },
  });

  await prisma.tripPage.update({
    where: { id },
    data: {
      packPaymentInstructions: packPaymentInstructions || null,
      troopPaymentInstructions: troopPaymentInstructions || null,
    },
  });

  await recordAudit(session, {
    action: "trip.updatePaymentInstructions",
    summary: `Edited the payment instructions for “${before?.title ?? "the trip"}”`,
    entityType: "TripPage",
    entityId: id,
    details: changedFields({
      "Pack instructions": [before?.packPaymentInstructions, packPaymentInstructions || null],
      "Troop instructions": [before?.troopPaymentInstructions, troopPaymentInstructions || null],
    }),
  });

  revalidateTripPages();
}

export async function updateTripMealsAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const mealIds = formData.getAll("mealId").map(String);
  if (mealIds.length === 0) throw new Error("No meals to update.");

  // Saved as one form, so read every meal's old menu up front and log the one
  // entry covering whichever of them actually changed.
  const before = await prisma.tripMeal.findMany({
    where: { id: { in: mealIds } },
    select: { id: true, day: true, mealType: true, menuText: true },
  });
  const beforeById = new Map(before.map((m) => [m.id, m]));

  await Promise.all(
    mealIds.map((mealId) => {
      const menuText = String(formData.get(`menuText-${mealId}`) || "").trim();
      return prisma.tripMeal.update({ where: { id: mealId }, data: { menuText: menuText || null } });
    }),
  );

  const details = mealIds.flatMap((mealId) => {
    const prior = beforeById.get(mealId);
    if (!prior) return [];
    const menuText = String(formData.get(`menuText-${mealId}`) || "").trim();
    return changedFields({
      [`${titleCase(prior.day)} ${titleCase(prior.mealType)}`]: [prior.menuText, menuText || null],
    });
  });

  if (details.length > 0) {
    await recordAudit(session, {
      action: "trip.updateMeals",
      summary: `Updated ${details.length} trip meal menu${details.length === 1 ? "" : "s"}`,
      entityType: "TripMeal",
      entityId: null,
      details,
    });
  }

  revalidateTripPages();
}

export async function createDutySlotAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const tripPageId = String(formData.get("tripPageId") || "");
  const label = String(formData.get("label") || "").trim();
  const tripMealId = String(formData.get("tripMealId") || "").trim() || null;
  const assignedName = String(formData.get("assignedName") || "").trim();
  const arriveTime = String(formData.get("arriveTime") || "").trim();
  const notes = String(formData.get("notes") || "").trim();
  if (!tripPageId || !label) throw new Error("A label is required.");

  const slot = await prisma.tripDutySlot.create({
    data: {
      tripPageId,
      tripMealId,
      label,
      assignedName: assignedName || null,
      arriveTime: arriveTime || null,
      notes: notes || null,
    },
  });

  await recordAudit(session, {
    action: "trip.dutySlot.create",
    summary: `Added the trip duty “${label}”${assignedName ? ` — assigned to ${assignedName}` : " (unassigned)"}`,
    entityType: "TripDutySlot",
    entityId: slot.id,
    details: [
      { label: "Duty", from: "—", to: label },
      ...(assignedName ? [{ label: "Assigned to", from: "—", to: assignedName }] : []),
      ...(arriveTime ? [{ label: "Arrive time", from: "—", to: arriveTime }] : []),
      ...(notes ? [{ label: "Notes", from: "—", to: notes }] : []),
    ],
  });

  revalidateTripPages();
}

export async function updateDutySlotAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const id = String(formData.get("id") || "");
  const label = String(formData.get("label") || "").trim();
  const tripMealId = String(formData.get("tripMealId") || "").trim() || null;
  const assignedName = String(formData.get("assignedName") || "").trim();
  const arriveTime = String(formData.get("arriveTime") || "").trim();
  const notes = String(formData.get("notes") || "").trim();
  if (!id || !label) throw new Error("A label is required.");

  // tripMeal is included because which meal a duty belongs to is the one
  // thing this form changes that wasn't audited at all — the `before` read
  // didn't even fetch it. When a duty silently moved back to its old meal
  // there was no record to check it against, which is exactly the question
  // the log exists to answer.
  const before = await prisma.tripDutySlot.findUnique({
    where: { id },
    select: { label: true, assignedName: true, arriveTime: true, notes: true, tripMealId: true, tripMeal: true },
  });
  const after =
    tripMealId && tripMealId !== before?.tripMealId
      ? await prisma.tripMeal.findUnique({ where: { id: tripMealId } })
      : before?.tripMeal ?? null;
  const mealLabel = (meal: { day: TripDay; mealType: TripMealType } | null) =>
    meal ? `${titleCase(meal.day)} ${titleCase(meal.mealType)}` : "General duty (no meal)";

  await prisma.tripDutySlot.update({
    where: { id },
    data: { tripMealId, label, assignedName: assignedName || null, arriveTime: arriveTime || null, notes: notes || null },
  });

  await recordAudit(session, {
    action: "trip.dutySlot.update",
    summary: `Edited the trip duty “${label}”`,
    entityType: "TripDutySlot",
    entityId: id,
    details: changedFields({
      Duty: [before?.label, label],
      Meal: [before ? mealLabel(before.tripMeal) : null, mealLabel(after)],
      "Assigned to": [before?.assignedName, assignedName || null],
      "Arrive time": [before?.arriveTime, arriveTime || null],
      Notes: [before?.notes, notes || null],
    }),
  });

  revalidateTripPages();
}

export async function deleteDutySlotAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const id = String(formData.get("id") || "");
  if (!id) throw new Error("Missing duty slot id.");

  const slot = await prisma.tripDutySlot.delete({ where: { id } });

  await recordAudit(session, {
    action: "trip.dutySlot.delete",
    summary: `Deleted the trip duty “${slot.label}”${slot.assignedName ? ` (was assigned to ${slot.assignedName})` : ""}`,
    entityType: "TripDutySlot",
    entityId: id,
    details: [
      { label: "Duty", from: slot.label, to: "—" },
      ...(slot.assignedName ? [{ label: "Assigned to", from: slot.assignedName, to: "—" }] : []),
    ],
  });

  revalidateTripPages();
}

export async function createActivityAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const tripPageId = String(formData.get("tripPageId") || "");
  const day = String(formData.get("day") || "");
  const time = String(formData.get("time") || "").trim();
  const title = String(formData.get("title") || "").trim();
  const description = String(formData.get("description") || "").trim();
  if (!tripPageId || !title) throw new Error("A title is required.");
  if (day !== "FRIDAY" && day !== "SATURDAY" && day !== "SUNDAY" && day !== "MONDAY") {
    throw new Error("Choose a valid day.");
  }

  const activity = await prisma.tripActivity.create({
    data: { tripPageId, day: day as TripDay, time: time || null, title, description: description || null },
  });

  await recordAudit(session, {
    action: "trip.activity.create",
    summary: `Added the trip activity “${title}” on ${titleCase(day)}${time ? ` at ${time}` : ""}`,
    entityType: "TripActivity",
    entityId: activity.id,
    details: [
      { label: "Activity", from: "—", to: title },
      { label: "Day", from: "—", to: titleCase(day) },
      ...(time ? [{ label: "Time", from: "—", to: time }] : []),
      ...(description ? [{ label: "Description", from: "—", to: description }] : []),
    ],
  });

  revalidateTripPages();
}

export async function updateActivityAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const id = String(formData.get("id") || "");
  const day = String(formData.get("day") || "");
  const time = String(formData.get("time") || "").trim();
  const title = String(formData.get("title") || "").trim();
  const description = String(formData.get("description") || "").trim();
  if (!id || !title) throw new Error("A title is required.");
  if (day !== "FRIDAY" && day !== "SATURDAY" && day !== "SUNDAY" && day !== "MONDAY") {
    throw new Error("Choose a valid day.");
  }

  const before = await prisma.tripActivity.findUnique({
    where: { id },
    select: { day: true, time: true, title: true, description: true },
  });

  await prisma.tripActivity.update({
    where: { id },
    data: { day: day as TripDay, time: time || null, title, description: description || null },
  });

  await recordAudit(session, {
    action: "trip.activity.update",
    summary: `Edited the trip activity “${title}”`,
    entityType: "TripActivity",
    entityId: id,
    details: changedFields({
      Activity: [before?.title, title],
      Day: [before ? titleCase(before.day) : null, titleCase(day)],
      Time: [before?.time, time || null],
      Description: [before?.description, description || null],
    }),
  });

  revalidateTripPages();
}

export async function deleteActivityAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const id = String(formData.get("id") || "");
  if (!id) throw new Error("Missing activity id.");

  const activity = await prisma.tripActivity.delete({ where: { id } });

  await recordAudit(session, {
    action: "trip.activity.delete",
    summary: `Deleted the trip activity “${activity.title}” on ${titleCase(activity.day)}`,
    entityType: "TripActivity",
    entityId: id,
    details: [{ label: "Activity", from: activity.title, to: "—" }],
  });

  revalidateTripPages();
}

// A vendor credit/refund is a TripExpense with isCredit set — the add form's
// "Add Credit / Refund" button and the edit popover's Type select send kind=CREDIT.
function expenseKindLabel(isCredit: boolean) {
  return isCredit ? "Credit / Refund" : "Expense";
}

// Expenses never appear on the public page, so these only revalidate the admin view.
export async function addTripExpenseAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const tripPageId = String(formData.get("tripPageId") || "");
  const description = String(formData.get("description") || "").trim();
  const amountCents = dollarsToCents(String(formData.get("amount") || ""));
  const spentOnRaw = String(formData.get("spentOn") || "").trim();
  const paidBy = String(formData.get("paidBy") || "").trim() || null;
  const isCredit = formData.get("kind") === "CREDIT";
  if (!tripPageId || !description) throw new Error("Describe what the expense was for.");
  if (amountCents === null || amountCents === 0) throw new Error("A valid expense amount is required.");

  const spentOn = parseDateOnlyString(spentOnRaw, "Invalid expense date.") ?? todayDateOnly();

  const expense = await prisma.tripExpense.create({
    data: { tripPageId, description, amountCents, isCredit, spentOn, paidBy, recordedByUserId: session.userId },
  });

  await recordAudit(session, {
    action: "trip.expense.add",
    summary: isCredit
      ? `Recorded a ${auditMoney(amountCents)} trip credit/refund for “${description}”`
      : `Recorded a ${auditMoney(amountCents)} trip expense for “${description}”`,
    entityType: "TripExpense",
    entityId: expense.id,
    details: [
      ...(isCredit ? [{ label: "Type", from: "—", to: expenseKindLabel(true) }] : []),
      { label: "Expense", from: "—", to: description },
      { label: "Amount", from: "—", to: auditMoney(amountCents) },
      { label: "Date", from: "—", to: auditDate(spentOn) },
      ...(paidBy ? [{ label: "Paid by", from: "—", to: paidBy }] : []),
    ],
  });

  revalidateTripAdminPages();
}

export async function updateTripExpenseAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const id = String(formData.get("id") || "");
  const description = String(formData.get("description") || "").trim();
  const amountCents = dollarsToCents(String(formData.get("amount") || ""));
  const spentOnRaw = String(formData.get("spentOn") || "").trim();
  const paidBy = String(formData.get("paidBy") || "").trim() || null;
  const isCredit = formData.get("kind") === "CREDIT";
  if (!id || !description) throw new Error("Describe what the expense was for.");
  if (amountCents === null || amountCents === 0) throw new Error("A valid expense amount is required.");
  if (!spentOnRaw) throw new Error("An expense date is required.");

  const spentOn = parseDateOnlyString(spentOnRaw, "Invalid expense date.") as Date;

  const before = await prisma.tripExpense.findUnique({
    where: { id },
    select: { description: true, amountCents: true, isCredit: true, spentOn: true, paidBy: true },
  });

  await prisma.tripExpense.update({ where: { id }, data: { description, amountCents, isCredit, spentOn, paidBy } });

  await recordAudit(session, {
    action: "trip.expense.update",
    summary: isCredit
      ? `Edited the trip credit/refund “${description}” — now ${auditMoney(amountCents)}`
      : `Edited the trip expense “${description}” — now ${auditMoney(amountCents)}`,
    entityType: "TripExpense",
    entityId: id,
    details: changedFields({
      Type: [before ? expenseKindLabel(before.isCredit) : null, expenseKindLabel(isCredit)],
      Expense: [before?.description, description],
      Amount: [before ? auditMoney(before.amountCents) : null, auditMoney(amountCents)],
      Date: [before?.spentOn, spentOn],
      "Paid by": [before?.paidBy, paidBy],
    }),
  });

  revalidateTripAdminPages();
}

export async function deleteTripExpenseAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const id = String(formData.get("id") || "");
  if (!id) throw new Error("Missing expense id.");

  const expense = await prisma.tripExpense.delete({ where: { id } });

  await recordAudit(session, {
    action: "trip.expense.delete",
    summary: expense.isCredit
      ? `Deleted the ${auditMoney(expense.amountCents)} trip credit/refund for “${expense.description}”`
      : `Deleted the ${auditMoney(expense.amountCents)} trip expense for “${expense.description}”`,
    entityType: "TripExpense",
    entityId: id,
    details: [
      ...(expense.isCredit ? [{ label: "Type", from: expenseKindLabel(true), to: "—" }] : []),
      { label: "Expense", from: expense.description, to: "—" },
      { label: "Amount", from: auditMoney(expense.amountCents), to: "—" },
      { label: "Date", from: auditDate(expense.spentOn), to: "—" },
      ...(expense.paidBy ? [{ label: "Paid by", from: expense.paidBy, to: "—" }] : []),
    ],
  });

  revalidateTripAdminPages();
}
