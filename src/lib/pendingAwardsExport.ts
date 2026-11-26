import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { getSession } from "@/lib/auth";
import { canViewPendingAwards } from "@/lib/authorize";
import { toCsv } from "@/lib/csv";
import { formatDateOnly } from "@/lib/dateOnly";
import { RANK_INFO } from "@/lib/rankConfig";
import { RECEIPT_ORG_NAME } from "@/lib/receipts";
import { longDate, makeSafe, wrap } from "@/lib/parentsPdf";
import { loadPendingAwards } from "@/lib/pendingAwardsData";
import {
  groupByAward,
  parsePendingAwardFilters,
  type PendingAwardFilters,
  type PendingAwardGroup,
} from "@/lib/pendingAwardsRules";

/*
 * The CSV and PDF of Pending Awards' "By award" view — the Scout Shop list:
 * each rank's adventure, how many scouts are waiting on it, and who. Both carry
 * what the page's filters match, in the dens the viewer may see, exactly as the
 * page does (loadPendingAwards). Held-back (flagged) adventures aren't counted.
 */

export async function loadPendingAwardsExport(searchParams: URLSearchParams) {
  const session = await getSession();
  if (!session) return { status: 401 as const };
  if (!canViewPendingAwards(session)) return { status: 403 as const };
  const filters = parsePendingAwardFilters(Object.fromEntries(searchParams.entries()));
  const data = await loadPendingAwards(session, filters);
  const denName = filters.denId ? data.dens.find((d) => d.id === filters.denId)?.name ?? null : null;
  return { filters, year: data.year, denName, groups: groupByAward(data.items), heldBack: data.heldBack.length };
}

export function pendingAwardsFilename(year: string, extension: "csv" | "pdf") {
  return `pack376-pending-awards-${year}.${extension}`;
}

const awardLabel = (g: PendingAwardGroup) => `${RANK_INFO[g.rank].label} — ${g.adventureName}`;

export function buildPendingAwardsCsv(groups: PendingAwardGroup[]): string {
  const total = groups.reduce((sum, g) => sum + g.items.length, 0);
  return toCsv([
    ["Rank", "Adventure", "Type", "Count", "Scouts"],
    ...groups.map((g) => [
      RANK_INFO[g.rank].label,
      g.adventureName,
      g.adventureType === "REQUIRED" ? "Required" : "Elective",
      g.items.length,
      g.items.map((i) => `${i.scoutName} (${i.denName})`).join("; "),
    ]),
    ["Total", "", "", total, ""],
  ]);
}

// ---- PDF: Letter, portrait, one table, headings repeat on every page ----

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
const HEAD_FILL = rgb(0xf4 / 255, 0xf7 / 255, 0xfb / 255);

const TEXT_SIZE = 9;
const LEADING = 12;
const PAD_X = 5;
const PAD_Y = 5;
const HEAD_ROW_H = 16;

const COL_LABELS = ["AWARD", "COUNT", "SCOUTS"];
const COL_WIDTHS = [170, 50, CONTENT_WIDTH - 220];
const COL_X = COL_WIDTHS.map((_, i) => MARGIN + COL_WIDTHS.slice(0, i).reduce((sum, w) => sum + w, 0));

export async function buildPendingAwardsPdf(
  groups: PendingAwardGroup[],
  scope: { year: string; filters: PendingAwardFilters; denName: string | null; heldBack: number },
  now: Date = new Date(),
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${RECEIPT_ORG_NAME} Pending Awards`);
  pdf.setAuthor(RECEIPT_ORG_NAME);
  pdf.setCreator(RECEIPT_ORG_NAME);
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
  };
  const safe = makeSafe(fonts.regular);
  const total = groups.reduce((sum, g) => sum + g.items.length, 0);

  let page: PDFPage = pdf.addPage([WIDTH, HEIGHT]);
  let y = HEIGHT - MARGIN;
  const draw = (value: string, x: number, baseline: number, font: PDFFont, size: number, color = DARK) =>
    page.drawText(safe(value), { x, y: baseline, font, size, color });

  draw("Pending Awards", MARGIN, y - 16, fonts.bold, 16, BLUE);
  const line = [
    `Season ${scope.year}`,
    scope.denName ?? "Every den",
    scope.filters.adventure ? `“${scope.filters.adventure}”` : null,
    scope.filters.before ? `Completed on or before ${formatDateOnly(scope.filters.before)}` : null,
    `${total} award${total === 1 ? "" : "s"}`,
    `Generated ${longDate(now)}`,
  ].filter(Boolean);
  draw(line.join("  •  "), MARGIN, y - 31, fonts.regular, 9, GRAY);
  y -= 40;
  if (scope.heldBack > 0) {
    draw(
      `Not counted: ${scope.heldBack} flagged on the advancement audit — fix or resolve those first.`,
      MARGIN,
      y - 4,
      fonts.italic,
      8.5,
      GRAY,
    );
    y -= 12;
  }
  page.drawLine({ start: { x: MARGIN, y }, end: { x: WIDTH - MARGIN, y }, thickness: 2, color: GOLD });
  y -= 12;

  const drawHead = () => {
    page.drawRectangle({ x: MARGIN, y: y - HEAD_ROW_H, width: CONTENT_WIDTH, height: HEAD_ROW_H, color: HEAD_FILL });
    COL_LABELS.forEach((label, i) => draw(label, COL_X[i] + PAD_X, y - 11, fonts.bold, 7, GRAY));
    y -= HEAD_ROW_H;
  };

  if (groups.length === 0) {
    draw("Nothing is waiting to be awarded.", MARGIN, y - TEXT_SIZE, fonts.italic, TEXT_SIZE + 1, GRAY);
  } else {
    drawHead();
  }

  const fit = (text: string, col: number, font = fonts.regular) => wrap(safe(text), font, TEXT_SIZE, COL_WIDTHS[col] - 2 * PAD_X);

  const rows = [
    ...groups.map((g) => ({
      award: [
        ...fit(awardLabel(g), 0, fonts.bold),
        ...fit(g.adventureType === "REQUIRED" ? "Required" : "Elective", 0),
      ],
      awardBoldLines: fit(awardLabel(g), 0, fonts.bold).length,
      count: String(g.items.length),
      scouts: fit(g.items.map((i) => `${i.scoutName} (${i.denName})`).join(", "), 2),
    })),
    ...(groups.length > 0 ? [{ award: ["Total"], awardBoldLines: 1, count: String(total), scouts: [] as string[] }] : []),
  ];

  for (const row of rows) {
    const height = Math.max(row.award.length, 1, row.scouts.length) * LEADING + 2 * PAD_Y;
    if (y - height < BOTTOM) {
      page = pdf.addPage([WIDTH, HEIGHT]);
      y = HEIGHT - MARGIN;
      drawHead();
    }
    const baseline = (n: number) => y - PAD_Y - TEXT_SIZE * 0.82 - n * LEADING;
    row.award.forEach((text, n) =>
      draw(text, COL_X[0] + PAD_X, baseline(n), n < row.awardBoldLines ? fonts.bold : fonts.regular, TEXT_SIZE, n < row.awardBoldLines ? DARK : GRAY),
    );
    draw(row.count, COL_X[1] + PAD_X, baseline(0), fonts.bold, TEXT_SIZE + 1);
    row.scouts.forEach((text, n) => draw(text, COL_X[2] + PAD_X, baseline(n), fonts.regular, TEXT_SIZE));
    y -= height;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: WIDTH - MARGIN, y }, thickness: 0.5, color: LINE });
  }

  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: MARGIN, y: 0.6 * INCH }, end: { x: WIDTH - MARGIN, y: 0.6 * INCH }, thickness: 0.5, color: LINE });
    p.drawText(safe(`${RECEIPT_ORG_NAME}  •  Pending awards  •  ${longDate(now)}`), {
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
