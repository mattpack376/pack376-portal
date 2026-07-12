"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertAdmin } from "@/lib/authorize";

export async function addParentAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const scoutId = String(formData.get("scoutId") || "");
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const phone = String(formData.get("phone") || "").trim();
  if (!scoutId || !name) throw new Error("A parent name is required.");

  await prisma.parent.create({
    data: { scoutId, name, email: email || null, phone: phone || null },
  });

  revalidatePath("/portal/roster/parents");
}

export async function updateParentAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const parentId = String(formData.get("parentId") || "");
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const phone = String(formData.get("phone") || "").trim();
  if (!parentId || !name) throw new Error("A parent name is required.");

  await prisma.parent.update({
    where: { id: parentId },
    data: { name, email: email || null, phone: phone || null },
  });

  revalidatePath("/portal/roster/parents");
}

export async function removeParentAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const parentId = String(formData.get("parentId") || "");
  if (!parentId) throw new Error("Missing parent id.");

  await prisma.parent.delete({ where: { id: parentId } });

  revalidatePath("/portal/roster/parents");
}
