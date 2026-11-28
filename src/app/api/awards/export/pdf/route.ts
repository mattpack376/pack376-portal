import type { NextRequest } from "next/server";
import { parentsPdfResponse } from "@/lib/parentsPdf";
import { loadPendingAwardsExport } from "@/lib/pendingAwardsExport";
import { shoppingListFilename } from "@/lib/shoppingList";
import { buildShoppingListPdf } from "@/lib/shoppingListPdf";

/** Pending Awards' shopping list + hand-out checklist as a PDF. Who may download, and which dens: see loadPendingAwardsExport. */
export async function GET(request: NextRequest) {
  const result = await loadPendingAwardsExport(request.nextUrl.searchParams);
  if ("status" in result) return new Response("Not authorized.", { status: result.status, headers: { "Cache-Control": "private, no-store" } });
  const pdf = await buildShoppingListPdf(result.items, result);
  return parentsPdfResponse(pdf, shoppingListFilename(result.year, result.denName, "pdf"));
}
