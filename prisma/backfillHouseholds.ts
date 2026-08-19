import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

/**
 * One-time backfill: groups scouts that already share a parent's portal
 * login into a Household together, and links that login to the household
 * too. Skipped if the scout/user is already in a household, so it's safe to
 * re-run after new siblings are invited under an existing login.
 */
async function main() {
  const usersWithMultipleScouts = await prisma.user.findMany({
    where: { role: "PARENT" },
    include: { parentContacts: { select: { scoutId: true } } },
  });

  let created = 0;
  for (const user of usersWithMultipleScouts) {
    const scoutIds = [...new Set(user.parentContacts.map((c) => c.scoutId))];
    if (scoutIds.length < 2) continue;

    const scouts = await prisma.scout.findMany({
      where: { id: { in: scoutIds } },
      select: { id: true, householdId: true, lastName: true },
    });
    const alreadyGrouped = scouts.some((s) => s.householdId) || user.householdId;
    if (alreadyGrouped) continue;

    const household = await prisma.household.create({
      data: {
        name: `${scouts[0].lastName} Family`,
        scouts: { connect: scoutIds.map((id) => ({ id })) },
        users: { connect: { id: user.id } },
      },
    });
    created++;
    console.log(`Created household ${household.id} (${household.name}) for ${scoutIds.length} scouts under ${user.username}`);
  }

  console.log(`Done. Created ${created} household(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
