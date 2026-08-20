/**
 * Creates (or updates) a local portal login for development.
 *
 *   DEV_ADMIN_USER=devadmin DEV_ADMIN_PASS='your-password' npx tsx prisma/createDevAdmin.ts
 *
 * Defaults to an ADMIN. Pass DEV_ADMIN_ROLE to make one of the other roles,
 * which is how you exercise the role-specific nav and landing pages:
 *
 *   DEV_ADMIN_USER=devden DEV_ADMIN_PASS='...' DEV_ADMIN_ROLE=DEN \
 *     DEV_ADMIN_DEN=first npx tsx prisma/createDevAdmin.ts
 *
 * The password is read from the environment so it never lands in this file,
 * in the repo, or in shell history if you prefix the command with a space.
 *
 * Refuses to run against anything but a local database — see the guard below.
 * This is a dev convenience only; real accounts are made from the Users panel.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { Role } from "../src/generated/prisma/enums";
import { PrismaPg } from "@prisma/adapter-pg";
import { ROLE_LABELS, DEN_ASSIGNABLE_ROLES } from "../src/lib/roleLabels";

/**
 * Roles come from the generated enum rather than ROLE_LABELS, so a role added
 * to the schema is accepted here without editing this file — and so the check
 * below actually narrows the string to Role instead of needing a cast.
 */
const ROLES = Object.values(Role);
const isRole = (value: string): value is Role => (ROLES as string[]).includes(value);
const url = process.env.DATABASE_URL ?? "";
const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url);

/** Where each role lands after sign-in — mirrors homeForRole() in lib/authorize.ts. */
const HOME: Record<string, string> = {
  ADMIN: "/portal/admin",
  JUNIOR_ADMIN: "/portal/admin",
  ATTENDANCE_ADMIN: "/portal/admin/attendance",
  PHOTOGRAPHER: "/portal/admin/albums",
  PARENT: "/portal/parent",
  TRIP_VIEWER: "/portal/admin/camp-conron",
  DEN: "/portal/den",
};

async function main() {
  if (!isLocal) {
    throw new Error(
      "DATABASE_URL does not point at localhost. Refusing to create an account " +
        "on a remote database — make real accounts from the Users panel.",
    );
  }

  const username = process.env.DEV_ADMIN_USER?.trim().toLowerCase();
  const password = process.env.DEV_ADMIN_PASS;
  const role = (process.env.DEV_ADMIN_ROLE ?? "ADMIN").trim().toUpperCase();
  const den = process.env.DEV_ADMIN_DEN?.trim();

  if (!username || !password) {
    throw new Error(
      "Set both DEV_ADMIN_USER and DEV_ADMIN_PASS, e.g.\n" +
        "  DEV_ADMIN_USER=devadmin DEV_ADMIN_PASS='choose-one' npx tsx prisma/createDevAdmin.ts",
    );
  }
  if (password.length < 8) throw new Error("Pick a password of at least 8 characters.");
  if (!isRole(role)) {
    throw new Error(`DEV_ADMIN_ROLE must be one of: ${ROLES.join(", ")}\nGot: ${role}`);
  }

  const adapter = new PrismaPg({ connectionString: url });
  const prisma = new PrismaClient({ adapter });
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.upsert({
      where: { username },
      // Bump sessionVersion so any token issued against the old password or
      // role dies. displayName is only set on create, so re-running to change
      // a password doesn't clobber a name you edited in the Users panel.
      update: { passwordHash, role, sessionVersion: { increment: 1 } },
      create: { username, passwordHash, role, displayName: `Dev ${ROLE_LABELS[role]}` },
      select: { id: true, username: true, role: true, createdAt: true, updatedAt: true },
    });
    const created = user.createdAt.getTime() === user.updatedAt.getTime();
    console.log(`${created ? "Created" : "Updated"} local ${ROLE_LABELS[user.role]}: ${user.username}`);

    if (den) {
      if (!(DEN_ASSIGNABLE_ROLES as readonly string[]).includes(role)) {
        console.log(
          `  Ignoring DEV_ADMIN_DEN — only ${DEN_ASSIGNABLE_ROLES.join(", ")} are listed as a den's leader.`,
        );
      } else {
        const target =
          den.toLowerCase() === "first"
            ? await prisma.den.findFirst({ orderBy: [{ scoutingYear: "desc" }, { createdAt: "asc" }] })
            : await prisma.den.findUnique({ where: { id: den } });
        if (!target) {
          throw new Error(
            den.toLowerCase() === "first"
              ? "No dens exist yet — create one from the admin Dashboard first."
              : `No den with id ${den}.`,
          );
        }
        await prisma.denAssignment.upsert({
          where: { userId_denId: { userId: user.id, denId: target.id } },
          update: {},
          create: { userId: user.id, denId: target.id },
        });
        console.log(`  Linked to den: ${target.rank} ${target.label} ${target.scoutingYear}`.replace(/\s+/g, " "));
      }
    } else if (role === "DEN") {
      console.log("  No den linked — /portal/den will show a placeholder. Re-run with DEV_ADMIN_DEN=first.");
    } else if (role === "PARENT") {
      console.log(
        "  No scouts linked — the parent dashboard will show empty sections. Link one from\n" +
          "  Users > Parent Accounts, which needs the scout to have a parent contact on file.",
      );
    }

    console.log(`Sign in at http://localhost:3000/portal/login — lands on ${HOME[role]}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
