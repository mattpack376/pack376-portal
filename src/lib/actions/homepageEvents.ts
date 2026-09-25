"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertAdmin } from "@/lib/authorize";
import { recordAudit, changedFields } from "@/lib/audit";

const HOMEPAGE_EVENTS_ADMIN_PATH = "/portal/admin/homepage-events";
const HOME_PATH = "/";

export async function createHomepageEventAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const dateLabel = String(formData.get("dateLabel") || "").trim();
  const title = String(formData.get("title") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const sortDateRaw = String(formData.get("sortDate") || "").trim();
  if (!dateLabel || !title || !sortDateRaw) {
    throw new Error("Date label, title, and sort date are required.");
  }

  const sortDate = new Date(`${sortDateRaw}T00:00:00Z`);
  if (Number.isNaN(sortDate.getTime())) throw new Error("Invalid sort date.");

  const event = await prisma.homepageEvent.create({
    data: { dateLabel, title, description: description || null, sortDate },
  });

  await recordAudit(session, {
    action: "homepageEvent.create",
    summary: `Added the homepage event “${title}” (${dateLabel})`,
    entityType: "HomepageEvent",
    entityId: event.id,
    details: [
      { label: "Title", from: "—", to: title },
      { label: "Date label", from: "—", to: dateLabel },
      ...(description ? [{ label: "Description", from: "—", to: description }] : []),
    ],
  });

  revalidatePath(HOMEPAGE_EVENTS_ADMIN_PATH);
  revalidatePath(HOME_PATH);
}

export async function updateHomepageEventAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

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

  const before = await prisma.homepageEvent.findUnique({
    where: { id },
    select: { dateLabel: true, title: true, description: true, sortDate: true },
  });

  await prisma.homepageEvent.update({
    where: { id },
    data: { dateLabel, title, description: description || null, sortDate },
  });

  await recordAudit(session, {
    action: "homepageEvent.update",
    summary: `Edited the homepage event “${title}”`,
    entityType: "HomepageEvent",
    entityId: id,
    details: changedFields({
      Title: [before?.title, title],
      "Date label": [before?.dateLabel, dateLabel],
      Description: [before?.description, description || null],
      "Sort date": [before?.sortDate, sortDate],
    }),
  });

  revalidatePath(HOMEPAGE_EVENTS_ADMIN_PATH);
  revalidatePath(HOME_PATH);
}

export async function toggleHomepageEventVisibilityAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const id = String(formData.get("id") || "");
  const visible = String(formData.get("visible") || "") === "true";
  if (!id) throw new Error("Missing event id.");

  const event = await prisma.homepageEvent.update({ where: { id }, data: { visible: !visible } });

  await recordAudit(session, {
    action: "homepageEvent.toggle",
    summary: `${event.visible ? "Showed" : "Hid"} the homepage event “${event.title}”`,
    entityType: "HomepageEvent",
    entityId: id,
    details: [{ label: "Visible", from: visible ? "Yes" : "No", to: event.visible ? "Yes" : "No" }],
  });

  revalidatePath(HOMEPAGE_EVENTS_ADMIN_PATH);
  revalidatePath(HOME_PATH);
}

export async function deleteHomepageEventAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const id = String(formData.get("id") || "");
  if (!id) throw new Error("Missing event id.");

  const event = await prisma.homepageEvent.delete({ where: { id } });

  await recordAudit(session, {
    action: "homepageEvent.delete",
    summary: `Deleted the homepage event “${event.title}” (${event.dateLabel})`,
    entityType: "HomepageEvent",
    entityId: id,
    details: [{ label: "Title", from: event.title, to: "—" }],
  });

  revalidatePath(HOMEPAGE_EVENTS_ADMIN_PATH);
  revalidatePath(HOME_PATH);
}
