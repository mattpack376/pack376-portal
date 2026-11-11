import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { getSession } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { formatDateOnly } from "@/lib/dateOnly";
import { RANK_INFO } from "@/lib/rankConfig";
import { RECEIPT_ORG_NAME } from "@/lib/receipts";
import { longDate, makeSafe, wrap } from "@/lib/parentsPdf";
import {
  loadAdvancementAudit,
  parseAdvancementAuditFilters,
  type AdvancementAuditFilters,
} from "@/lib/advancementAuditData";
import {
  AUDIT_STATUS_FILTERS,
  DISCREPANCY_LABELS,
  STATUS_LABELS,
  type AdvancementAuditRecord,
} from "@/lib/advancementAuditRules";

/*
 * The CSV and PDF downloads of Audits -> Advancement. Both carry every record
 * the page's current filters match — all pages, not just the one on screen —
 * and are limited to the dens the viewer can see, exactly as the page is.
 */

/** Who's asking, and what they asked for; a status to answer with when they can't have it. */
export async function loadAdvancementAuditExport(searchParams: URLSearchParams) {
  const session = await getSession();
  if (!session) return { status: 401 as const };
  if (session.role !== "ADMIN" && session.role !== "JUNIOR_ADMIN" && session.role !== "DEN") return { status: 403 as const };

  const filters = parseAdvancementAuditFilters(Object.fromEntries(searchParams.entries()));
  const { records } = await loadAdvancementAudit(session, filters);
  return { filters, records };
}

export function advancementAuditFilename(filters: AdvancementAuditFilters, extension: "csv" | "pdf") {
  const status = filters.status === "all" ? "" : `-${filters.status}`;
  return `pack376-advancement-audit-${filters.year}${status}.${extension}`;
}

const date = (iso: string | null) => (iso ? formatDateOnly(iso) : "");

export function buildAdvancementAuditCsv(records: AdvancementAuditRecord[]): string {
  return toCsv([
    [
      "Scout",
      "Den",
      "Rank",
      "Adventure",
      "Type",
      "Completed",
      "Awarded",
      "Entered by",
      "Status",
      "Discrepancies",
      "Audit note",
      "Marked by",
    ],
    ...records.map((r) => [
      r.scoutName,
      r.denName,
      RANK_INFO[r.rank].label,
      r.adventureName,
      r.adventureType === "REQUIRED" ? "Required" : "Elective",
      date(r.completedDate),
      date(r.awardedDate),
      r.enteredBy ?? "",
      STATUS_LABELS[r.status],
      r.discrepancies.map((d) => DISCREPANCY_LABELS[d]).join("; "),
      r.mark?.note ?? "",
      r.mark?.by ?? "",
    ]),
  ]);
}

// ---- PDF: Letter, landscape, one table, headings repeat on every page ----

const INCH = 72;
const WIDTH = 11 * INCH;
const HEIGHT = 8.5 * INCH;
const MARGIN = 0.5 * INCH;
const BOTTOM = 0.75 * INCH;
const CONTENT_WIDTH = WIDTH - 2 * MARGIN;

const BLUE = rgb(0, 0x3f / 255, 0x87 / 255);
const GOLD = rgb(0xf7 / 255, 0xa8 / 255, 0x1b / 255);
const DARK = rgb(0x1a / 255, 0x1a / 255, 0x1a / 255);
const GRAY = rgb(0x55 / 255, 0x55 / 255, 0x55 / 255);
const RED = rgb(0xb3 / 255, 0x26 / 255, 0x1e / 255);
const LINE = rgb(0xdd / 255, 0xdd / 255, 0xdd / 255);
const HEAD_FILL = rgb(0xf4 / 255, 0xf7 / 255, 0xfb / 255);

const TEXT_SIZE = 8.5;
const LEADING = 11;
const PAD_X = 5;
const PAD_Y = 4;
const HEAD_ROW_H = 16;

const COL_LABELS = ["SCOUT / DEN", "ADVENTURE", "COMPLETED", "AWARDED", "ENTERED BY", "STATUS", "DISCREPANCY / NOTE"];
const COL_WIDTHS = [130, 120, 66, 66, 90, 82, CONTENT_WIDTH - 554];
const COL_X = COL_WIDTHS.map((_, i) => MARGIN + COL_WIDTHS.slice(0, i).reduce((sum, w) => sum + w, 0));

export async function buildAdvancementAuditPdf(
  records: AdvancementAuditRecord[],
  filters: AdvancementAuditFilters,
  now: Date = new Date(),
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${RECEIPT_ORG_NAME} Advancement Audit`);
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

  // ---- Heading ----
  draw("Advancement Audit", MARGIN, y - 16, fonts.bold, 16, BLUE);
  const scope = [
    `Season ${filters.year}`,
    AUDIT_STATUS_FILTERS[filters.status],
    filters.rank ? RANK_INFO[filters.rank].label : null,
    filters.from || filters.to ? `Completed ${filters.from ?? "…"} to ${filters.to ?? "…"}` : null,
    filters.q ? `“${filters.q}”` : null,
    `${records.length} record${records.length === 1 ? "" : "s"}`,
    `Generated ${longDate(now)}`,
  ].filter(Boolean);
  draw(scope.join("  •  "), MARGIN, y - 31, fonts.regular, 9, GRAY);
  y -= 40;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: WIDTH - MARGIN, y }, thickness: 2, color: GOLD });
  y -= 12;

  const drawHead = () => {
    page.drawRectangle({ x: MARGIN, y: y - HEAD_ROW_H, width: CONTENT_WIDTH, height: HEAD_ROW_H, color: HEAD_FILL });
    COL_LABELS.forEach((label, i) => draw(label, COL_X[i] + PAD_X, y - 11, fonts.bold, 7, GRAY));
    y -= HEAD_ROW_H;
  };

  if (records.length === 0) {
    draw("No records match.", MARGIN, y - TEXT_SIZE, fonts.italic, TEXT_SIZE + 1, GRAY);
  } else {
    drawHead();
  }

  const fit = (text: string, col: number, font = fonts.regular) =>
    wrap(safe(text), font, TEXT_SIZE, COL_WIDTHS[col] - 2 * PAD_X);

  for (const r of records) {
    const flags = r.discrepancies.map((d) => DISCREPANCY_LABELS[d]).join("; ");
    const note = r.mark ? `Note: ${r.mark.note}${r.mark.by ? ` (${r.mark.by})` : ""}` : "";
    const cells: { lines: string[]; font: PDFFont; color: ReturnType<typeof rgb> }[] = [
      { lines: [...fit(r.scoutName, 0, fonts.bold), ...fit(r.denName, 0)], font: fonts.regular, color: DARK },
      { lines: fit(`${r.adventureName} (${r.adventureType === "REQUIRED" ? "Required" : "Elective"})`, 1), font: fonts.regular, color: DARK },
      { lines: fit(date(r.completedDate) || "—", 2), font: fonts.regular, color: DARK },
      { lines: fit(date(r.awardedDate) || "—", 3), font: fonts.regular, color: DARK },
      { lines: fit(r.enteredBy ?? "—", 4), font: fonts.regular, color: DARK },
      { lines: fit(STATUS_LABELS[r.status], 5, fonts.bold), font: fonts.bold, color: r.status === "FLAGGED" || r.status === "NEEDS_CORRECTION" ? RED : DARK },
      { lines: fit([flags, note].filter(Boolean).join(" — ") || "—", 6), font: fonts.regular, color: flags ? RED : DARK },
    ];
    const height = Math.max(...cells.map((c) => c.lines.length)) * LEADING + 2 * PAD_Y;
    if (y - height < BOTTOM) {
      page = pdf.addPage([WIDTH, HEIGHT]);
      y = HEIGHT - MARGIN;
      drawHead();
    }
    const scoutNameLines = fit(r.scoutName, 0, fonts.bold).length;
    cells.forEach((cell, col) =>
      cell.lines.forEach((line, n) => {
        // The scout's name in bold over the den's.
        const font = col === 0 ? (n < scoutNameLines ? fonts.bold : fonts.regular) : cell.font;
        const color = col === 0 && n >= scoutNameLines ? GRAY : cell.color;
        draw(line, COL_X[col] + PAD_X, y - PAD_Y - TEXT_SIZE * 0.82 - n * LEADING, font, TEXT_SIZE, color);
      }),
    );
    y -= height;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: WIDTH - MARGIN, y }, thickness: 0.5, color: LINE });
  }

  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: MARGIN, y: 0.55 * INCH }, end: { x: WIDTH - MARGIN, y: 0.55 * INCH }, thickness: 0.5, color: LINE });
    p.drawText(safe(`${RECEIPT_ORG_NAME}  •  Advancement audit  •  ${longDate(now)}`), {
      x: MARGIN,
      y: 0.38 * INCH,
      font: fonts.regular,
      size: 8,
      color: GRAY,
    });
    const right = `Page ${i + 1} of ${pages.length}`;
    p.drawText(right, {
      x: WIDTH - MARGIN - fonts.regular.widthOfTextAtSize(right, 8),
      y: 0.38 * INCH,
      font: fonts.regular,
      size: 8,
      color: GRAY,
    });
  });

  return pdf.save();
}
