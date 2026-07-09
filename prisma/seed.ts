import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { SEED_ADVENTURES } from "./seed-data";
import type { Rank } from "../src/generated/prisma/enums";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const CURRENT_SCOUTING_YEAR = "2026-2027";

const ADMIN_USERNAMES = ["admin1", "admin2", "admin3"];

const DEN_RANKS: Rank[] = ["LION", "TIGER", "WOLF", "BEAR", "WEBELOS", "AOL"];

function generatePassword() {
  // 4 words worth of entropy, easy to read aloud/write down, no ambiguous separators.
  return randomBytes(9).toString("base64url");
}

async function hash(password: string) {
  return bcrypt.hash(password, 12);
}

async function main() {
  console.log(`Seeding adventures (${SEED_ADVENTURES.length} rows)...`);
  for (const adv of SEED_ADVENTURES) {
    await prisma.adventure.upsert({
      where: { rank_name: { rank: adv.rank, name: adv.name } },
      update: { type: adv.type, sortOrder: adv.sortOrder, note: adv.note ?? null },
      create: adv,
    });
  }

  const credentials: { username: string; password: string; role: string }[] = [];

  console.log("Seeding admin accounts...");
  for (const username of ADMIN_USERNAMES) {
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      console.log(`  ${username} already exists, skipping password reset.`);
      continue;
    }
    const password = generatePassword();
    await prisma.user.create({
      data: {
        username,
        passwordHash: await hash(password),
        role: "ADMIN",
        displayName: username,
      },
    });
    credentials.push({ username, password, role: "ADMIN" });
  }

  console.log(`Seeding dens + den accounts for ${CURRENT_SCOUTING_YEAR}...`);
  for (const rank of DEN_RANKS) {
    const den = await prisma.den.upsert({
      where: { rank_scoutingYear_label: { rank, scoutingYear: CURRENT_SCOUTING_YEAR, label: "" } },
      update: {},
      create: { rank, scoutingYear: CURRENT_SCOUTING_YEAR, label: "" },
    });

    const username = `${rank.toLowerCase()}${CURRENT_SCOUTING_YEAR.slice(0, 4)}`;
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      console.log(`  ${username} already exists, skipping password reset.`);
      continue;
    }
    const password = generatePassword();
    await prisma.user.create({
      data: {
        username,
        passwordHash: await hash(password),
        role: "DEN",
        denId: den.id,
        displayName: `${rank} ${CURRENT_SCOUTING_YEAR}`,
      },
    });
    credentials.push({ username, password, role: `DEN (${rank})` });
  }

  if (credentials.length > 0) {
    console.log("\n=== SAVE THESE NOW — shown only once, never stored in plaintext or logged again ===");
    for (const c of credentials) {
      console.log(`  [${c.role}]  ${c.username} / ${c.password}`);
    }
    console.log("===================================================================================\n");
  } else {
    console.log("\nNo new accounts created (all usernames already existed).\n");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
