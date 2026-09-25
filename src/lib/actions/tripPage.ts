"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertAdmin } from "@/lib/authorize";
import { recordAudit, changedFields, auditMoney } from "@/lib/audit";
import { deleteUploadedBlob } from "@/lib/blobCleanup";
import { uploadFlyer } from "@/lib/flyerUpload";
import { dollarsToCents } from "@/lib/formValues";
import type { TripDay, TripMealType } from "@/generated/prisma/enums";

const ADMIN_PATH = "/portal/admin/camp-conron";
const PUBLIC_PATH = "/camp-conron";

function revalidateTrip() {
  revalidatePath(ADMIN_PATH);
  revalidatePath(PUBLIC_PATH);
}

/** "SATURDAY" -> "Saturday", "HOT_BREAKFAST" -> "Hot breakfast" — enums in audit text. */
function titleCase(value: string): string {
  const words = value.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export async function updateTripDetailsAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const id = String(formData.get("id") || "");
  const title = String(formData.get("title") || "").trim();
  const location = String(formData.get("location") || "").trim();
  const startDateRaw = String(formData.get("startDate") || "").trim();
  const endDateRaw = String(formData.get("endDate") || "").trim();
  const detailsHtml = String(formData.get("detailsHtml") || "").trim();
  if (!id || !title) throw new Error("Title is required.");

  const startDate = startDateRaw ? new Date(`${startDateRaw}T00:00:00Z`) : null;
  const endDate = endDateRaw ? new Date(`${endDateRaw}T00:00:00Z`) : null;
  if (startDate && Number.isNaN(startDate.getTime())) throw new Error("Invalid start date.");
  if (endDate && Number.isNaN(endDate.getTime())) throw new Error("Invalid end date.");

  let flyerUrl: string | null | undefined;
  const flyer = formData.get("flyer");
  if (flyer instanceof File && flyer.size > 0) {
    flyerUrl = await uploadFlyer(flyer, "trip-flyers");
  } else if (String(formData.get("removeFlyer") || "") === "true") {
    flyerUrl = null;
  }

  const before = await prisma.tripPage.findUnique({
    where: { id },
    // flyerUrl so a flyer that's been replaced or removed can be deleted from
    // Blob storage below rather than left public at its original URL.
    select: { title: true, location: true, startDate: true, endDate: true, detailsHtml: true, flyerUrl: true },
  });

  await prisma.tripPage.update({
    where: { id },
    data: {
      title,
      location: location || null,
      startDate,
      endDate,
      detailsHtml: detailsHtml || null,
      ...(flyerUrl !== undefined ? { flyerUrl } : {}),
    },
  });

  // After the row is updated, same as albums.ts and events.ts.
  if (flyerUrl !== undefined && before?.flyerUrl && before.flyerUrl !== flyerUrl) {
    await deleteUploadedBlob(before.flyerUrl);
  }

  await recordAudit(session, {
    action: "trip.updateDetails",
    summary: `Edited the trip details for “${title}”`,
    entityType: "TripPage",
    entityId: id,
    details: [
      ...changedFields({
        Title: [before?.title, title],
        Location: [before?.location, location || null],
        "Start date": [before?.startDate, startDate],
        "End date": [before?.endDate, endDate],
        Details: [before?.detailsHtml, detailsHtml || null],
      }),
      ...(flyerUrl === undefined
        ? []
        : [{ label: "Flyer", from: "Previous", to: flyerUrl === null ? "—" : "Replaced" }]),
    ],
  });

  revalidateTrip();
}

export async function toggleTripPublishedAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const id = String(formData.get("id") || "");
  const published = String(formData.get("published") || "") === "true";
  if (!id) throw new Error("Missing trip page id.");

  const trip = await prisma.tripPage.update({ where: { id }, data: { published: !published } });

  await recordAudit(session, {
    action: "trip.togglePublished",
    summary: `${trip.published ? "Published" : "Unpublished"} the public trip page for “${trip.title}”`,
    entityType: "TripPage",
    entityId: id,
    details: [{ label: "Published", from: published ? "Yes" : "No", to: trip.published ? "Yes" : "No" }],
  });

  revalidateTrip();
}

export async function updateTripPricingAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const id = String(formData.get("id") || "");
  const regularPriceRaw = String(formData.get("regularPrice") || "");
  const earlyBirdPriceRaw = String(formData.get("earlyBirdPrice") || "");
  const earlyBirdDeadlineRaw = String(formData.get("earlyBirdDeadline") || "").trim();
  const rsvpDeadlineRaw = String(formData.get("rsvpDeadline") || "").trim();
  const freeAgeRaw = String(formData.get("freeAgeAndUnder") || "").trim();
  if (!id) throw new Error("Missing trip page id.");

  const regularPriceCents = dollarsToCents(regularPriceRaw);
  if (regularPriceCents === null) throw new Error("A valid regular price is required.");

  const earlyBirdPriceCents = earlyBirdPriceRaw.trim() ? dollarsToCents(earlyBirdPriceRaw) : null;
  if (earlyBirdPriceRaw.trim() && earlyBirdPriceCents === null) throw new Error("Invalid early-bird price.");

  const earlyBirdDeadline = earlyBirdDeadlineRaw ? new Date(`${earlyBirdDeadlineRaw}T00:00:00Z`) : null;
  const rsvpDeadline = rsvpDeadlineRaw ? new Date(`${rsvpDeadlineRaw}T00:00:00Z`) : null;

  let freeAgeAndUnder: number | null = null;
  if (freeAgeRaw) {
    const parsed = Number(freeAgeRaw);
    if (!Number.isInteger(parsed) || parsed < 0) throw new Error("Invalid free-age-and-under value.");
    freeAgeAndUnder = parsed;
  }

  const before = await prisma.tripPage.findUnique({
    where: { id },
    select: {
      title: true,
      regularPriceCents: true,
      earlyBirdPriceCents: true,
      earlyBirdDeadline: true,
      rsvpDeadline: true,
      freeAgeAndUnder: true,
    },
  });

  await prisma.tripPage.update({
    where: { id },
    data: { regularPriceCents, earlyBirdPriceCents, earlyBirdDeadline, rsvpDeadline, freeAgeAndUnder },
  });

  await recordAudit(session, {
    action: "trip.updatePricing",
    summary: `Changed the pricing for “${before?.title ?? "the trip"}” — regular ${auditMoney(regularPriceCents)}`,
    entityType: "TripPage",
    entityId: id,
    details: changedFields({
      "Regular price": [
        before ? auditMoney(before.regularPriceCents) : null,
        auditMoney(regularPriceCents),
      ],
      "Early-bird price": [
        before?.earlyBirdPriceCents === null || before?.earlyBirdPriceCents === undefined
          ? null
          : auditMoney(before.earlyBirdPriceCents),
        earlyBirdPriceCents === null ? null : auditMoney(earlyBirdPriceCents),
      ],
      "Early-bird deadline": [before?.earlyBirdDeadline, earlyBirdDeadline],
      "RSVP deadline": [before?.rsvpDeadline, rsvpDeadline],
      "Free age and under": [before?.freeAgeAndUnder, freeAgeAndUnder],
    }),
  });

  revalidateTrip();
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

  revalidateTrip();
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

  revalidateTrip();
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

  revalidateTrip();
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

  revalidateTrip();
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

  revalidateTrip();
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

  revalidateTrip();
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

  revalidateTrip();
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

  revalidateTrip();
}
