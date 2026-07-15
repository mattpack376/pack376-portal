"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertAdmin } from "@/lib/authorize";
import type { DeadlineCategory } from "@/generated/prisma/enums";

const PARENT_PORTAL_ADMIN_PATH = "/portal/admin/parent-portal";
const PARENT_DASHBOARD_PATH = "/portal/parent";

export async function createAnnouncementAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const title = String(formData.get("title") || "").trim();
  const body = String(formData.get("body") || "").trim();
  const pinned = formData.get("pinned") === "on";
  if (!title || !body) throw new Error("Title and body are required.");

  await prisma.announcement.create({
    data: { title, body, pinned, createdByUserId: session.userId },
  });

  revalidatePath(PARENT_PORTAL_ADMIN_PATH);
  revalidatePath(PARENT_DASHBOARD_PATH);
}

export async function deleteAnnouncementAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const id = String(formData.get("id") || "");
  if (!id) throw new Error("Missing announcement id.");

  await prisma.announcement.delete({ where: { id } });

  revalidatePath(PARENT_PORTAL_ADMIN_PATH);
  revalidatePath(PARENT_DASHBOARD_PATH);
}

export async function createDeadlineAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const title = String(formData.get("title") || "").trim();
  const category = String(formData.get("category") || "GENERAL") as DeadlineCategory;
  const dueDateStr = String(formData.get("dueDate") || "").trim();
  const description = String(formData.get("description") || "").trim();
  if (!title || !dueDateStr) throw new Error("Title and due date are required.");

  const dueDate = new Date(`${dueDateStr}T00:00:00Z`);
  if (Number.isNaN(dueDate.getTime())) throw new Error("Invalid due date.");

  await prisma.deadline.create({
    data: { title, category, dueDate, description: description || null },
  });

  revalidatePath(PARENT_PORTAL_ADMIN_PATH);
  revalidatePath(PARENT_DASHBOARD_PATH);
}

export async function deleteDeadlineAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const id = String(formData.get("id") || "");
  if (!id) throw new Error("Missing deadline id.");

  await prisma.deadline.delete({ where: { id } });

  revalidatePath(PARENT_PORTAL_ADMIN_PATH);
  revalidatePath(PARENT_DASHBOARD_PATH);
}

export async function createVolunteerNeedAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const title = String(formData.get("title") || "").trim();
  const description = String(formData.get("description") || "").trim();
  if (!title) throw new Error("Title is required.");

  await prisma.volunteerNeed.create({
    data: { title, description: description || null },
  });

  revalidatePath(PARENT_PORTAL_ADMIN_PATH);
  revalidatePath(PARENT_DASHBOARD_PATH);
}

export async function toggleVolunteerNeedAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const id = String(formData.get("id") || "");
  const active = String(formData.get("active") || "") === "true";
  if (!id) throw new Error("Missing volunteer need id.");

  await prisma.volunteerNeed.update({ where: { id }, data: { active: !active } });

  revalidatePath(PARENT_PORTAL_ADMIN_PATH);
  revalidatePath(PARENT_DASHBOARD_PATH);
}

export async function deleteVolunteerNeedAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const id = String(formData.get("id") || "");
  if (!id) throw new Error("Missing volunteer need id.");

  await prisma.volunteerNeed.delete({ where: { id } });

  revalidatePath(PARENT_PORTAL_ADMIN_PATH);
  revalidatePath(PARENT_DASHBOARD_PATH);
}
