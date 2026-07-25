import "server-only";
import { prisma } from "@/lib/prisma";

/** The current top-of-homepage banner, if any is active. */
export async function getActiveSiteBanner() {
  return prisma.siteBanner.findFirst({
    where: { active: true },
    orderBy: { createdAt: "desc" },
  });
}

/** Every banner, for the admin editor. */
export async function getAllSiteBanners() {
  return prisma.siteBanner.findMany({ orderBy: { createdAt: "desc" } });
}
