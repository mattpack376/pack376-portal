import type { AdventureType, Rank } from "@/generated/prisma/enums";
import { awardTypeLabel } from "@/lib/advancementAuditRules";
import { toCsv } from "@/lib/csv";
import { RANK_INFO, RANK_ORDER } from "@/lib/rankConfig";
import type { PendingAwardItem } from "@/lib/pendingAwardsRules";

/*
 * The Scout Shop shopping list behind Pending Awards' "Shopping list CSV/PDF":
 * every adventure and rank badge waiting to be handed out, counted — how many
 * of each to buy — by rank, with how many each den needs. Built from the same
 * items the page shows (loadPendingAwards), so its grand total is the page's
 * patch count for the same filters. Pure, so it can be unit tested; the PDF is
 * in shoppingListPdf.ts.
 */

export type ShoppingDenCount = { denId: string; denName: string; quantity: number };

export type ShoppingLine = {
  /** rank + item name: each rank has its own patch even when names repeat. */
  key: string;
  rank: Rank;
  itemName: string;
  adventureType: AdventureType | null;
  quantity: number;
  /** Per-den split, in the page's den order. */
  dens: ShoppingDenCount[];
};

export type ShoppingRank = { rank: Rank; label: string; lines: ShoppingLine[]; subtotal: number };

export type ShoppingList = { ranks: ShoppingRank[]; total: number; denCount: number };

/** Rank badge first, then Required, then Electives. */
const typeOrder = (type: AdventureType | null) => (type === null ? 0 : type === "REQUIRED" ? 1 : 2);

export function buildShoppingList(items: readonly PendingAwardItem[]): ShoppingList {
  const lines = new Map<string, ShoppingLine>();
  for (const item of items) {
    const key = `${item.rank}:${item.adventureName}`;
    let line = lines.get(key);
    if (!line) {
      line = { key, rank: item.rank, itemName: item.adventureName, adventureType: item.adventureType, quantity: 0, dens: [] };
      lines.set(key, line);
    }
    line.quantity += 1;
    const den = line.dens.find((d) => d.denId === item.denId);
    if (den) den.quantity += 1;
    else line.dens.push({ denId: item.denId, denName: item.denName, quantity: 1 });
  }

  const ranks: ShoppingRank[] = [];
  for (const rank of RANK_ORDER) {
    const rankLines = [...lines.values()]
      .filter((l) => l.rank === rank)
      .sort(
        (a, b) =>
          typeOrder(a.adventureType) - typeOrder(b.adventureType) ||
          a.itemName.localeCompare(b.itemName, "en", { sensitivity: "base" }),
      );
    if (rankLines.length === 0) continue;
    ranks.push({
      rank,
      label: RANK_INFO[rank].label,
      lines: rankLines,
      subtotal: rankLines.reduce((sum, l) => sum + l.quantity, 0),
    });
  }
  return {
    ranks,
    total: ranks.reduce((sum, r) => sum + r.subtotal, 0),
    denCount: new Set(items.map((i) => i.denId)).size,
  };
}

/** "Wolf 1 Den: 3; Wolf 2 Den: 2" */
export const denSplit = (line: ShoppingLine, separator = "; ") =>
  line.dens.map((d) => `${d.denName}: ${d.quantity}`).join(separator);

export function buildShoppingListCsv(list: ShoppingList): string {
  return toCsv([
    ["Rank", "Item", "Type", "Quantity", "Dens"],
    ...list.ranks.flatMap((r) => [
      ...r.lines.map((l) => [r.label, l.itemName, awardTypeLabel(l.adventureType), l.quantity, denSplit(l)]),
      [`${r.label} subtotal`, "", "", r.subtotal, ""],
    ]),
    ["Total", "", "", list.total, ""],
  ]);
}

/** pack376-shopping-list-2026-2027.csv, or …-2026-2027-wolf-1-den.pdf with a den filter on. */
export function shoppingListFilename(year: string, denName: string | null, extension: "csv" | "pdf") {
  const slug = denName
    ? `-${denName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")}`
    : "";
  return `pack376-shopping-list-${year}${slug === "-" ? "" : slug}.${extension}`;
}
