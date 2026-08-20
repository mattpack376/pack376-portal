/**
 * Creates (or updates) a local ADMIN login for development.
 *
 *   DEV_ADMIN_USER=someone DEV_ADMIN_PASS='your-password' npx tsx prisma/createDevAdmin.ts
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
import { PrismaPg } from "@prisma/adapter-pg";

const url = process.env.DATABASE_URL ?? "";
const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url);

async function main() {
  if (!isLocal) {
    throw new Error(
      "DATABASE_URL does not point at localhost. Refusing to create an admin " +
        "account on a remote database — make real accounts from the Users panel.",
    );
  }

  const username = process.env.DEV_ADMIN_USER?.trim().toLowerCase();
  const password = process.env.DEV_ADMIN_PASS;
  if (!username || !password) {
    throw new Error(
      "Set both DEV_ADMIN_USER and DEV_ADMIN_PASS, e.g.\n" +
        "  DEV_ADMIN_USER=devadmin DEV_ADMIN_PASS='choose-one' npx tsx prisma/createDevAdmin.ts",
    );
  }
  if (password.length < 8) throw new Error("Pick a password of at least 8 characters.");

  const adapter = new PrismaPg({ connectionString: url });
  const prisma = new PrismaClient({ adapter });
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.upsert({
      where: { username },
      // Bump sessionVersion so any token issued against the old password dies.
      update: { passwordHash, role: "ADMIN", sessionVersion: { increment: 1 } },
      create: { username, passwordHash, role: "ADMIN", displayName: "Dev Admin" },
      select: { username: true, role: true, createdAt: true, updatedAt: true },
    });
    const made = user.createdAt.getTime() === user.updatedAt.getTime();
    console.log(`${made ? "Created" : "Updated"} local ${user.role}: ${user.username}`);
    console.log("Sign in at http://localhost:3000/portal/login");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
