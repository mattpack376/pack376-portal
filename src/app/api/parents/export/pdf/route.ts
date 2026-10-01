import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { buildParentsPdf, parentsPdfResponse } from "@/lib/parentsPdf";

export async function GET() {
  const session = await getSession();
  if (!session) return new NextResponse("Not authorized.", { status: 401 });
  if (session.role !== "ADMIN" && session.role !== "JUNIOR_ADMIN") {
    return new NextResponse("Not authorized.", { status: 403 });
  }

  const dens = await prisma.den.findMany({
    include: {
      scouts: {
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        include: { parents: { orderBy: { createdAt: "asc" } } },
      },
    },
  });

  // Dens with no scouts are left off, same as the Printable View.
  const pdf = await buildParentsPdf(
    dens.filter((den) => den.scouts.length > 0),
    { scope: "All dens" }
  );
  return parentsPdfResponse(pdf, "pack376-parent-contacts-all.pdf");
}
