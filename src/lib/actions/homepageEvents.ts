"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertHomepageEventsAccess } from "@/lib/authorize";

const HOMEPAGE_EVENTS_ADMIN_PATH = "/portal/admin/homepage-events";
const HOME_PATH = "/";

export async function createHomepageEventAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertHomepageEventsAccess(session);

  const dateLabel = String(formData.get("dateLabel") || "").trim();
  const title = String(formData.get("title") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const sortDateRaw = String(formData.get("sortDate") || "").trim();
  if (!dateLabel || !title || !sortDateRaw) {
    throw new Error("Date label, title, and sort date are required.");
  }

  const sortDate = new Date(`${sortDateRaw}T00:00:00Z`);
  if (Number.isNaN(sortDate.getTime())) throw new Error("Invalid sort date.");

  await prisma.homepageEvent.create({
    data: { dateLabel, title, description: description || null, sortDate },
  });

  revalidatePath(HOMEPAGE_EVENTS_ADMIN_PATH);
  revalidatePath(HOME_PATH);
}

export async function updateHomepageEventAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertHomepageEventsAccess(session);

  const id = String(formData.get("id") || "");
  const dateLabel = String(formData.get("dateLabel") || "").trim();
  const title = String(formData.get("title") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const sortDateRaw = String(formData.get("sortDate") || "").trim();
  if (!id || !dateLabel || !title || !sortDateRaw) {
    throw new Error("Date label, title, and sort date are required.");
  }

  const sortDate = new Date(`${sortDateRaw}T00:00:00Z`);
  if (Number.isNaN(sortDate.getTime())) throw new Error("Invalid sort date.");

  await prisma.homepageEvent.update({
    where: { id },
    data: { dateLabel, title, description: description || null, sortDate },
  });

  revalidatePath(HOMEPAGE_EVENTS_ADMIN_PATH);
  revalidatePath(HOME_PATH);
}

export async function deleteHomepageEventAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertHomepageEventsAccess(session);

  const id = String(formData.get("id") || "");
  if (!id) throw new Error("Missing event id.");

  await prisma.homepageEvent.delete({ where: { id } });

  revalidatePath(HOMEPAGE_EVENTS_ADMIN_PATH);
  revalidatePath(HOME_PATH);
}
