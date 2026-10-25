import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { RECEIPT_EMBLEM_PNG_BASE64 } from "@/lib/receiptEmblem";
import { RECEIPT_ORG_NAME } from "@/lib/receipts";
import { formatLongDate } from "@/lib/dateOnly";
import { denDisplayName } from "@/lib/rankConfig";
import { CONSENT_STATUS_LABELS, RELATIONSHIP_LABELS } from "@/lib/photoConsentLabels";
import { longDate, makeSafe, wrap } from "@/lib/parentsPdf";
import type { PhotoConsentExportDen, PhotoConsentExportScout } from "@/lib/photoConsentExport";
import type { ConsentStatus } from "@/generated/prisma/enums";

/*
 * The photo consent list as a PDF: Letter, portrait, one table per den, laid
 * out like the parent contact PDF (title bar and column headings repeat when a
 * den runs onto another page; a scout's row is never split). One row per
 * scout: the three answers, colored so a photographer can scan for the
 * declines, and who signed and when. The same data the CSV carries.
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
const DEN_GAP = 16;

const COL_LABELS = ["SCOUT", "INSTAGRAM / FB", "WEBSITE", "FLIERS", "SIGNED BY"];
const COL_WIDTHS = [125, 78, 70, 70, CONTENT_WIDTH - 343];
const COL_X = COL_WIDTHS.map((_, i) => MARGIN + COL_WIDTHS.slice(0, i).reduce((sum, w) => sum + w, 0));

type Fonts = { regular: PDFFont; bold: PDFFont; italic: PDFFont };
type Row = { cells: string[][]; height: number };

const STATUS_COLOR: Record<ConsentStatus, ReturnType<typeof rgb>> = {
  CONSENT: GREEN,
  DECLINE: RED,
  PENDING: GRAY,
};

function signedBy(scout: PhotoConsentExportScout) {
  if (!scout.signedByName) return "—";
  const relationship = scout.signedRelationship ? ` (${RELATIONSHIP_LABELS[scout.signedRelationship]})` : "";
  const date = scout.signedDate ? `, ${formatLongDate(scout.signedDate)}` : "";
  return `${scout.signedByName}${relationship}${date}`;
}

/** `scope` names what's listed — "All scouts", or a tab's name — for the subtitle. */
export async function buildPhotoConsentPdf(
  denList: PhotoConsentExportDen[],
  opts: { scope: string; now?: Date }
): Promise<Uint8Array> {
  const now = opts.now ?? new Date();
  const dens = denList;
  const scoutCount = dens.reduce((sum, den) => sum + den.scouts.length, 0);

  const pdf = await PDFDocument.create();
  pdf.setTitle(`${RECEIPT_ORG_NAME} Photo Consent`);
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
  draw("Photo Consent", MARGIN + logo + 12, y - 17, fonts.bold, 17, BLUE);
  draw(
    `${opts.scope}  •  ${scoutCount} scout${scoutCount === 1 ? "" : "s"}  •  Generated ${longDate(now)}`,
    MARGIN + logo + 12,
    y - 33,
    fonts.regular,
    9.5,
    GRAY
  );
  y -= logo + 8;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: WIDTH - MARGIN, y }, thickness: 2, color: GOLD });
  y -= 18;

  if (dens.length === 0) {
    draw("No scouts to list.", MARGIN, y - TEXT_SIZE, fonts.italic, TEXT_SIZE + 1, GRAY);
  }

  // ---- Layout of one scout's row ----
  const layoutScout = (scout: PhotoConsentExportScout): Row => {
    // Sanitised before it's measured: widthOfTextAtSize throws on a character the font can't encode.
    const fit = (text: string, col: number, font = fonts.regular) =>
      wrap(safe(text), font, TEXT_SIZE, COL_WIDTHS[col] - 2 * PAD_X);
    const cells = [
      fit(`${scout.firstName} ${scout.lastName}`.trim(), 0, fonts.bold),
      fit(CONSENT_STATUS_LABELS[scout.facebook], 1, fonts.bold),
      fit(CONSENT_STATUS_LABELS[scout.website], 2, fonts.bold),
      fit(CONSENT_STATUS_LABELS[scout.fliers], 3, fonts.bold),
      fit(signedBy(scout), 4),
    ];
    return { cells, height: Math.max(...cells.map((lines) => lines.length)) * LEADING + 2 * PAD_Y };
  };

  const newPage = () => {
    page = pdf.addPage([WIDTH, HEIGHT]);
    y = HEIGHT - MARGIN;
  };

  const drawDenHeader = (den: PhotoConsentExportDen, continued: boolean) => {
    page.drawRectangle({ x: MARGIN, y: y - TITLE_BAR_H, width: CONTENT_WIDTH, height: TITLE_BAR_H, color: BLUE });
    const title = denDisplayName(den.rank, den.scoutingYear, den.label);
    draw(continued ? `${title} (continued)` : title, MARGIN + PAD_X + 2, y - 15, fonts.bold, 11, WHITE);
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
    page.drawRectangle({ x: MARGIN, y: y - HEAD_ROW_H, width: CONTENT_WIDTH, height: HEAD_ROW_H, color: HEAD_FILL });
    COL_LABELS.forEach((label, i) => draw(label, COL_X[i] + PAD_X, y - 12, fonts.bold, 7.5, GRAY));
    y -= HEAD_ROW_H;
  };

  const drawScout = (scout: PhotoConsentExportScout, row: Row) => {
    const statuses = [scout.facebook, scout.website, scout.fliers];
    row.cells.forEach((lines, col) => {
      const font = col === 0 || (col >= 1 && col <= 3) ? fonts.bold : fonts.regular;
      const color = col >= 1 && col <= 3 ? STATUS_COLOR[statuses[col - 1]] : DARK;
      lines.forEach((line, n) =>
        draw(line, COL_X[col] + PAD_X, y - PAD_Y - TEXT_SIZE * 0.82 - n * LEADING, font, TEXT_SIZE, color)
      );
    });
    y -= row.height;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: WIDTH - MARGIN, y }, thickness: 0.5, color: LINE });
  };

  // ---- Dens ----
  for (const [index, den] of dens.entries()) {
    const rows = den.scouts.map(layoutScout);
    if (index > 0) y -= DEN_GAP;

    // A den never starts where its title, headings and first scout won't all fit.
    if (y - (TITLE_BAR_H + HEAD_ROW_H + rows[0].height) < BOTTOM) newPage();
    drawDenHeader(den, false);

    for (const [i, scout] of den.scouts.entries()) {
      if (y - rows[i].height < BOTTOM) {
        newPage();
        drawDenHeader(den, true);
      }
      drawScout(scout, rows[i]);
    }
  }

  // ---- Footer, on every page (the total is only known now) ----
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: MARGIN, y: 0.6 * INCH }, end: { x: WIDTH - MARGIN, y: 0.6 * INCH }, thickness: 0.5, color: LINE });
    const left = safe(`${RECEIPT_ORG_NAME}  •  Photo consent  •  ${longDate(now)}`);
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
