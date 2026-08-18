"use server";

import { revalidatePath } from "next/cache";
import { put } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertTripPageAccess } from "@/lib/authorize";
import type { TripDay } from "@/generated/prisma/enums";

const ADMIN_PATH = "/portal/admin/camp-conron";
const PUBLIC_PATH = "/camp-conron";

function revalidateTrip() {
  revalidatePath(ADMIN_PATH);
  revalidatePath(PUBLIC_PATH);
}

function dollarsToCents(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

const MAX_FLYER_BYTES = 8 * 1024 * 1024;
const ALLOWED_FLYER_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
};

async function uploadFlyer(file: File): Promise<string> {
  const extension = ALLOWED_FLYER_TYPES[file.type];
  if (!extension) throw new Error("Flyer must be a JPEG, PNG, WEBP, GIF, or PDF.");
  if (file.size > MAX_FLYER_BYTES) throw new Error("Flyer must be 8MB or smaller.");

  const blob = await put(`trip-flyers/${crypto.randomUUID()}.${extension}`, file, {
    access: "public",
    contentType: file.type,
  });
  return blob.url;
}

export async function updateTripDetailsAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertTripPageAccess(session);

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
    flyerUrl = await uploadFlyer(flyer);
  } else if (String(formData.get("removeFlyer") || "") === "true") {
    flyerUrl = null;
  }

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

  revalidateTrip();
}

export async function toggleTripPublishedAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertTripPageAccess(session);

  const id = String(formData.get("id") || "");
  const published = String(formData.get("published") || "") === "true";
  if (!id) throw new Error("Missing trip page id.");

  await prisma.tripPage.update({ where: { id }, data: { published: !published } });

  revalidateTrip();
}

export async function updateTripPricingAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertTripPageAccess(session);

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

  await prisma.tripPage.update({
    where: { id },
    data: { regularPriceCents, earlyBirdPriceCents, earlyBirdDeadline, rsvpDeadline, freeAgeAndUnder },
  });

  revalidateTrip();
}

export async function updateTripPaymentInstructionsAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertTripPageAccess(session);

  const id = String(formData.get("id") || "");
  const packPaymentInstructions = String(formData.get("packPaymentInstructions") || "").trim();
  const troopPaymentInstructions = String(formData.get("troopPaymentInstructions") || "").trim();
  if (!id) throw new Error("Missing trip page id.");

  await prisma.tripPage.update({
    where: { id },
    data: {
      packPaymentInstructions: packPaymentInstructions || null,
      troopPaymentInstructions: troopPaymentInstructions || null,
    },
  });

  revalidateTrip();
}

export async function updateTripMealsAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertTripPageAccess(session);

  const mealIds = formData.getAll("mealId").map(String);
  if (mealIds.length === 0) throw new Error("No meals to update.");

  await Promise.all(
    mealIds.map((mealId) => {
      const menuText = String(formData.get(`menuText-${mealId}`) || "").trim();
      return prisma.tripMeal.update({ where: { id: mealId }, data: { menuText: menuText || null } });
    }),
  );

  revalidateTrip();
}

export async function createDutySlotAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertTripPageAccess(session);

  const tripPageId = String(formData.get("tripPageId") || "");
  const label = String(formData.get("label") || "").trim();
  const tripMealId = String(formData.get("tripMealId") || "").trim() || null;
  const assignedName = String(formData.get("assignedName") || "").trim();
  const arriveTime = String(formData.get("arriveTime") || "").trim();
  const notes = String(formData.get("notes") || "").trim();
  if (!tripPageId || !label) throw new Error("A label is required.");

  await prisma.tripDutySlot.create({
    data: {
      tripPageId,
      tripMealId,
      label,
      assignedName: assignedName || null,
      arriveTime: arriveTime || null,
      notes: notes || null,
    },
  });

  revalidateTrip();
}

export async function updateDutySlotAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertTripPageAccess(session);

  const id = String(formData.get("id") || "");
  const label = String(formData.get("label") || "").trim();
  const tripMealId = String(formData.get("tripMealId") || "").trim() || null;
  const assignedName = String(formData.get("assignedName") || "").trim();
  const arriveTime = String(formData.get("arriveTime") || "").trim();
  const notes = String(formData.get("notes") || "").trim();
  if (!id || !label) throw new Error("A label is required.");

  await prisma.tripDutySlot.update({
    where: { id },
    data: { tripMealId, label, assignedName: assignedName || null, arriveTime: arriveTime || null, notes: notes || null },
  });

  revalidateTrip();
}

export async function deleteDutySlotAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertTripPageAccess(session);

  const id = String(formData.get("id") || "");
  if (!id) throw new Error("Missing duty slot id.");

  await prisma.tripDutySlot.delete({ where: { id } });

  revalidateTrip();
}

export async function createActivityAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertTripPageAccess(session);

  const tripPageId = String(formData.get("tripPageId") || "");
  const day = String(formData.get("day") || "");
  const time = String(formData.get("time") || "").trim();
  const title = String(formData.get("title") || "").trim();
  const description = String(formData.get("description") || "").trim();
  if (!tripPageId || !title) throw new Error("A title is required.");
  if (day !== "FRIDAY" && day !== "SATURDAY" && day !== "SUNDAY" && day !== "MONDAY") {
    throw new Error("Choose a valid day.");
  }

  await prisma.tripActivity.create({
    data: { tripPageId, day: day as TripDay, time: time || null, title, description: description || null },
  });

  revalidateTrip();
}

export async function updateActivityAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertTripPageAccess(session);

  const id = String(formData.get("id") || "");
  const day = String(formData.get("day") || "");
  const time = String(formData.get("time") || "").trim();
  const title = String(formData.get("title") || "").trim();
  const description = String(formData.get("description") || "").trim();
  if (!id || !title) throw new Error("A title is required.");
  if (day !== "FRIDAY" && day !== "SATURDAY" && day !== "SUNDAY" && day !== "MONDAY") {
    throw new Error("Choose a valid day.");
  }

  await prisma.tripActivity.update({
    where: { id },
    data: { day: day as TripDay, time: time || null, title, description: description || null },
  });

  revalidateTrip();
}

export async function deleteActivityAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertTripPageAccess(session);

  const id = String(formData.get("id") || "");
  if (!id) throw new Error("Missing activity id.");

  await prisma.tripActivity.delete({ where: { id } });

  revalidateTrip();
}
