import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertParentContactsDenAccess } from "@/lib/authorize";
import { buildParentsCsv, type ParentCsvRow } from "@/lib/parentsCsv";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ denId: string }> }) {
  const session = await getSession();
  if (!session) return new NextResponse("Not authorized.", { status: 401 });

  const { denId } = await params;
  try {
    assertParentContactsDenAccess(session, denId);
  } catch {
    return new NextResponse("Not authorized.", { status: 403 });
  }

  const den = await prisma.den.findUnique({
    where: { id: denId },
    include: {
      scouts: {
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        include: { parents: { orderBy: { createdAt: "asc" } } },
      },
    },
  });
  if (!den) return new NextResponse("Den not found.", { status: 404 });

  const rows: ParentCsvRow[] = [];
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

  const csv = buildParentsCsv(rows);
  const filename = `pack376-parent-contacts-${den.rank.toLowerCase()}-${den.scoutingYear}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
