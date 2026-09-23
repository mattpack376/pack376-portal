"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertAdmin } from "@/lib/authorize";
import { DEADLINE_CATEGORY_LABELS } from "@/lib/deadlineCategories";
import { recordAudit, changedFields, auditDate } from "@/lib/audit";
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

  const announcement = await prisma.announcement.create({
    data: { title, body, pinned, createdByUserId: session.userId },
  });

  await recordAudit(session, {
    action: "announcement.create",
    summary: `Posted the parent announcement “${title}”${pinned ? " (pinned)" : ""}`,
    entityType: "Announcement",
    entityId: announcement.id,
    details: [
      { label: "Title", from: "—", to: title },
      { label: "Body", from: "—", to: body },
      { label: "Pinned", from: "—", to: pinned ? "Yes" : "No" },
    ],
  });

  revalidatePath(PARENT_PORTAL_ADMIN_PATH);
  revalidatePath(PARENT_DASHBOARD_PATH);
}

export async function updateAnnouncementAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const id = String(formData.get("id") || "");
  const title = String(formData.get("title") || "").trim();
  const body = String(formData.get("body") || "").trim();
  const pinned = formData.get("pinned") === "on";
  if (!id) throw new Error("Missing announcement id.");
  if (!title || !body) throw new Error("Title and body are required.");

  const before = await prisma.announcement.findUnique({
    where: { id },
    select: { title: true, body: true, pinned: true },
  });

  await prisma.announcement.update({
    where: { id },
    data: { title, body, pinned },
  });

  await recordAudit(session, {
    action: "announcement.update",
    summary: `Edited the parent announcement “${title}”`,
    entityType: "Announcement",
    entityId: id,
    details: changedFields({
      Title: [before?.title, title],
      Body: [before?.body, body],
      Pinned: [before?.pinned, pinned],
    }),
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

  const announcement = await prisma.announcement.delete({ where: { id } });

  await recordAudit(session, {
    action: "announcement.delete",
    summary: `Deleted the parent announcement “${announcement.title}”`,
    entityType: "Announcement",
    entityId: id,
    details: [
      { label: "Title", from: announcement.title, to: "—" },
      { label: "Body", from: announcement.body, to: "—" },
    ],
  });

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

  const deadline = await prisma.deadline.create({
    data: { title, category, dueDate, description: description || null },
  });

  await recordAudit(session, {
    action: "deadline.create",
    summary: `Added the deadline “${title}”, due ${auditDate(dueDate)}`,
    entityType: "Deadline",
    entityId: deadline.id,
    details: [
      { label: "Title", from: "—", to: title },
      { label: "Category", from: "—", to: DEADLINE_CATEGORY_LABELS[category] ?? category },
      { label: "Due date", from: "—", to: auditDate(dueDate) },
      ...(description ? [{ label: "Description", from: "—", to: description }] : []),
    ],
  });

  revalidatePath(PARENT_PORTAL_ADMIN_PATH);
  revalidatePath(PARENT_DASHBOARD_PATH);
}

export async function updateDeadlineAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const id = String(formData.get("id") || "");
  const title = String(formData.get("title") || "").trim();
  const category = String(formData.get("category") || "GENERAL") as DeadlineCategory;
  const dueDateStr = String(formData.get("dueDate") || "").trim();
  const description = String(formData.get("description") || "").trim();
  if (!id) throw new Error("Missing deadline id.");
  if (!title || !dueDateStr) throw new Error("Title and due date are required.");

  const dueDate = new Date(`${dueDateStr}T00:00:00Z`);
  if (Number.isNaN(dueDate.getTime())) throw new Error("Invalid due date.");

  const before = await prisma.deadline.findUnique({
    where: { id },
    select: { title: true, category: true, dueDate: true, description: true },
  });

  await prisma.deadline.update({
    where: { id },
    data: { title, category, dueDate, description: description || null },
  });

  await recordAudit(session, {
    action: "deadline.update",
    summary: `Edited the deadline “${title}”`,
    entityType: "Deadline",
    entityId: id,
    details: changedFields({
      Title: [before?.title, title],
      Category: [
        before ? DEADLINE_CATEGORY_LABELS[before.category] ?? before.category : null,
        DEADLINE_CATEGORY_LABELS[category] ?? category,
      ],
      "Due date": [before?.dueDate, dueDate],
      Description: [before?.description, description || null],
    }),
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

  const deadline = await prisma.deadline.delete({ where: { id } });

  await recordAudit(session, {
    action: "deadline.delete",
    summary: `Deleted the deadline “${deadline.title}” (was due ${auditDate(deadline.dueDate)})`,
    entityType: "Deadline",
    entityId: id,
    details: [
      { label: "Title", from: deadline.title, to: "—" },
      { label: "Due date", from: auditDate(deadline.dueDate), to: "—" },
    ],
  });

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

  const need = await prisma.volunteerNeed.create({
    data: { title, description: description || null },
  });

  await recordAudit(session, {
    action: "volunteerNeed.create",
    summary: `Added the volunteer need “${title}”`,
    entityType: "VolunteerNeed",
    entityId: need.id,
    details: [
      { label: "Title", from: "—", to: title },
      ...(description ? [{ label: "Description", from: "—", to: description }] : []),
    ],
  });

  revalidatePath(PARENT_PORTAL_ADMIN_PATH);
  revalidatePath(PARENT_DASHBOARD_PATH);
}

export async function updateVolunteerNeedAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const id = String(formData.get("id") || "");
  const title = String(formData.get("title") || "").trim();
  const description = String(formData.get("description") || "").trim();
  if (!id) throw new Error("Missing volunteer need id.");
  if (!title) throw new Error("Title is required.");

  const before = await prisma.volunteerNeed.findUnique({
    where: { id },
    select: { title: true, description: true },
  });

  await prisma.volunteerNeed.update({
    where: { id },
    data: { title, description: description || null },
  });

  await recordAudit(session, {
    action: "volunteerNeed.update",
    summary: `Edited the volunteer need “${title}”`,
    entityType: "VolunteerNeed",
    entityId: id,
    details: changedFields({
      Title: [before?.title, title],
      Description: [before?.description, description || null],
    }),
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

  const need = await prisma.volunteerNeed.update({ where: { id }, data: { active: !active } });

  await recordAudit(session, {
    action: "volunteerNeed.toggle",
    summary: `${need.active ? "Reopened" : "Closed"} the volunteer need “${need.title}”`,
    entityType: "VolunteerNeed",
    entityId: id,
    details: [{ label: "Active", from: active ? "Yes" : "No", to: need.active ? "Yes" : "No" }],
  });

  revalidatePath(PARENT_PORTAL_ADMIN_PATH);
  revalidatePath(PARENT_DASHBOARD_PATH);
}

export async function deleteVolunteerNeedAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const id = String(formData.get("id") || "");
  if (!id) throw new Error("Missing volunteer need id.");

  const need = await prisma.volunteerNeed.delete({ where: { id } });

  await recordAudit(session, {
    action: "volunteerNeed.delete",
    summary: `Deleted the volunteer need “${need.title}”`,
    entityType: "VolunteerNeed",
    entityId: id,
    details: [{ label: "Title", from: need.title, to: "—" }],
  });

  revalidatePath(PARENT_PORTAL_ADMIN_PATH);
  revalidatePath(PARENT_DASHBOARD_PATH);
}
