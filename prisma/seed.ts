import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { SEED_ADVENTURES } from "./seed-data";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log(`Seeding adventures (${SEED_ADVENTURES.length} rows)...`);
  for (const adv of SEED_ADVENTURES) {
    await prisma.adventure.upsert({
      where: { rank_name: { rank: adv.rank, name: adv.name } },
      update: { type: adv.type, sortOrder: adv.sortOrder, note: adv.note ?? null },
      create: adv,
    });
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
