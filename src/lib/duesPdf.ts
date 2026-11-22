import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { RECEIPT_EMBLEM_PNG_BASE64 } from "@/lib/receiptEmblem";
import { RECEIPT_ORG_NAME } from "@/lib/receipts";
import { toDateOnlyString } from "@/lib/dateOnly";
import { formatCents } from "@/lib/duesData";
import { longDate, makeSafe, wrap } from "@/lib/parentsPdf";
import type { DuesExport, DuesExportDen, DuesExportScout } from "@/lib/duesExportModel";

/*
 * The dues tracker as a PDF: Letter, portrait, laid out like the parent
 * contact and photo consent PDFs. The page's three totals at the top, then a
 * table per den (title bar and column headings repeat when a den runs onto
 * another page, a den never starts with only its heading at the foot of a
 * page) ending in a den subtotal, and a grand total at the end. Status is
 * colored the way the page colors it.
 */

const INCH = 72;
const WIDTH = 8.5 * INCH;
const HEIGHT = 11 * INCH;
const MARGIN = 0.6 * INCH;
const BOTTOM = 0.85 * INCH; // content stops here; the footer lives below it
const CONTENT_WIDTH = WIDTH - 2 * MARGIN;

const BLUE = rgb(0, 0x3f / 255, 0x87 / 255);
const GOLD = rgb(0xf7 / 255, 0xa8 / 255, 0x1b / 255);
const DARK = rgb(0x1a / 255, 0x1a / 255, 0x1a / 255);
const GRAY = rgb(0x55 / 255, 0x55 / 255, 0x55 / 255);
const GREEN = rgb(0x1b / 255, 0x7a / 255, 0x3a / 255);
const AMBER = rgb(0x9a / 255, 0x67 / 255, 0x00);
const RED = rgb(0xb3 / 255, 0x26 / 255, 0x1e / 255);
const LINE = rgb(0xdd / 255, 0xdd / 255, 0xdd / 255);
const HEAD_FILL = rgb(0xf4 / 255, 0xf7 / 255, 0xfb / 255);
const WHITE = rgb(1, 1, 1);

const TEXT_SIZE = 9.5;
const LEADING = 12;
const PAD_X = 6;
const PAD_Y = 4;
const TITLE_BAR_H = 22;
const HEAD_ROW_H = 17;
const TOTAL_ROW_H = 20;
const DEN_GAP = 16;

const COL_LABELS = ["SCOUT", "DUE", "PAID", "REMAINING", "STATUS", "LAST PAID"];
const COL_WIDTHS = [170, 72, 72, 78, 72, CONTENT_WIDTH - 464];
const COL_X = COL_WIDTHS.map((_, i) => MARGIN + COL_WIDTHS.slice(0, i).reduce((sum, w) => sum + w, 0));
/** Money columns are right-aligned to read down like a ledger. */
const RIGHT = new Set([1, 2, 3]);

type Fonts = { regular: PDFFont; bold: PDFFont; italic: PDFFont };
type Row = { cells: string[][]; height: number };

function statusColor(status: string) {
  if (status === "Paid in Full" || status === "Overpaid") return GREEN;
  if (status === "Partial") return AMBER;
  if (status === "Unpaid") return RED;
  return GRAY;
}

const money = (cents: number | null) => (cents === null ? "—" : formatCents(cents));

/** 2026-11-21 → 11/21/2026: narrow enough for its column. */
function shortDate(date: Date) {
  const [y, m, d] = toDateOnlyString(date).split("-");
  return `${Number(m)}/${Number(d)}/${y}`;
}

export async function buildDuesPdf(data: DuesExport, opts: { now?: Date } = {}): Promise<Uint8Array> {
  const now = opts.now ?? new Date();

  const pdf = await PDFDocument.create();
  pdf.setTitle(`${RECEIPT_ORG_NAME} Dues ${data.scoutingYear}`);
  pdf.setAuthor(RECEIPT_ORG_NAME);
  pdf.setCreator(RECEIPT_ORG_NAME);

  const fonts: Fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
  };
  const safe = makeSafe(fonts.regular);
  const emblem = await pdf.embedPng(Buffer.from(RECEIPT_EMBLEM_PNG_BASE64, "base64"));

  let page: PDFPage = pdf.addPage([WIDTH, HEIGHT]);
  let y = HEIGHT - MARGIN;

  const draw = (
    value: string,
    x: number,
    baseline: number,
    font: PDFFont,
    size: number,
    color = DARK,
    align: "left" | "right" = "left"
  ) => {
    const s = safe(value);
    const left = align === "right" ? x - font.widthOfTextAtSize(s, size) : x;
    page.drawText(s, { x: left, y: baseline, font, size, color });
  };

  // ---- Heading, first page only ----
  const logo = 40;
  page.drawImage(emblem, { x: MARGIN, y: y - logo, width: logo, height: logo });
  draw(`Dues Tracking — ${data.scoutingYear}`, MARGIN + logo + 12, y - 17, fonts.bold, 17, BLUE);
  const fee = data.amountCents === null ? "Season fee not set" : `Season fee ${formatCents(data.amountCents)} per scout`;
  draw(
    `${fee}  •  ${data.scoutCount} scout${data.scoutCount === 1 ? "" : "s"}  •  Generated ${longDate(now)}`,
    MARGIN + logo + 12,
    y - 33,
    fonts.regular,
    9.5,
    GRAY
  );
  y -= logo + 8;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: WIDTH - MARGIN, y }, thickness: 2, color: GOLD });
  y -= 14;

  // ---- The page's three cards ----
  const cards: [string, string, string][] = [
    ["TOTAL DUES TO BE COLLECTED", money(data.totalDueCents), data.amountCents === null ? "Fee not set" : ""],
    ["COLLECTED SO FAR", formatCents(data.collectedCents), `${data.payments.length} payment${data.payments.length === 1 ? "" : "s"}`],
    ["REMAINING", money(data.remainingCents), data.amountCents === null ? "Fee not set" : ""],
  ];
  const cardGap = 10;
  const cardW = (CONTENT_WIDTH - 2 * cardGap) / 3;
  const cardH = 54;
  cards.forEach(([label, value, note], i) => {
    const x = MARGIN + i * (cardW + cardGap);
    page.drawRectangle({ x, y: y - cardH, width: cardW, height: cardH, color: HEAD_FILL, borderColor: LINE, borderWidth: 0.5 });
    draw(label, x + 10, y - 14, fonts.bold, 7.5, GRAY);
    draw(value, x + 10, y - 34, fonts.bold, 16, BLUE);
    if (note) draw(note, x + 10, y - 47, fonts.regular, 8, GRAY);
  });
  y -= cardH + 8;
  draw("* custom rate (sibling discount, etc.)", MARGIN, y - 8, fonts.italic, 8, GRAY);
  y -= 20;

  if (data.dens.length === 0) {
    draw("No dens for this scouting year.", MARGIN, y - TEXT_SIZE, fonts.italic, TEXT_SIZE + 1, GRAY);
  }

  // ---- Layout of one scout's row ----
  const layoutScout = (scout: DuesExportScout): Row => {
    // Sanitized before it's measured: widthOfTextAtSize throws on a character the font can't encode.
    const fit = (text: string, col: number, font = fonts.regular) =>
      wrap(safe(text), font, TEXT_SIZE, COL_WIDTHS[col] - 2 * PAD_X);
    const name = `${scout.firstName} ${scout.lastName}`.trim();
    const cells = [
      fit(scout.active ? name : `${name} (inactive)`, 0, fonts.bold),
      [`${money(scout.dueCents)}${scout.isOverridden ? "*" : ""}`],
      [formatCents(scout.paidCents)],
      [money(scout.remainingCents)],
      fit(scout.status, 4, fonts.bold),
      [scout.lastPaidOn ? shortDate(scout.lastPaidOn) : "—"],
    ];
    return { cells, height: Math.max(...cells.map((lines) => lines.length)) * LEADING + 2 * PAD_Y };
  };

  const newPage = () => {
    page = pdf.addPage([WIDTH, HEIGHT]);
    y = HEIGHT - MARGIN;
  };

  const drawDenHeader = (den: DuesExportDen, continued: boolean) => {
    page.drawRectangle({ x: MARGIN, y: y - TITLE_BAR_H, width: CONTENT_WIDTH, height: TITLE_BAR_H, color: BLUE });
    draw(continued ? `${den.name} (continued)` : den.name, MARGIN + PAD_X + 2, y - 15, fonts.bold, 11, WHITE);
    draw(
      `${den.scouts.length} scout${den.scouts.length === 1 ? "" : "s"}`,
      WIDTH - MARGIN - PAD_X - 2,
      y - 15,
      fonts.regular,
      9,
      WHITE,
      "right"
    );
    y -= TITLE_BAR_H;
    if (den.scouts.length === 0) return;
    page.drawRectangle({ x: MARGIN, y: y - HEAD_ROW_H, width: CONTENT_WIDTH, height: HEAD_ROW_H, color: HEAD_FILL });
    COL_LABELS.forEach((label, i) =>
      RIGHT.has(i)
        ? draw(label, COL_X[i] + COL_WIDTHS[i] - PAD_X, y - 12, fonts.bold, 7.5, GRAY, "right")
        : draw(label, COL_X[i] + PAD_X, y - 12, fonts.bold, 7.5, GRAY)
    );
    y -= HEAD_ROW_H;
  };

  const drawScout = (scout: DuesExportScout, row: Row) => {
    row.cells.forEach((lines, col) => {
      const font = col === 0 || col === 4 ? fonts.bold : fonts.regular;
      const color = col === 4 ? statusColor(scout.status) : col === 0 && !scout.active ? GRAY : DARK;
      lines.forEach((text, n) => {
        const baseline = y - PAD_Y - TEXT_SIZE * 0.82 - n * LEADING;
        if (RIGHT.has(col)) draw(text, COL_X[col] + COL_WIDTHS[col] - PAD_X, baseline, font, TEXT_SIZE, color, "right");
        else draw(text, COL_X[col] + PAD_X, baseline, font, TEXT_SIZE, color);
      });
    });
    y -= row.height;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: WIDTH - MARGIN, y }, thickness: 0.5, color: LINE });
  };

  /** A bold Due / Paid / Remaining line: a den's subtotal or the grand total. */
  const drawTotal = (label: string, due: number | null, paid: number, remaining: number | null, fill = HEAD_FILL) => {
    page.drawRectangle({ x: MARGIN, y: y - TOTAL_ROW_H, width: CONTENT_WIDTH, height: TOTAL_ROW_H, color: fill });
    const baseline = y - 13.5;
    draw(label, COL_X[0] + PAD_X, baseline, fonts.bold, TEXT_SIZE, DARK);
    [due, paid, remaining].forEach((cents, i) =>
      draw(money(cents), COL_X[i + 1] + COL_WIDTHS[i + 1] - PAD_X, baseline, fonts.bold, TEXT_SIZE, DARK, "right")
    );
    y -= TOTAL_ROW_H;
  };

  // ---- Dens ----
  for (const [index, den] of data.dens.entries()) {
    const rows = den.scouts.map(layoutScout);
    if (index > 0) y -= DEN_GAP;

    // A den's last scout stays on the page with its subtotal, and after the
    // last den with the grand total too, so neither total sits alone on a page.
    const grand = index === data.dens.length - 1 ? DEN_GAP + TOTAL_ROW_H : 0;
    const tail = (i: number) => (i === rows.length - 1 ? TOTAL_ROW_H + grand : 0);

    // A den never starts where its title, headings and first scout (or its "no scouts" line) won't all fit.
    const firstBlock = rows.length ? HEAD_ROW_H + rows[0].height + tail(0) : 20 + grand;
    if (y - (TITLE_BAR_H + firstBlock) < BOTTOM) newPage();
    drawDenHeader(den, false);

    if (rows.length === 0) {
      draw("No scouts in this den yet.", MARGIN + PAD_X, y - 14, fonts.italic, TEXT_SIZE, GRAY);
      y -= 20;
      continue;
    }

    for (const [i, scout] of den.scouts.entries()) {
      if (y - rows[i].height - tail(i) < BOTTOM) {
        newPage();
        drawDenHeader(den, true);
      }
      drawScout(scout, rows[i]);
    }
    if (y - TOTAL_ROW_H < BOTTOM) {
      newPage();
      drawDenHeader(den, true);
    }
    drawTotal(`${den.name} total`, den.dueCents, den.paidCents, den.remainingCents);
  }

  // ---- Grand total ----
  if (data.dens.length > 0) {
    y -= DEN_GAP;
    if (y - TOTAL_ROW_H < BOTTOM) newPage();
    page.drawLine({ start: { x: MARGIN, y }, end: { x: WIDTH - MARGIN, y }, thickness: 2, color: GOLD });
    drawTotal(
      `All dens  •  ${data.scoutCount} scout${data.scoutCount === 1 ? "" : "s"}`,
      data.totalDueCents,
      data.collectedCents,
      data.remainingCents,
      rgb(0xff / 255, 0xf4 / 255, 0xd6 / 255)
    );
  }

  // ---- Footer, on every page (the total is only known now) ----
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: MARGIN, y: 0.6 * INCH }, end: { x: WIDTH - MARGIN, y: 0.6 * INCH }, thickness: 0.5, color: LINE });
    const left = safe(
      `${RECEIPT_ORG_NAME}  •  Dues ${data.scoutingYear}  •  ${longDate(now)}  •  Confidential — for pack leadership`
    );
    p.drawText(left, { x: MARGIN, y: 0.42 * INCH, font: fonts.regular, size: 8, color: GRAY });
    const right = safe(`Page ${i + 1} of ${pages.length}`);
    p.drawText(right, {
      x: WIDTH - MARGIN - fonts.regular.widthOfTextAtSize(right, 8),
      y: 0.42 * INCH,
      font: fonts.regular,
      size: 8,
      color: GRAY,
    });
  });

  return pdf.save();
}
