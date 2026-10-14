import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { RECEIPT_EMBLEM_PNG_BASE64 } from "@/lib/receiptEmblem";
import { RECEIPT_ORG_NAME } from "@/lib/receipts";
import { formatCents } from "@/lib/duesData";
import { longDate, makeSafe, wrap } from "@/lib/parentsPdf";
import { tripExpenseTotals, type getTripExpenses } from "@/lib/tripPageData";

/*
 * A trip's expenses and vendor credits/refunds as a PDF: Letter, portrait.
 * The Money card's totals sit in a box at the top, then every item oldest
 * first, ending in a Net Expenses row. Same items and totals as the CSV
 * export. Laid out like the contact-list PDFs (parentsPdf.ts, whose text
 * helpers it shares): a list that runs past the bottom of a page carries on
 * at the top of the next with its title bar and column headings repeated.
 * Credits read as credits in black and white too — a minus sign and an
 * italic "Credit / Refund" line — not only by their green.
 */

type TripExpense = Awaited<ReturnType<typeof getTripExpenses>>[number];

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
const LINE = rgb(0xdd / 255, 0xdd / 255, 0xdd / 255);
const HEAD_FILL = rgb(0xf4 / 255, 0xf7 / 255, 0xfb / 255);
const WHITE = rgb(1, 1, 1);
// The portal's --money-green and --carnival-red-dark, as on the page's balance lines.
const GREEN = rgb(0x0f / 255, 0x7a / 255, 0x43 / 255);
const RED = rgb(0xb3 / 255, 0, 0x1f / 255);

const TEXT_SIZE = 9.5;
const LEADING = 12;
const PAD_X = 6;
const PAD_Y = 4;
const TITLE_BAR_H = 22;
const HEAD_ROW_H = 17;

const COL_LABELS = ["DATE", "DESCRIPTION", "PAID / RECEIVED BY", "AMOUNT"];
const COL_X = [0, 72, 322, 437].map((x) => MARGIN + x);
const COL_W = [72, 250, 115, CONTENT_WIDTH - 437];
const AMOUNT_RIGHT = WIDTH - MARGIN - PAD_X;

type Fonts = { regular: PDFFont; bold: PDFFont; italic: PDFFont };
type Row = { date: string; description: string[]; who: string[]; amount: string; isCredit: boolean; height: number };

/** Positive is green, negative red, zero plain — balanceClass() in paymentStatus.ts, for the PDF. */
const signColor = (cents: number) => (cents < 0 ? RED : cents > 0 ? GREEN : DARK);

export async function buildTripExpensesPdf(
  expenses: TripExpense[],
  opts: { tripTitle: string; collectedCents: number; now?: Date }
): Promise<Uint8Array> {
  const now = opts.now ?? new Date();
  const { spentCents, creditCents, netCents } = tripExpenseTotals(expenses);
  const availableCents = opts.collectedCents - netCents;

  const pdf = await PDFDocument.create();
  pdf.setTitle(`${opts.tripTitle} Expenses`);
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
  draw("Trip Expenses", MARGIN + logo + 12, y - 17, fonts.bold, 17, BLUE);
  draw(
    `${opts.tripTitle}  •  ${expenses.length} item${expenses.length === 1 ? "" : "s"}  •  Generated ${longDate(now)}`,
    MARGIN + logo + 12,
    y - 33,
    fonts.regular,
    9.5,
    GRAY
  );
  y -= logo + 8;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: WIDTH - MARGIN, y }, thickness: 2, color: GOLD });
  y -= 18;

  // ---- Totals box: the admin page's Money card lines about spending ----
  const totals: { label: string; cents: number; bold?: boolean; color?: ReturnType<typeof rgb> }[] = [
    { label: "Total Expenses", cents: spentCents },
    // `|| 0`: Intl formats -0 as "-$0.00".
    { label: "Credits & Refunds", cents: -creditCents || 0, color: creditCents > 0 ? GREEN : DARK },
    { label: "Net Expenses", cents: netCents, bold: true },
    { label: "Collected So Far", cents: opts.collectedCents },
    { label: "Available to Spend (Collected So Far)", cents: availableCents, bold: true, color: signColor(availableCents) },
  ];
  const boxW = 300;
  const boxLine = 16;
  const boxH = totals.length * boxLine + 2 * PAD_Y + 4;
  page.drawRectangle({ x: MARGIN, y: y - boxH, width: boxW, height: boxH, color: HEAD_FILL, borderColor: LINE, borderWidth: 0.75 });
  totals.forEach((t, i) => {
    const baseline = y - PAD_Y - 2 - (i + 1) * boxLine + 4;
    const font = t.bold ? fonts.bold : fonts.regular;
    draw(t.label, MARGIN + PAD_X + 4, baseline, font, 10, DARK);
    draw(formatCents(t.cents), MARGIN + boxW - PAD_X - 4, baseline, font, 10, t.color ?? DARK, "right");
  });
  y -= boxH + 22;

  // ---- The list ----
  const layoutRow = (e: TripExpense): Row => {
    // Sanitised before it's measured: widthOfTextAtSize throws on a character the font can't encode.
    const description = wrap(safe(e.description), fonts.regular, TEXT_SIZE, COL_W[1] - 2 * PAD_X);
    if (e.isCredit) description.push("Credit / Refund");
    const who = wrap(safe(e.paidBy || "—"), fonts.regular, TEXT_SIZE, COL_W[2] - 2 * PAD_X);
    return {
      date: e.spentOn.toLocaleDateString("en-US", { timeZone: "UTC" }),
      description,
      who,
      amount: formatCents(e.isCredit ? -e.amountCents : e.amountCents),
      isCredit: e.isCredit,
      height: Math.max(description.length, who.length) * LEADING + 2 * PAD_Y,
    };
  };

  const newPage = () => {
    page = pdf.addPage([WIDTH, HEIGHT]);
    y = HEIGHT - MARGIN;
  };

  const drawListHeader = (continued: boolean) => {
    page.drawRectangle({ x: MARGIN, y: y - TITLE_BAR_H, width: CONTENT_WIDTH, height: TITLE_BAR_H, color: BLUE });
    const title = "Expenses & Credits";
    draw(continued ? `${title} (continued)` : title, MARGIN + PAD_X + 2, y - 15, fonts.bold, 11, WHITE);
    draw(
      `${expenses.length} item${expenses.length === 1 ? "" : "s"}`,
      WIDTH - MARGIN - PAD_X - 2,
      y - 15,
      fonts.regular,
      9,
      WHITE,
      "right"
    );
    y -= TITLE_BAR_H;
    page.drawRectangle({ x: MARGIN, y: y - HEAD_ROW_H, width: CONTENT_WIDTH, height: HEAD_ROW_H, color: HEAD_FILL });
    COL_LABELS.forEach((label, i) =>
      i === 3
        ? draw(label, AMOUNT_RIGHT, y - 12, fonts.bold, 7.5, GRAY, "right")
        : draw(label, COL_X[i] + PAD_X, y - 12, fonts.bold, 7.5, GRAY)
    );
    y -= HEAD_ROW_H;
  };

  const drawRow = (row: Row) => {
    const baseline = (n: number) => y - PAD_Y - TEXT_SIZE * 0.82 - n * LEADING;
    draw(row.date, COL_X[0] + PAD_X, baseline(0), fonts.regular, TEXT_SIZE);
    row.description.forEach((line, n) => {
      const tag = row.isCredit && n === row.description.length - 1;
      draw(line, COL_X[1] + PAD_X, baseline(n), tag ? fonts.italic : fonts.regular, TEXT_SIZE, tag ? GREEN : DARK);
    });
    row.who.forEach((line, n) => draw(line, COL_X[2] + PAD_X, baseline(n), fonts.regular, TEXT_SIZE));
    draw(row.amount, AMOUNT_RIGHT, baseline(0), fonts.regular, TEXT_SIZE, row.isCredit ? GREEN : DARK, "right");
    y -= row.height;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: WIDTH - MARGIN, y }, thickness: 0.5, color: LINE });
  };

  const rows = expenses.map(layoutRow);
  const totalRowH = TEXT_SIZE + 2 * PAD_Y + 4;

  if (rows.length === 0) {
    draw("No expenses recorded yet.", MARGIN, y - TEXT_SIZE, fonts.italic, TEXT_SIZE + 1, GRAY);
  } else {
    if (y - (TITLE_BAR_H + HEAD_ROW_H + rows[0].height) < BOTTOM) newPage();
    drawListHeader(false);
    for (const row of rows) {
      if (y - row.height < BOTTOM) {
        newPage();
        drawListHeader(true);
      }
      drawRow(row);
    }

    // Net Expenses closes the list, under a heavier rule — on a fresh page if it won't fit.
    if (y - totalRowH < BOTTOM) {
      newPage();
      drawListHeader(true);
    }
    page.drawLine({ start: { x: MARGIN, y }, end: { x: WIDTH - MARGIN, y }, thickness: 1.25, color: DARK });
    const baseline = y - PAD_Y - 2 - TEXT_SIZE * 0.82;
    draw("Net Expenses", COL_X[1] + PAD_X, baseline, fonts.bold, TEXT_SIZE);
    draw(formatCents(netCents), AMOUNT_RIGHT, baseline, fonts.bold, TEXT_SIZE, DARK, "right");
    y -= totalRowH;
  }

  // ---- Footer, on every page (the total is only known now) ----
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: MARGIN, y: 0.6 * INCH }, end: { x: WIDTH - MARGIN, y: 0.6 * INCH }, thickness: 0.5, color: LINE });
    const left = safe(`${RECEIPT_ORG_NAME}  •  ${opts.tripTitle} expenses  •  ${longDate(now)}`);
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
