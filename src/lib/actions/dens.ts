"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertAdmin } from "@/lib/authorize";
import { hashPassword } from "@/lib/auth";
import { generatePassword } from "@/lib/passwords";
import { nextRank as computeNextRank } from "@/lib/rankConfig";
import { parseScoutingYear } from "@/lib/attendanceSchedule";
import type { Rank } from "@/generated/prisma/enums";

export type CreatedCredential = { username: string; password: string };
export type DenActionState = { error?: string; credential?: CreatedCredential };

async function createDenAccount(denId: string, rank: Rank, scoutingYear: string, username: string) {
  const password = generatePassword();
  const user = await prisma.user.create({
    data: {
      username: username.toLowerCase(),
      passwordHash: await hashPassword(password),
      role: "DEN",
      displayName: `${rank} ${scoutingYear}`,
    },
  });
  await prisma.denAssignment.create({ data: { userId: user.id, denId } });
  return { username: username.toLowerCase(), password };
}

export async function createDenAction(
  _prevState: DenActionState,
  formData: FormData
): Promise<DenActionState> {
  const session = await getSession();
  if (!session) return { error: "Not authorized." };
  try {
    assertAdmin(session);
  } catch {
    return { error: "Not authorized." };
  }

  const rank = String(formData.get("rank") || "") as Rank;
  const scoutingYear = String(formData.get("scoutingYear") || "").trim();
  const label = String(formData.get("label") || "").trim();
  const createLogin = formData.get("createLogin") === "on";
  const username = String(formData.get("username") || "").trim();

  if (!rank || !scoutingYear) {
    return { error: "Rank and scouting year are required." };
  }
  try {
    parseScoutingYear(scoutingYear);
  } catch {
    return { error: 'Scouting year must look like "2026-2027" (two consecutive years).' };
  }

  const existing = await prisma.den.findUnique({
    where: { rank_scoutingYear_label: { rank, scoutingYear, label } },
  });
  if (existing) {
    return { error: "A den with this rank, year, and label already exists." };
  }

  const den = await prisma.den.create({ data: { rank, scoutingYear, label } });

  let credential: CreatedCredential | undefined;
  if (createLogin) {
    if (!username) return { error: "Den created, but a username is required to create its login." };
    const usernameTaken = await prisma.user.findUnique({ where: { username: username.toLowerCase() } });
    if (usernameTaken) return { error: "Den created, but that username is already taken." };
    credential = await createDenAccount(den.id, rank, scoutingYear, username);
  }

  revalidatePath("/portal/admin");
  return { credential };
}

export async function addScoutAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const denId = String(formData.get("denId") || "");
  const firstName = String(formData.get("firstName") || "").trim();
  const lastName = String(formData.get("lastName") || "").trim();
  if (!denId || !firstName || !lastName) throw new Error("Missing scout name.");

  await prisma.scout.create({ data: { denId, firstName, lastName } });
  revalidatePath(`/portal/admin/dens/${denId}`);
}

export async function removeScoutAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const scoutId = String(formData.get("scoutId") || "");
  const denId = String(formData.get("denId") || "");
  if (!scoutId) throw new Error("Missing scout id.");

  await prisma.scout.delete({ where: { id: scoutId } });
  revalidatePath(`/portal/admin/dens/${denId}`);
}

export async function promoteDenAction(
  _prevState: DenActionState,
  formData: FormData
): Promise<DenActionState> {
  const session = await getSession();
  if (!session) return { error: "Not authorized." };
  try {
    assertAdmin(session);
  } catch {
    return { error: "Not authorized." };
  }

  const denId = String(formData.get("denId") || "");
  const scoutingYear = String(formData.get("scoutingYear") || "").trim();
  const createLogin = formData.get("createLogin") === "on";
  const username = String(formData.get("username") || "").trim();

  const den = await prisma.den.findUnique({ where: { id: denId }, include: { scouts: true } });
  if (!den) return { error: "Den not found." };

  const next = computeNextRank(den.rank);
  if (!next) return { error: "Arrow of Light is the final rank — there's no next den to promote to." };
  if (!scoutingYear) return { error: "Enter the new scouting year." };
  try {
    parseScoutingYear(scoutingYear);
  } catch {
    return { error: 'Scouting year must look like "2027-2028" (two consecutive years).' };
  }

  const existing = await prisma.den.findUnique({
    where: { rank_scoutingYear_label: { rank: next, scoutingYear, label: den.label } },
  });
  if (existing) return { error: "A den already exists for that rank, year, and label." };

  const newDen = await prisma.den.create({
    data: { rank: next, scoutingYear, label: den.label },
  });

  if (den.scouts.length > 0) {
    await prisma.scout.createMany({
      data: den.scouts.map((s) => ({
        denId: newDen.id,
        firstName: s.firstName,
        lastName: s.lastName,
      })),
    });
  }

  let credential: CreatedCredential | undefined;
  if (createLogin) {
    if (!username) return { error: "Den promoted, but a username is required to create its login." };
    const usernameTaken = await prisma.user.findUnique({ where: { username: username.toLowerCase() } });
    if (usernameTaken) return { error: "Den promoted, but that username is already taken." };
    credential = await createDenAccount(newDen.id, next, scoutingYear, username);
  }

  revalidatePath("/portal/admin");
  if (!credential) {
    redirect(`/portal/admin/dens/${newDen.id}`);
  }
  return { credential };
}
