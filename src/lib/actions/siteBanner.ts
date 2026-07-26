"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertHomepageContentAccess, assertHomepageContentDeleteAccess } from "@/lib/authorize";

const HOMEPAGE_EVENTS_ADMIN_PATH = "/portal/admin/homepage-events";
const HOME_PATH = "/";

export async function createSiteBannerAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertHomepageContentAccess(session);

  const message = String(formData.get("message") || "").trim();
  if (!message) throw new Error("Message is required.");

  await prisma.siteBanner.create({ data: { message } });

  revalidatePath(HOMEPAGE_EVENTS_ADMIN_PATH);
  revalidatePath(HOME_PATH);
}

export async function toggleSiteBannerAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertHomepageContentAccess(session);

  const id = String(formData.get("id") || "");
  const active = String(formData.get("active") || "") === "true";
  if (!id) throw new Error("Missing banner id.");

  await prisma.siteBanner.update({ where: { id }, data: { active: !active } });

  revalidatePath(HOMEPAGE_EVENTS_ADMIN_PATH);
  revalidatePath(HOME_PATH);
}

export async function deleteSiteBannerAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertHomepageContentDeleteAccess(session);

  const id = String(formData.get("id") || "");
  if (!id) throw new Error("Missing banner id.");

  await prisma.siteBanner.delete({ where: { id } });

  revalidatePath(HOMEPAGE_EVENTS_ADMIN_PATH);
  revalidatePath(HOME_PATH);
}
