"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertAdmin, assertSiteBannerAccess } from "@/lib/authorize";
import { parsePackDateTimeLocal, formatPackDateTime } from "@/lib/bannerSchedule";
import { recordAudit, changedFields } from "@/lib/audit";

const HOMEPAGE_EVENTS_ADMIN_PATH = "/portal/admin/homepage-events";
const HOME_PATH = "/";

function parseSchedule(formData: FormData) {
  const startAtStr = String(formData.get("startAt") || "").trim();
  const endAtStr = String(formData.get("endAt") || "").trim();
  const startAt = startAtStr ? parsePackDateTimeLocal(startAtStr) : null;
  const endAt = endAtStr ? parsePackDateTimeLocal(endAtStr) : null;
  if (startAt && endAt && startAt > endAt) throw new Error("Start time must be before end time.");
  return { startAt, endAt };
}

export async function createSiteBannerAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertSiteBannerAccess(session);

  const message = String(formData.get("message") || "").trim();
  if (!message) throw new Error("Message is required.");
  const { startAt, endAt } = parseSchedule(formData);

  const banner = await prisma.siteBanner.create({ data: { message, startAt, endAt } });

  await recordAudit(session, {
    action: "banner.create",
    summary: `Added the homepage banner “${message}”`,
    entityType: "SiteBanner",
    entityId: banner.id,
    details: [
      { label: "Message", from: "—", to: message },
      ...(startAt ? [{ label: "Starts", from: "—", to: formatPackDateTime(startAt) }] : []),
      ...(endAt ? [{ label: "Ends", from: "—", to: formatPackDateTime(endAt) }] : []),
    ],
  });

  revalidatePath(HOMEPAGE_EVENTS_ADMIN_PATH);
  revalidatePath(HOME_PATH);
}

export async function updateSiteBannerAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertSiteBannerAccess(session);

  const id = String(formData.get("id") || "");
  const message = String(formData.get("message") || "").trim();
  if (!id) throw new Error("Missing banner id.");
  if (!message) throw new Error("Message is required.");
  const { startAt, endAt } = parseSchedule(formData);

  const before = await prisma.siteBanner.findUnique({
    where: { id },
    select: { message: true, startAt: true, endAt: true },
  });

  await prisma.siteBanner.update({ where: { id }, data: { message, startAt, endAt } });

  await recordAudit(session, {
    action: "banner.update",
    summary: `Edited the homepage banner “${message}”`,
    entityType: "SiteBanner",
    entityId: id,
    details: changedFields({
      Message: [before?.message, message],
      Starts: [
        before?.startAt ? formatPackDateTime(before.startAt) : null,
        startAt ? formatPackDateTime(startAt) : null,
      ],
      Ends: [before?.endAt ? formatPackDateTime(before.endAt) : null, endAt ? formatPackDateTime(endAt) : null],
    }),
  });

  revalidatePath(HOMEPAGE_EVENTS_ADMIN_PATH);
  revalidatePath(HOME_PATH);
}

export async function toggleSiteBannerAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertSiteBannerAccess(session);

  const id = String(formData.get("id") || "");
  const active = String(formData.get("active") || "") === "true";
  if (!id) throw new Error("Missing banner id.");

  const banner = await prisma.siteBanner.update({ where: { id }, data: { active: !active } });

  await recordAudit(session, {
    action: "banner.toggle",
    summary: `${banner.active ? "Showed" : "Hid"} the homepage banner “${banner.message}”`,
    entityType: "SiteBanner",
    entityId: id,
    details: [{ label: "Active", from: active ? "Yes" : "No", to: banner.active ? "Yes" : "No" }],
  });

  revalidatePath(HOMEPAGE_EVENTS_ADMIN_PATH);
  revalidatePath(HOME_PATH);
}

export async function deleteSiteBannerAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const id = String(formData.get("id") || "");
  if (!id) throw new Error("Missing banner id.");

  const banner = await prisma.siteBanner.delete({ where: { id } });

  await recordAudit(session, {
    action: "banner.delete",
    summary: `Deleted the homepage banner “${banner.message}”`,
    entityType: "SiteBanner",
    entityId: id,
    details: [{ label: "Message", from: banner.message, to: "—" }],
  });

  revalidatePath(HOMEPAGE_EVENTS_ADMIN_PATH);
  revalidatePath(HOME_PATH);
}
