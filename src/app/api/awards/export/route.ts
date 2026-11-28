import type { NextRequest } from "next/server";
import { csvResponse } from "@/lib/csv";
import { loadPendingAwardsExport } from "@/lib/pendingAwardsExport";
import { buildShoppingList, buildShoppingListCsv, shoppingListFilename } from "@/lib/shoppingList";

/** Pending Awards' Scout Shop shopping list as a CSV. Who may download, and which dens: see loadPendingAwardsExport. */
export async function GET(request: NextRequest) {
  const result = await loadPendingAwardsExport(request.nextUrl.searchParams);
  if ("status" in result) return new Response("Not authorized.", { status: result.status, headers: { "Cache-Control": "private, no-store" } });
  return csvResponse(buildShoppingListCsv(buildShoppingList(result.items)), shoppingListFilename(result.year, result.denName, "csv"));
}
