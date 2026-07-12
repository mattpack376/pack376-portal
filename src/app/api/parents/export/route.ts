import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { buildParentsCsv, type ParentCsvRow } from "@/lib/parentsCsv";

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

  const rows: ParentCsvRow[] = [];
  for (const den of dens) {
    for (const scout of den.scouts) {
      for (const parent of scout.parents) {
        rows.push({
          scoutingYear: den.scoutingYear,
          rank: den.rank,
          label: den.label,
          firstName: scout.firstName,
          lastName: scout.lastName,
          parentName: parent.name,
          parentEmail: parent.email,
          parentPhone: parent.phone,
        });
      }
    }
  }

  const csv = buildParentsCsv(rows);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pack376-parent-contacts-all.csv"`,
    },
  });
}
