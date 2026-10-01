import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertParentContactsDenAccess } from "@/lib/authorize";
import { denDisplayName } from "@/lib/rankConfig";
import { buildParentsPdf, parentsPdfResponse } from "@/lib/parentsPdf";

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

  const pdf = await buildParentsPdf([den], { scope: denDisplayName(den.rank, den.scoutingYear, den.label) });
  return parentsPdfResponse(pdf, `pack376-parent-contacts-${den.rank.toLowerCase()}-${den.scoutingYear}.pdf`);
}
