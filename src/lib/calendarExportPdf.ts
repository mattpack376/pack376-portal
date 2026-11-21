import "server-only";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import {
  CHIP_STYLE,
  EXPORT_COLORS as C,
  EXPORT_DISCLAIMER,
  EXPORT_SITE,
  LEGEND,
  WEEKDAYS,
  exportLongDate,
  fitText,
  layoutMonth,
  miniMonth,
  wrapText,
  yearOverview,
  type ChipKind,
  type DetailItem,
  type ExportCalendar,
  type ExportScope,
  type Measure,
  type MonthLayout,
} from "@/lib/calendarExport";
import { loadExportFonts, type ExportFontName } from "@/lib/calendarExportFonts";
import { RECEIPT_EMBLEM_PNG_BASE64 } from "@/lib/receiptEmblem";

/*
 * The calendar as a PDF: US Letter, landscape. A month is one page (plus a
 * continuation page in the rare month whose events don't fit under the grid);
 * the full calendar is a Year at a Glance cover and then every month in order.
 * What goes where is decided by calendarExport.ts; this file only draws it.
 * The text stays real, selectable text in the site's fonts.
 *
 * Measurements are in points and, unlike PDF's own bottom-up y, every `top`
 * here counts down from the top of the page — see Pen.
 */

const W = 11 * 72;
const H = 8.5 * 72;
const M = 30;
const CW = W - 2 * M;

const LEGEND_TOP = 578;
const CONTENT_BOTTOM = 570;

const GRID_TOP = 100;
const GRID_H = 312;
const DOW_H = 16;
const CHIP_TOP = 14;
const CHIP_H = 10;
const CHIP_PITCH = 11.5;

const DETAIL_COLS = 3;
const DETAIL_GAP = 14;

/** The fonts this file draws with (no Baloo 2 Bold: ExtraBold covers every heading). */
const PDF_FONTS = ["display", "body", "bodySemi", "bodyBold"] as const satisfies readonly ExportFontName[];
type PdfFontName = (typeof PDF_FONTS)[number];
type Fonts = Record<PdfFontName, PDFFont>;

function hex(color: string) {
  const n = Number.parseInt(color.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** A rounded rectangle as an SVG path (y down), with square corners on a side that continues. */
function roundedRect(w: number, h: number, r: number, squareLeft = false, squareRight = false) {
  const rl = squareLeft ? 0 : Math.min(r, h / 2, w / 2);
  const rr = squareRight ? 0 : Math.min(r, h / 2, w / 2);
  return [
    `M ${rl} 0`,
    `H ${w - rr}`,
    rr ? `Q ${w} 0 ${w} ${rr}` : "",
    `V ${h - rr}`,
    rr ? `Q ${w} ${h} ${w - rr} ${h}` : "",
    `H ${rl}`,
    rl ? `Q 0 ${h} 0 ${h - rl}` : "",
    `V ${rl}`,
    rl ? `Q 0 0 ${rl} 0` : "",
    "Z",
  ].join(" ");
}

/** Draws on one page with `top` measured down from the top edge. */
class Pen {
  constructor(
    readonly page: PDFPage,
    readonly fonts: Fonts,
    private readonly safe: Record<PdfFontName, (text: string) => string>,
  ) {}

  measure(font: PdfFontName): Measure {
    return (text, size) => this.fonts[font].widthOfTextAtSize(this.safe[font](text), size);
  }

  text(text: string, x: number, baseline: number, size: number, font: PdfFontName, color: string, align: "left" | "right" | "center" = "left") {
    const clean = this.safe[font](text);
    if (!clean) return 0;
    const width = this.fonts[font].widthOfTextAtSize(clean, size);
    const left = align === "right" ? x - width : align === "center" ? x - width / 2 : x;
    this.page.drawText(clean, { x: left, y: H - baseline, size, font: this.fonts[font], color: hex(color) });
    return width;
  }

  rect(x: number, top: number, w: number, h: number, fill?: string, border?: string, borderWidth = 0.6) {
    this.page.drawRectangle({
      x,
      y: H - top - h,
      width: w,
      height: h,
      color: fill ? hex(fill) : undefined,
      borderColor: border ? hex(border) : undefined,
      borderWidth: border ? borderWidth : 0,
    });
  }

  round(
    x: number,
    top: number,
    w: number,
    h: number,
    r: number,
    opts: { fill?: string; border?: string; borderWidth?: number; dashed?: boolean; squareLeft?: boolean; squareRight?: boolean },
  ) {
    this.page.drawSvgPath(roundedRect(w, h, r, opts.squareLeft, opts.squareRight), {
      x,
      y: H - top,
      color: opts.fill ? hex(opts.fill) : undefined,
      borderColor: opts.border ? hex(opts.border) : undefined,
      borderWidth: opts.border ? (opts.borderWidth ?? 0.6) : 0,
      borderDashArray: opts.dashed ? [1.6, 1.2] : undefined,
    });
  }

  line(x1: number, top1: number, x2: number, top2: number, color: string, thickness = 0.6) {
    this.page.drawLine({ start: { x: x1, y: H - top1 }, end: { x: x2, y: H - top2 }, color: hex(color), thickness });
  }
}

interface Doc {
  pdf: PDFDocument;
  fonts: Fonts;
  safe: Record<PdfFontName, (text: string) => string>;
  emblem: PDFImage;
  cal: ExportCalendar;
}

function newPage(doc: Doc) {
  const page = doc.pdf.addPage([W, H]);
  return new Pen(page, doc.fonts, doc.safe);
}

// ---------------------------------------------------------------------------
// Page furniture
// ---------------------------------------------------------------------------

function header(doc: Doc, pen: Pen, eyebrow: string, title: string, right: string) {
  pen.rect(0, 0, W, 62, C.blue);
  pen.page.drawImage(doc.emblem, { x: M, y: H - 54, width: 46, height: 46 });
  pen.text(eyebrow, M + 56, 25, 9, "display", C.gold);
  pen.text(title, M + 56, 52, 25, "display", C.white);
  pen.text(right, W - M, 31, 12, "display", C.white, "right");
  pen.text(EXPORT_SITE, W - M, 46, 9, "display", C.gold, "right");
  // A boardwalk awning: carnival red and white, with a gold edge under it.
  const stripe = 16;
  for (let i = 0, x = 0; x < W; i++, x += stripe) pen.rect(x, 62, stripe, 8, i % 2 ? C.white : C.red);
  pen.rect(0, 70, W, 3, C.gold);
}

function swatch(pen: Pen, kind: ChipKind, x: number, top: number, w: number, h: number) {
  const style = CHIP_STYLE[kind];
  pen.round(x, top, w, h, 1.5, { fill: style.bg, border: style.border ?? (style.bg === C.white ? C.blue : undefined) });
}

function legendAndFooter(doc: Doc, pen: Pen) {
  let x = M;
  x += pen.text("KEY", x, LEGEND_TOP + 7.5, 7.5, "display", C.blueDark) + 10;
  for (const item of LEGEND) {
    swatch(pen, item.kind, x, LEGEND_TOP + 1.5, 11, 7);
    x += 15 + pen.text(item.label, x + 15, LEGEND_TOP + 7.5, 7, "body", C.inkSoft) + 14;
  }
  pen.line(M, 592, W - M, 592, C.line);
  pen.text(`${EXPORT_SITE} · Updated ${exportLongDate(doc.cal.generatedOn)}`, M, 604, 7.5, "bodySemi", C.blueDark);
  pen.text(EXPORT_DISCLAIMER, W - M, 604, 7.5, "body", C.inkSoft, "right");
}

// ---------------------------------------------------------------------------
// A month
// ---------------------------------------------------------------------------

function grid(pen: Pen, layout: MonthLayout) {
  const cellW = CW / 7;
  const rowH = GRID_H / layout.weeks.length;
  const colX = (c: number) => M + c * cellW;

  pen.rect(M, GRID_TOP - DOW_H, CW, DOW_H, C.creamDark);
  WEEKDAYS.forEach((d, c) => pen.text(d.toUpperCase(), colX(c) + cellW / 2, GRID_TOP - 4.5, 8.5, "display", C.blueDark, "center"));

  const chipMeasure = pen.measure("bodySemi");
  layout.weeks.forEach((week, r) => {
    const top = GRID_TOP + r * rowH;
    week.days.forEach((day, c) => {
      pen.rect(colX(c), top, cellW, rowH, !day.inMonth ? C.outside : day.noMeeting ? "#f1eee6" : C.white);
      pen.text(String(day.day), colX(c) + 4, top + 10.5, 9.5, "display", day.inMonth ? C.blueDark : "#bdb394");
    });
  });

  // Grid lines over the cell fills and under the event bars, so a trip's bar
  // reads as one piece across the days it covers.
  for (let c = 0; c <= 7; c++) pen.line(colX(c), GRID_TOP - DOW_H, colX(c), GRID_TOP + GRID_H, C.line);
  for (let r = 0; r <= layout.weeks.length; r++) pen.line(M, GRID_TOP + r * rowH, W - M, GRID_TOP + r * rowH, C.line);
  pen.line(M, GRID_TOP - DOW_H, W - M, GRID_TOP - DOW_H, C.line);

  layout.weeks.forEach((week, r) => {
    const top = GRID_TOP + r * rowH;
    for (const chip of week.chips) {
      const style = CHIP_STYLE[chip.kind];
      const left = colX(chip.startCol) + (chip.continuesBefore ? 0 : 2);
      const right = colX(chip.endCol + 1) - (chip.continuesAfter ? 0 : 2);
      const chipTop = top + CHIP_TOP + chip.slot * CHIP_PITCH;
      const border = chip.important
        ? chip.kind === "pack-night" ? C.redDark : C.goldDark
        : chip.either ? style.fg : style.border;
      pen.round(left, chipTop, right - left, CHIP_H, 2.5, {
        fill: style.bg,
        border,
        borderWidth: chip.important ? 1.3 : chip.either ? 0.7 : 0.6,
        dashed: chip.either && !chip.important,
        squareLeft: chip.continuesBefore,
        squareRight: chip.continuesAfter,
      });
      const label = fitText(chip.text, chipMeasure, 6.4, right - left - 6);
      pen.text(label, left + 3, chipTop + 7.1, 6.4, "bodySemi", style.fg);
    }
    week.more.forEach((n, c) => {
      if (!n) return;
      const slotTop = top + CHIP_TOP + (maxSlotsFor(layout.weeks.length) - 1) * CHIP_PITCH;
      pen.text(`+${n} more, see below`, colX(c) + 4, slotTop + 7.1, 6.2, "bodySemi", C.inkSoft);
    });
  });
}

function maxSlotsFor(weeks: number) {
  return Math.max(1, Math.floor((GRID_H / weeks - CHIP_TOP - 1) / CHIP_PITCH));
}

interface PlacedDetail {
  item: DetailItem;
  titleLines: string[];
  detailLines: string[];
  height: number;
}

const DETAIL_TEXT_X = 10;

function measureDetail(pen: Pen, item: DetailItem, width: number): PlacedDetail {
  const textW = width - DETAIL_TEXT_X;
  const titleLines = wrapText(item.title, pen.measure(item.important ? "bodyBold" : "bodySemi"), 8, textW, 2);
  const detailLines = item.detail ? wrapText(item.detail, pen.measure("body"), 7, textW, 2) : [];
  return { item, titleLines, detailLines, height: 9.5 + titleLines.length * 9.6 + detailLines.length * 8.6 + 6 };
}

function drawDetail(pen: Pen, d: PlacedDetail, x: number, top: number, width: number) {
  swatch(pen, d.item.kind, x, top + 1.5, 6.5, 6.5);
  const tx = x + DETAIL_TEXT_X;
  let used = pen.text(d.item.when, tx, top + 7.5, 7.8, "display", C.blueDark);
  if (d.item.tags.length) {
    const tags = fitText(` · ${d.item.tags.join(" · ")}`, pen.measure("bodySemi"), 6.6, width - DETAIL_TEXT_X - used);
    used += pen.text(tags, tx + used, top + 7.5, 6.6, "bodySemi", C.redDark);
  }
  let baseline = top + 9.5 + 7.6;
  for (const line of d.titleLines) {
    pen.text(line, tx, baseline, 8, d.item.important ? "bodyBold" : "bodySemi", d.item.kind === "fundraiser" ? C.redDark : C.ink);
    baseline += 9.6;
  }
  baseline -= 1;
  for (const line of d.detailLines) {
    pen.text(line, tx, baseline, 7, "body", C.inkSoft);
    baseline += 8.6;
  }
}

/** How many columns the items take when each column may run down to `bottom`. */
function columnsNeeded(items: PlacedDetail[], top: number, bottom: number) {
  let cols = 1;
  let y = top;
  for (const item of items) {
    if (y + item.height > bottom && y > top) {
      cols++;
      y = top;
    }
    y += item.height;
  }
  return cols;
}

/**
 * Lays the details out in columns from `top`; returns what didn't fit. A short
 * list is spread evenly over the columns rather than filling the first one
 * and leaving the others empty.
 */
function details(pen: Pen, items: PlacedDetail[], top: number, colW: number): PlacedDetail[] {
  let bottom = CONTENT_BOTTOM;
  if (columnsNeeded(items, top, CONTENT_BOTTOM) <= DETAIL_COLS) {
    const total = items.reduce((sum, d) => sum + d.height, 0);
    bottom = top + Math.ceil(total / DETAIL_COLS);
    while (bottom < CONTENT_BOTTOM && columnsNeeded(items, top, bottom) > DETAIL_COLS) bottom += 2;
    bottom = Math.min(bottom, CONTENT_BOTTOM);
  }
  let col = 0;
  let y = top;
  let i = 0;
  for (; i < items.length; i++) {
    if (y + items[i].height > bottom && y > top) {
      col++;
      y = top;
      if (col === DETAIL_COLS) break;
    }
    drawDetail(pen, items[i], M + col * (colW + DETAIL_GAP), y, colW);
    y += items[i].height;
  }
  return items.slice(i);
}

function monthPages(doc: Doc, month: string) {
  const weeks = layoutMonth(doc.cal, month, 99).weeks.length;
  const layout = layoutMonth(doc.cal, month, maxSlotsFor(weeks));
  const right = `${doc.cal.yearLabel} Scouting Year`;

  const pen = newPage(doc);
  header(doc, pen, "PACK 376 · CALENDAR OF EVENTS", layout.title, right);
  grid(pen, layout);

  const colW = (CW - (DETAIL_COLS - 1) * DETAIL_GAP) / DETAIL_COLS;
  const top = GRID_TOP + GRID_H + 10;
  let x = M + pen.text("THIS MONTH", M, top + 10, 10.5, "display", C.blue) + 12;
  if (layout.meetings) {
    const m = layout.meetings;
    const text = [m.title, m.when, m.detail].filter(Boolean).join(" · ");
    const w = pen.measure("bodySemi")(text, 7.5) + 14;
    pen.round(x, top + 1.5, w, 11, 5.5, { fill: CHIP_STYLE.meeting.bg });
    pen.text(text, x + 7, top + 9.4, 7.5, "bodySemi", C.blueDark);
    x += w;
  }
  const placed = layout.details.map((item) => measureDetail(pen, item, colW));
  if (placed.length === 0) {
    pen.text("No special pack events scheduled this month.", M, top + 30, 8.5, "body", C.inkSoft);
  }
  let left = details(pen, placed, top + 18, colW);
  legendAndFooter(doc, pen);

  while (left.length) {
    const more = newPage(doc);
    header(doc, more, "PACK 376 · CALENDAR OF EVENTS", `${layout.title} (continued)`, right);
    more.text("THIS MONTH (CONTINUED)", M, 96, 10.5, "display", C.blue);
    const before = left.length;
    left = details(more, left, 106, colW);
    legendAndFooter(doc, more);
    if (left.length === before) break; // can't happen (one item always fits a column); never loop forever
  }
}

// ---------------------------------------------------------------------------
// The full calendar's cover
// ---------------------------------------------------------------------------

/** Pills in rows; returns the height used. */
function pillRows(pen: Pen, labels: string[], x0: number, top: number, maxX: number, fill: string, ink: string, draw: boolean) {
  const measure = pen.measure("bodySemi");
  let x = x0;
  let y = top;
  for (const label of labels) {
    const w = measure(label, 7.8) + 12;
    if (x + w > maxX && x > x0) {
      x = x0;
      y += 15;
    }
    if (draw) {
      pen.round(x, y, w, 12, 6, { fill });
      pen.text(label, x + 6, y + 8.6, 7.8, "bodySemi", ink);
    }
    x += w + 5;
  }
  return labels.length ? y - top + 12 : 0;
}

function ribbon(pen: Pen, top: number, kind: ChipKind, title: string, note: string, labels: string[], tint: string, ink: string, draw: boolean) {
  const labelW = 132;
  const height = Math.max(30, pillRows(pen, labels, M + labelW + 12, top + 9, W - M - 8, tint, ink, false) + 18);
  if (!draw) return height;
  pen.round(M, top, CW, height, 6, { fill: C.white, border: C.line });
  pen.round(M, top, labelW, height, 6, { fill: CHIP_STYLE[kind].bg, squareRight: true });
  pen.text(title, M + 10, top + 14, 10.5, "display", CHIP_STYLE[kind].fg);
  pen.text(note, M + 10, top + 24, 7, "bodySemi", CHIP_STYLE[kind].fg);
  pillRows(pen, labels, M + labelW + 12, top + 9, W - M - 8, tint, ink, true);
  return height;
}

/**
 * Every month as a small grid, each event day filled in its color (the same
 * picture as the PNG poster), in the room left at the bottom of the cover.
 * Skipped when a long Year at a Glance leaves too little room to read it.
 */
function miniMonths(doc: Doc, pen: Pen, top: number, bottom: number) {
  const perRow = 6;
  const gap = 10;
  const rows = Math.ceil(doc.cal.months.length / perRow);
  const heading = 16;
  const miniW = (CW - (perRow - 1) * gap) / perRow;
  const cell = miniW / 7;
  // Title + weekday letters + 6 weeks + padding per little month.
  const rowH = Math.min(13, (bottom - top - heading - rows * (14 + 10 + 6) - (rows - 1) * gap) / (rows * 6));
  if (rowH < 9) return;
  const miniH = 14 + 10 + 6 * rowH + 6;
  pen.text("MONTH BY MONTH", M, top + 10, 10.5, "display", C.blue);

  doc.cal.months.forEach((month, i) => {
    const x = M + (i % perRow) * (miniW + gap);
    const y = top + heading + Math.floor(i / perRow) * (miniH + gap);
    const mini = miniMonth(doc.cal, month);
    pen.round(x, y, miniW, miniH, 5, { fill: C.white, border: C.line });
    pen.text(mini.title, x + 5, y + 11, 8.5, "display", C.blue);
    WEEKDAYS.forEach((d, c) => pen.text(d[0], x + c * cell + cell / 2, y + 21, 5.5, "bodySemi", C.inkSoft, "center"));
    mini.weeks.forEach((week, r) =>
      week.forEach((day, c) => {
        if (day.day === null) return;
        const kind: ChipKind | null = day.kind ?? (day.meeting ? "meeting" : null);
        const cx = x + c * cell;
        const cy = y + 24 + r * rowH;
        if (kind) {
          const style = CHIP_STYLE[kind];
          pen.round(cx + 1, cy + 0.5, cell - 2, rowH - 1, 2, {
            fill: style.bg,
            border: day.important ? (kind === "pack-night" ? C.redDark : C.goldDark) : style.border,
            borderWidth: day.important ? 1 : 0.5,
          });
        }
        pen.text(String(day.day), cx + cell / 2, cy + rowH / 2 + 2.2, 6, "display", kind ? CHIP_STYLE[kind].fg : C.ink, "center");
      }),
    );
  });
}

function coverPage(doc: Doc) {
  const overview = yearOverview(doc.cal);
  const pen = newPage(doc);
  header(doc, pen, "PACK 376 · YEAR AT A GLANCE", `${doc.cal.yearLabel} Calendar of Events`, "Cub Scout Pack 376 · Brooklyn");
  pen.text(
    "The year's camping trips, pack nights, one-day events and fundraisers. A page for each month follows.",
    M,
    92,
    8.5,
    "body",
    C.inkSoft,
  );

  // The ribbons go under the cards; measure them first so the cards know how tall they may be.
  const ribbons: [ChipKind, string, string, string[], string, string][] = [];
  if (overview.scoutSundays.length) ribbons.push(["scout-sunday", "Scout Sundays", "10 AM Mass", overview.scoutSundays, "#ede4f8", "#4a2a7a"]);
  if (overview.noMeetings.length) ribbons.push(["no-meeting", "No Meetings", "No scout meeting these days", overview.noMeetings, "#efece3", "#4a463c"]);
  const ribbonHeights = ribbons.map((r) => ribbon(pen, 0, ...r, false));
  const meetingH = overview.meetings ? 22 : 0;
  const below = ribbonHeights.reduce((sum, h) => sum + h + 8, 0) + (meetingH ? meetingH + 8 : 0);
  const cardsTop = 102;
  const cardsMaxBottom = CONTENT_BOTTOM - below - 4;

  const groups = overview.glance;
  let cardsBottom = cardsTop;
  if (groups.length) {
    const gap = 12;
    const cardW = (CW - (groups.length - 1) * gap) / groups.length;
    const labelMeasure = pen.measure("bodySemi");
    const whenMeasure = pen.measure("display");
    const laid = groups.map((g) => {
      const rows = g.items.map((item) => {
        const when = fitText(item.when, whenMeasure, 8.5, cardW * 0.42);
        const whenW = whenMeasure(when, 8.5);
        const lines = wrapText(item.label, labelMeasure, 8.5, cardW - 18 - whenW - 6, 2);
        return { when, lines, h: lines.length * 10.4 + 5 };
      });
      return { g, rows };
    });
    const tallest = Math.max(...laid.map((l) => 30 + l.rows.reduce((s, r) => s + r.h, 0) + 4));
    const cardH = Math.min(tallest, cardsMaxBottom - cardsTop);
    laid.forEach(({ g, rows }, i) => {
      const x = M + i * (cardW + gap);
      const style = CHIP_STYLE[g.category];
      pen.round(x, cardsTop, cardW, cardH, 7, { fill: C.white, border: C.line });
      pen.round(x, cardsTop, cardW, 22, 7, { fill: style.bg, border: style.border });
      pen.rect(x + 0.3, cardsTop + 14, cardW - 0.6, 8, style.bg);
      pen.text(g.title, x + 9, cardsTop + 15, 11, "display", style.fg);
      let y = cardsTop + 30;
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        // Room for this row, and for the "+N more" line if rows remain after it.
        if (y + row.h > cardsTop + cardH - (r < rows.length - 1 ? 14 : 0)) {
          pen.text(`+${rows.length - r} more on the month pages`, x + 9, y + 7.5, 7.5, "bodySemi", C.inkSoft);
          break;
        }
        row.lines.forEach((line, li) => pen.text(line, x + 9, y + 7.5 + li * 10.4, 8.5, "bodySemi", C.ink));
        pen.text(row.when, x + cardW - 9, y + 7.5, 8.5, "display", C.blueDark, "right");
        y += row.h;
      }
    });
    cardsBottom = cardsTop + cardH;
  }

  let y = cardsBottom + 12;
  ribbons.forEach((r) => {
    y += ribbon(pen, y, ...r, true) + 8;
  });
  if (overview.meetings) {
    const m = overview.meetings;
    pen.round(M, y, CW, meetingH, 6, { fill: CHIP_STYLE.meeting.bg });
    let x = M + 10;
    x += pen.text(m.title, x, y + 14.5, 10.5, "display", C.blueDark) + 10;
    pen.text(
      [m.when, m.detail, "Not held on camping weekends or No Meeting nights"].filter(Boolean).join(" · "),
      x,
      y + 14,
      8,
      "bodySemi",
      C.blueDark,
    );
    y += meetingH + 12;
  }
  miniMonths(doc, pen, y, CONTENT_BOTTOM);
  legendAndFooter(doc, pen);
}

// ---------------------------------------------------------------------------

export async function buildCalendarPdf(cal: ExportCalendar, scope: ExportScope): Promise<Uint8Array> {
  const files = await loadExportFonts();
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  // Subset: only the letters used go in the file. (Baloo 2 is the Latin-only
  // cut in src/assets/fonts — the full font lost most of its letters here.)
  const fonts = Object.fromEntries(
    await Promise.all(PDF_FONTS.map(async (name) => [name, await pdf.embedFont(files[name], { subset: true })] as const)),
  ) as Fonts;
  const safe = Object.fromEntries(
    PDF_FONTS.map((name) => {
      const supported = new Set(fonts[name].getCharacterSet());
      return [name, (text: string) => Array.from(text).filter((ch) => supported.has(ch.codePointAt(0)!)).join("")];
    }),
  ) as Doc["safe"];
  const emblem = await pdf.embedPng(Uint8Array.from(Buffer.from(RECEIPT_EMBLEM_PNG_BASE64, "base64")));
  const doc: Doc = { pdf, fonts, safe, emblem, cal };

  const title = scope === "full" ? `${cal.yearLabel} Calendar of Events` : `Calendar of Events: ${layoutMonth(cal, scope, 1).title}`;
  pdf.setTitle(`Pack 376 ${title}`);
  pdf.setAuthor("Cub Scout Pack 376");
  pdf.setSubject(`Pack 376 ${title}, from ${EXPORT_SITE}`);
  pdf.setCreator(EXPORT_SITE);
  pdf.setProducer(EXPORT_SITE);

  if (scope === "full") {
    coverPage(doc);
    for (const month of cal.months) monthPages(doc, month);
  } else {
    monthPages(doc, scope);
  }
  return pdf.save();
}
