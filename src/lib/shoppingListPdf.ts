import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { awardTypeLabel } from "@/lib/advancementAuditRules";
import { formatDateOnly } from "@/lib/dateOnly";
import { longDate, makeSafe, wrap } from "@/lib/parentsPdf";
import { RECEIPT_ORG_NAME } from "@/lib/receipts";
import { groupByScout, type PendingAwardFilters, type PendingAwardItem } from "@/lib/pendingAwardsRules";
import { buildShoppingList, denSplit } from "@/lib/shoppingList";

/*
 * Pending Awards' "Shopping list PDF", US Letter portrait, two parts:
 *   1. Shopping list — a table per rank: item, type, quantity, and empty
 *      Have / Buy boxes to fill in by hand, a subtotal per rank, a grand total.
 *   2. Hand-out checklist (from a new page) — each den, each scout, each award
 *      with a box to tick at the pack meeting and the date it was earned.
 * A rank, den or scout heading is never left alone at the bottom of a page;
 * one that runs on repeats its heading with "(continued)".
 */

export type ShoppingListScope = {
  year: string;
  filters: PendingAwardFilters;
  denName: string | null;
  heldBack: number;
};

const INCH = 72;
const WIDTH = 8.5 * INCH;
const HEIGHT = 11 * INCH;
const MARGIN = 0.6 * INCH;
const BOTTOM = 0.8 * INCH;
const CONTENT_WIDTH = WIDTH - 2 * MARGIN;

const BLUE = rgb(0, 0x3f / 255, 0x87 / 255);
const GOLD = rgb(0xf7 / 255, 0xa8 / 255, 0x1b / 255);
const DARK = rgb(0x1a / 255, 0x1a / 255, 0x1a / 255);
const GRAY = rgb(0x55 / 255, 0x55 / 255, 0x55 / 255);
const LINE = rgb(0xdd / 255, 0xdd / 255, 0xdd / 255);
const BOX = rgb(0x88 / 255, 0x88 / 255, 0x88 / 255);
const HEAD_FILL = rgb(0xf4 / 255, 0xf7 / 255, 0xfb / 255);
const TOTAL_FILL = rgb(0xfd / 255, 0xf6 / 255, 0xe7 / 255);

const TEXT_SIZE = 9.5;
const SMALL_SIZE = 8;
const LEADING = 12;
const SMALL_LEADING = 10.5;
const PAD_X = 5;
const PAD_Y = 5;
const HEAD_ROW_H = 16;
const SECTION_HEAD_H = 24;
const BOX_SIZE = 14;

// Part 1 columns: ITEM | TYPE | QTY | HAVE | BUY
const COLS = [CONTENT_WIDTH - 80 - 46 - 2 * 56, 80, 46, 56, 56];
const COL_X = COLS.map((_, i) => MARGIN + COLS.slice(0, i).reduce((sum, w) => sum + w, 0));
const COL_LABELS = ["ITEM", "TYPE", "QTY", "HAVE", "BUY"];

// Part 2 columns: [box] AWARD | EARNED
const CHECK_X = MARGIN + 14;
const CHECK_TEXT_X = CHECK_X + BOX_SIZE + 8;
const EARNED_W = 90;
const CHECK_TEXT_W = WIDTH - MARGIN - EARNED_W - CHECK_TEXT_X - PAD_X;

/** The PDF's header line: season, den (or "Every den"), each filter in use, how many to buy, when. */
export function shoppingListScopeLine(scope: ShoppingListScope, total: number, now: Date, noun = "to buy") {
  return [
    `Season ${scope.year}`,
    scope.denName ?? "Every den",
    scope.filters.type === "adventures" ? "Adventures only" : scope.filters.type === "ranks" ? "Rank badges only" : null,
    scope.filters.adventure ? `“${scope.filters.adventure}”` : null,
    scope.filters.before ? `Completed on or before ${formatDateOnly(scope.filters.before)}` : null,
    noun === "to buy" ? `${total} to buy` : `${total} ${noun}${total === 1 ? "" : "s"}`,
    `Generated ${longDate(now)}`,
  ]
    .filter(Boolean)
    .join("  •  ");
}

export async function buildShoppingListPdf(
  items: readonly PendingAwardItem[],
  scope: ShoppingListScope,
  now: Date = new Date(),
): Promise<Uint8Array> {
  const list = buildShoppingList(items);
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${RECEIPT_ORG_NAME} Scout Shop Shopping List`);
  pdf.setAuthor(RECEIPT_ORG_NAME);
  pdf.setCreator(RECEIPT_ORG_NAME);
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
  };
  const safe = makeSafe(fonts.regular);

  let page: PDFPage = pdf.addPage([WIDTH, HEIGHT]);
  let y = HEIGHT - MARGIN;
  const draw = (value: string, x: number, baseline: number, font: PDFFont, size: number, color = DARK) =>
    page.drawText(safe(value), { x, y: baseline, font, size, color });
  const drawRight = (value: string, right: number, baseline: number, font: PDFFont, size: number, color = DARK) =>
    draw(value, right - font.widthOfTextAtSize(safe(value), size), baseline, font, size, color);
  const rule = (thickness = 0.5, color = LINE) =>
    page.drawLine({ start: { x: MARGIN, y }, end: { x: WIDTH - MARGIN, y }, thickness, color });
  const box = (x: number, top: number) =>
    page.drawRectangle({ x, y: top - BOX_SIZE, width: BOX_SIZE, height: BOX_SIZE, borderColor: BOX, borderWidth: 0.8 });
  const fit = (text: string, width: number, font: PDFFont, size: number) => wrap(safe(text), font, size, width);
  const newPage = () => {
    page = pdf.addPage([WIDTH, HEIGHT]);
    y = HEIGHT - MARGIN;
  };
  const fits = (height: number) => y - height >= BOTTOM;

  const titleBlock = (title: string, lines: string[]) => {
    draw(title, MARGIN, y - 16, fonts.bold, 16, BLUE);
    y -= 31;
    for (const line of lines) {
      draw(line, MARGIN, y, fonts.regular, 9, GRAY);
      y -= 12;
    }
    y += 4;
    rule(2, GOLD);
    y -= 14;
  };

  const scopeLine = shoppingListScopeLine(scope, list.total, now);
  const heldBackLine =
    scope.heldBack > 0
      ? `Not counted: ${scope.heldBack} flagged on the advancement audit — fix or resolve those first.`
      : null;

  // ---- Part 1: shopping list ----
  titleBlock("Scout Shop Shopping List", [scopeLine, ...(heldBackLine ? [heldBackLine] : [])]);

  const showDens = list.denCount > 1;
  const rowFor = (line: (typeof list.ranks)[number]["lines"][number]) => {
    const name = fit(line.itemName, COLS[0] - 2 * PAD_X, fonts.bold, TEXT_SIZE);
    const dens = showDens ? fit(denSplit(line, "  •  "), COLS[0] - 2 * PAD_X, fonts.regular, SMALL_SIZE) : [];
    const height = Math.max(name.length * LEADING + dens.length * SMALL_LEADING, BOX_SIZE + 2) + 2 * PAD_Y;
    return { name, dens, height };
  };

  const rankHeading = (label: string, continued: boolean) => {
    draw(continued ? `${label} (continued)` : label, MARGIN, y - 15, fonts.bold, 12, BLUE);
    y -= SECTION_HEAD_H;
    page.drawRectangle({ x: MARGIN, y: y - HEAD_ROW_H, width: CONTENT_WIDTH, height: HEAD_ROW_H, color: HEAD_FILL });
    COL_LABELS.forEach((label, i) => {
      if (i >= 2) drawRight(label, COL_X[i] + COLS[i] - PAD_X, y - 11, fonts.bold, 7, GRAY);
      else draw(label, COL_X[i] + PAD_X, y - 11, fonts.bold, 7, GRAY);
    });
    y -= HEAD_ROW_H;
  };

  const totalRow = (label: string, quantity: number, fill: typeof TOTAL_FILL | null, size = TEXT_SIZE) => {
    const height = LEADING + 2 * PAD_Y;
    if (fill) page.drawRectangle({ x: MARGIN, y: y - height, width: CONTENT_WIDTH, height, color: fill });
    const baseline = y - PAD_Y - size * 0.82;
    draw(label, COL_X[0] + PAD_X, baseline, fonts.bold, size);
    drawRight(String(quantity), COL_X[2] + COLS[2] - PAD_X, baseline, fonts.bold, size + 1);
    y -= height;
    rule();
  };

  if (list.ranks.length === 0) {
    draw("Nothing is waiting to be awarded.", MARGIN, y - TEXT_SIZE, fonts.italic, TEXT_SIZE + 1, GRAY);
  }

  const SUM_ROW_H = LEADING + 2 * PAD_Y;
  list.ranks.forEach((rank, rankIndex) => {
    const isLastRank = rankIndex === list.ranks.length - 1;
    // What must stay on the page with a rank's last row: its subtotal, and after the last rank the grand total.
    const tail = SUM_ROW_H + (isLastRank ? 6 + 4 + SUM_ROW_H : 0);
    const rows = rank.lines.map((line) => ({ line, ...rowFor(line) }));
    // Heading, column heads and the first row together, so a heading is never orphaned.
    if (!fits(SECTION_HEAD_H + HEAD_ROW_H + rows[0].height + (rows.length === 1 ? tail : 0))) newPage();
    rankHeading(rank.label, false);
    rows.forEach((row, rowIndex) => {
      if (!fits(row.height + (rowIndex === rows.length - 1 ? tail : 0))) {
        newPage();
        rankHeading(rank.label, true);
      }
      const top = y - PAD_Y;
      const baseline = (n: number) => top - TEXT_SIZE * 0.82 - n * LEADING;
      row.name.forEach((text, n) => draw(text, COL_X[0] + PAD_X, baseline(n), fonts.bold, TEXT_SIZE));
      row.dens.forEach((text, n) =>
        draw(text, COL_X[0] + PAD_X, baseline(row.name.length - 1) - (n + 1) * SMALL_LEADING, fonts.regular, SMALL_SIZE, GRAY),
      );
      draw(awardTypeLabel(row.line.adventureType), COL_X[1] + PAD_X, baseline(0), fonts.regular, TEXT_SIZE, GRAY);
      drawRight(String(row.line.quantity), COL_X[2] + COLS[2] - PAD_X, baseline(0), fonts.bold, TEXT_SIZE + 1);
      // Have / Buy: wide empty boxes to write a number in.
      for (const col of [3, 4]) {
        page.drawRectangle({
          x: COL_X[col] + COLS[col] - PAD_X - BOX_SIZE * 2,
          y: top + 1 - BOX_SIZE,
          width: BOX_SIZE * 2,
          height: BOX_SIZE,
          borderColor: BOX,
          borderWidth: 0.8,
        });
      }
      y -= row.height;
      rule();
    });
    if (!fits(SUM_ROW_H)) {
      newPage();
      rankHeading(rank.label, true);
    }
    totalRow(`${rank.label} subtotal`, rank.subtotal, HEAD_FILL);
    y -= 6;
  });

  if (list.ranks.length > 0) {
    if (!fits(SUM_ROW_H + 4)) newPage();
    rule(2, GOLD);
    totalRow("Total to buy", list.total, TOTAL_FILL, TEXT_SIZE + 1);
  }

  // ---- Part 2: hand-out checklist ----
  const dens = groupByScout(items);
  if (dens.length > 0) {
    newPage();
    titleBlock("Hand-out Checklist", [
      `Tick each award as it's handed out.  •  ${shoppingListScopeLine(scope, list.total, now, "award")}`,
      "After the meeting, mark what was handed out as awarded on Pending Awards.",
    ]);

    const DEN_HEAD_H = 22;
    const SCOUT_HEAD_H = 18;
    const itemRow = (item: PendingAwardItem) => {
      const label = item.kind === "rank" ? item.adventureName : `${item.adventureName} (${awardTypeLabel(item.adventureType)})`;
      const lines = fit(label, CHECK_TEXT_W, fonts.regular, TEXT_SIZE);
      return { item, lines, height: Math.max(lines.length * LEADING, BOX_SIZE) + 6 };
    };
    const denHeading = (name: string, count: number, continued: boolean) => {
      page.drawRectangle({ x: MARGIN, y: y - DEN_HEAD_H + 4, width: CONTENT_WIDTH, height: DEN_HEAD_H - 4, color: HEAD_FILL });
      draw(continued ? `${name} (continued)` : name, MARGIN + PAD_X, y - 13, fonts.bold, 11, BLUE);
      drawRight(`${count} award${count === 1 ? "" : "s"}`, WIDTH - MARGIN - PAD_X, y - 13, fonts.regular, 8.5, GRAY);
      y -= DEN_HEAD_H;
    };
    const scoutHeading = (name: string, continued: boolean) => {
      draw(continued ? `${name} (continued)` : name, MARGIN + PAD_X, y - 12, fonts.bold, TEXT_SIZE + 0.5);
      drawRight("EARNED", WIDTH - MARGIN - PAD_X, y - 12, fonts.bold, 7, GRAY);
      y -= SCOUT_HEAD_H;
    };

    for (const den of dens) {
      const scouts = den.scouts.map((s) => ({ ...s, rows: s.items.map(itemRow) }));
      if (!fits(DEN_HEAD_H + SCOUT_HEAD_H + scouts[0].rows[0].height)) newPage();
      denHeading(den.denName, den.count, false);
      for (const scout of scouts) {
        // Keep a scout's awards together when they'd fit on a fresh page; a longer list just runs on.
        const block = SCOUT_HEAD_H + scout.rows.reduce((sum, r) => sum + r.height, 0);
        const roomOnFreshPage = HEIGHT - MARGIN - BOTTOM - DEN_HEAD_H;
        if (!fits(SCOUT_HEAD_H + scout.rows[0].height) || (!fits(block) && block <= roomOnFreshPage)) {
          newPage();
          denHeading(den.denName, den.count, true);
        }
        scoutHeading(scout.scoutName, false);
        for (const row of scout.rows) {
          if (!fits(row.height)) {
            newPage();
            denHeading(den.denName, den.count, true);
            scoutHeading(scout.scoutName, true);
          }
          const top = y - 2;
          box(CHECK_X, top);
          row.lines.forEach((text, n) => draw(text, CHECK_TEXT_X, top - 10.5 - n * LEADING, fonts.regular, TEXT_SIZE));
          drawRight(formatDateOnly(row.item.completedDate), WIDTH - MARGIN - PAD_X, top - 10.5, fonts.regular, TEXT_SIZE, GRAY);
          y -= row.height;
        }
        y -= 4;
        rule();
        y -= 4;
      }
      y -= 8;
    }
  }

  // ---- Footer on every page ----
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: MARGIN, y: 0.6 * INCH }, end: { x: WIDTH - MARGIN, y: 0.6 * INCH }, thickness: 0.5, color: LINE });
    p.drawText(safe(`${RECEIPT_ORG_NAME}  •  Scout Shop shopping list ${scope.year}  •  ${longDate(now)}`), {
      x: MARGIN,
      y: 0.42 * INCH,
      font: fonts.regular,
      size: 8,
      color: GRAY,
    });
    const right = `Page ${i + 1} of ${pages.length}`;
    p.drawText(right, { x: WIDTH - MARGIN - fonts.regular.widthOfTextAtSize(right, 8), y: 0.42 * INCH, font: fonts.regular, size: 8, color: GRAY });
  });

  return pdf.save();
}
