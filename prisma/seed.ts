import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { SEED_ADVENTURES } from "./seed-data";
import { loadRequirementRows } from "./requirementsData";

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

  // Same rows, same ids as the generated migration (prisma/requirementsData.ts).
  const { requirements, adventures } = loadRequirementRows();
  console.log(`Seeding adventure requirements (${requirements.length} rows)...`);
  const adventureRows = await prisma.adventure.findMany({ select: { id: true, rank: true, name: true } });
  const adventureId = new Map(adventureRows.map((a) => [`${a.rank}|${a.name}`, a.id]));
  for (const a of adventures) {
    const id = adventureId.get(`${a.rank}|${a.adventureName}`);
    if (!id) continue;
    await prisma.adventure.update({
      where: { id },
      data: { requirementsNote: a.requirementsNote, requirementsPick: a.requirementsPick },
    });
  }
  for (const r of requirements) {
    const id = adventureId.get(`${r.rank}|${r.adventureName}`);
    if (!id) continue;
    const fields = { parentId: r.parentId, text: r.text, pick: r.pick, isGroup: r.isGroup, sortOrder: r.sortOrder };
    await prisma.adventureRequirement.upsert({
      where: { adventureId_code: { adventureId: id, code: r.code } },
      update: fields,
      create: { id: r.id, adventureId: id, code: r.code, ...fields },
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
