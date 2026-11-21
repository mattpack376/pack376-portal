"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertCalendarEditAccess } from "@/lib/authorize";
import { recordAudit, changedFields, auditDate } from "@/lib/audit";
import { parseDateOnlyString } from "@/lib/dateOnly";
import { AUDIENCE_LABELS, CATEGORIES, GLANCE_CATEGORIES, categoryToDb } from "@/lib/calendarData";

const CALENDAR_ADMIN_PATH = "/portal/admin/calendar";
const CALENDAR_PUBLIC_PATH = "/calendar";

async function requireCalendarEditor() {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertCalendarEditAccess(session);
  return session;
}

/** A trimmed text field, or null when blank. */
function text(formData: FormData, key: string, label: string, max: number): string | null {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) return null;
  if (value.length > max) throw new Error(`${label} is too long (${max} characters at most).`);
  return value;
}

const checked = (formData: FormData, key: string) => formData.get(key) === "on";

/**
 * Reads and checks the event form (shared by add and edit). Every rule that
 * can fail throws a sentence meant to be read, since a thrown message is all
 * the admin sees.
 */
function parseEventForm(formData: FormData) {
  const title = text(formData, "title", "The title", 140);
  if (!title) throw new Error("A title is required.");

  const categoryValue = String(formData.get("category") ?? "");
  const category = categoryToDb(categoryValue);
  if (!category) throw new Error("Pick a category.");

  const date = parseDateOnlyString(String(formData.get("date") ?? ""));
  const endDate = parseDateOnlyString(String(formData.get("endDate") ?? ""));
  if (endDate && !date) throw new Error("Add a start date before an end date.");
  if (date && endDate && endDate <= date) throw new Error("The end date has to come after the start date.");
  // "Sat or Sun" only means something when there are two dates to choose between.
  const eitherDay = !!endDate && checked(formData, "eitherDay");

  const audienceValue = String(formData.get("audience") ?? "");
  let audience: "LEADERS" | "ALL_HANDS" | null = null;
  if (audienceValue === "leaders") audience = "LEADERS";
  else if (audienceValue === "all-hands") audience = "ALL_HANDS";
  else if (audienceValue !== "") throw new Error("Pick who the event is for.");

  // The link ends up in an <a href>, so only real web addresses are allowed —
  // never a javascript: or data: URL typed (or pasted) into the box.
  const linkUrl = text(formData, "linkUrl", "The link", 300);
  if (linkUrl) {
    let parsed: URL | null = null;
    try {
      parsed = new URL(linkUrl);
    } catch {
      parsed = null;
    }
    if (!parsed || (parsed.protocol !== "https:" && parsed.protocol !== "http:")) {
      throw new Error("The link has to be a full web address, starting with https://");
    }
  }
  const linkLabel = linkUrl ? (text(formData, "linkLabel", "The link text", 40) ?? "More info") : null;

  // Only categories with a Year at a Glance column can be featured; Scout
  // Sundays have their own card, built from their dates.
  const glance = checked(formData, "glance") && (GLANCE_CATEGORIES as string[]).includes(categoryValue);

  return {
    title,
    detail: text(formData, "detail", "The details", 200),
    category,
    date,
    endDate,
    eitherDay,
    audience,
    noMeeting: checked(formData, "noMeeting"),
    tbd: checked(formData, "tbd"),
    important: checked(formData, "important"),
    linkUrl,
    linkLabel,
    glance,
    glanceLabel: glance ? text(formData, "glanceLabel", "The Year at a Glance name", 80) : null,
    glanceWhen: glance ? text(formData, "glanceWhen", "The Year at a Glance date text", 30) : null,
  };
}

const categoryLabel = (db: string | null | undefined) => CATEGORIES.find((c) => c.db === db)?.label;
const audienceLabel = (db: string | null | undefined) =>
  db === "LEADERS" ? AUDIENCE_LABELS.leaders : db === "ALL_HANDS" ? AUDIENCE_LABELS["all-hands"] : null;

function revalidateCalendar(id?: string) {
  revalidatePath(CALENDAR_ADMIN_PATH);
  if (id) revalidatePath(`${CALENDAR_ADMIN_PATH}/${id}`);
  revalidatePath(CALENDAR_PUBLIC_PATH);
}

export async function createCalendarEventAction(formData: FormData) {
  const session = await requireCalendarEditor();
  const data = parseEventForm(formData);

  const event = await prisma.calendarEvent.create({ data });

  await recordAudit(session, {
    action: "calendarEvent.create",
    summary: `Added the calendar event “${data.title}” (${data.date ? auditDate(data.date) : "no date yet"})`,
    entityType: "CalendarEvent",
    entityId: event.id,
    details: [
      { label: "Title", from: "—", to: data.title },
      { label: "Category", from: "—", to: categoryLabel(data.category) ?? data.category },
      { label: "Date", from: "—", to: data.date ? auditDate(data.date) : "—" },
    ],
  });

  revalidateCalendar();
  redirect(CALENDAR_ADMIN_PATH);
}

export async function updateCalendarEventAction(formData: FormData) {
  const session = await requireCalendarEditor();
  const id = String(formData.get("id") || "");
  if (!id) throw new Error("Missing event id.");
  const data = parseEventForm(formData);

  const before = await prisma.calendarEvent.findUnique({ where: { id } });
  if (!before) throw new Error("That event no longer exists.");

  await prisma.calendarEvent.update({ where: { id }, data });

  await recordAudit(session, {
    action: "calendarEvent.update",
    summary: `Edited the calendar event “${data.title}”`,
    entityType: "CalendarEvent",
    entityId: id,
    details: changedFields({
      Title: [before.title, data.title],
      Details: [before.detail, data.detail],
      Category: [categoryLabel(before.category), categoryLabel(data.category)],
      Date: [before.date, data.date],
      "End date": [before.endDate, data.endDate],
      "Dates are alternatives": [before.eitherDay, data.eitherDay],
      "Who it's for": [audienceLabel(before.audience), audienceLabel(data.audience)],
      "No meeting": [before.noMeeting, data.noMeeting],
      TBD: [before.tbd, data.tbd],
      Highlighted: [before.important, data.important],
      Link: [before.linkUrl, data.linkUrl],
      "Link text": [before.linkLabel, data.linkLabel],
      "In Year at a Glance": [before.glance, data.glance],
      "Year at a Glance name": [before.glanceLabel, data.glanceLabel],
      "Year at a Glance date text": [before.glanceWhen, data.glanceWhen],
    }),
  });

  revalidateCalendar(id);
}

export async function toggleCalendarEventVisibilityAction(formData: FormData) {
  const session = await requireCalendarEditor();
  const id = String(formData.get("id") || "");
  const visible = String(formData.get("visible") || "") === "true";
  if (!id) throw new Error("Missing event id.");

  const event = await prisma.calendarEvent.update({ where: { id }, data: { visible: !visible } });

  await recordAudit(session, {
    action: "calendarEvent.toggle",
    summary: `${event.visible ? "Showed" : "Hid"} the calendar event “${event.title}”`,
    entityType: "CalendarEvent",
    entityId: id,
    details: [{ label: "Visible", from: visible ? "Yes" : "No", to: event.visible ? "Yes" : "No" }],
  });

  revalidateCalendar(id);
}

export async function deleteCalendarEventAction(formData: FormData) {
  const session = await requireCalendarEditor();

  const id = String(formData.get("id") || "");
  if (!id) throw new Error("Missing event id.");

  const event = await prisma.calendarEvent.delete({ where: { id } });

  await recordAudit(session, {
    action: "calendarEvent.delete",
    summary: `Deleted the calendar event “${event.title}” (${event.date ? auditDate(event.date) : "no date"})`,
    entityType: "CalendarEvent",
    entityId: id,
    details: [
      { label: "Title", from: event.title, to: "—" },
      { label: "Date", from: event.date ? auditDate(event.date) : "—", to: "—" },
    ],
  });

  revalidateCalendar(id);
  redirect(CALENDAR_ADMIN_PATH);
}

/** The regular Friday meeting — see CalendarMeetingRule in the schema. */
export async function updateMeetingRuleAction(formData: FormData) {
  const session = await requireCalendarEditor();

  const title = text(formData, "title", "The meeting name", 60);
  if (!title) throw new Error("The meeting needs a name.");
  const detail = text(formData, "detail", "The meeting time", 60);
  const startDate = parseDateOnlyString(String(formData.get("startDate") ?? ""));
  const endDate = parseDateOnlyString(String(formData.get("endDate") ?? ""));
  if (!startDate || !endDate) throw new Error("Enter the first and last meeting dates.");
  if (endDate < startDate) throw new Error("The last meeting can't be before the first.");
  const enabled = checked(formData, "enabled");

  const before = await prisma.calendarMeetingRule.findUnique({ where: { id: "main" } });
  await prisma.calendarMeetingRule.upsert({
    where: { id: "main" },
    create: { id: "main", enabled, title, detail, startDate, endDate },
    update: { enabled, title, detail, startDate, endDate },
  });

  await recordAudit(session, {
    action: "calendarEvent.meetingRule",
    summary: "Changed the regular Friday meeting on the calendar",
    entityType: "CalendarMeetingRule",
    entityId: "main",
    details: changedFields({
      "Shown on calendar": [before?.enabled, enabled],
      Name: [before?.title, title],
      Time: [before?.detail, detail],
      "First meeting": [before?.startDate, startDate],
      "Last meeting": [before?.endDate, endDate],
    }),
  });

  revalidateCalendar();
}
