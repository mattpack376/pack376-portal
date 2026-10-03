import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { RECEIPT_EMBLEM_PNG_BASE64 } from "@/lib/receiptEmblem";
import { RECEIPT_ORG_NAME } from "@/lib/receipts";
import { formatPhoneNumber } from "@/lib/phone";
import { formatPositions } from "@/lib/adultLeaderSections";
import { longDate, makeSafe, wrap } from "@/lib/parentsPdf";
import type { LeaderContactSection } from "@/lib/adultLeaderAttendanceData";

/*
 * The Leaders & Committee contact list as a PDF: Letter, portrait, one table
 * per section (Committee, Pack & Den Leaders). Laid out like the parent
 * contact PDF (parentsPdf.ts, whose text helpers it shares): a section that
 * runs past the bottom of a page carries on at the top of the next with its
 * title bar and column headings repeated, and a person's row is never split
 * across the break. Same people and order as the CSV and the Printable View.
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
const LINE = rgb(0xdd / 255, 0xdd / 255, 0xdd / 255);
const HEAD_FILL = rgb(0xf4 / 255, 0xf7 / 255, 0xfb / 255);
const WHITE = rgb(1, 1, 1);

const TEXT_SIZE = 9.5;
const LEADING = 12;
const PAD_X = 6;
const PAD_Y = 4;
const TITLE_BAR_H = 22;
const HEAD_ROW_H = 17;
const SECTION_GAP = 16;

const COL_LABELS = ["NAME", "POSITIONS", "EMAIL", "PHONE"];
const COL_X = [0, 135, 280, 440].map((x) => MARGIN + x);
const COL_W = [135, 145, 160, CONTENT_WIDTH - 440];

type Fonts = { regular: PDFFont; bold: PDFFont; italic: PDFFont };
type Row = { cells: string[][]; height: number };

export async function buildLeadersPdf(sections: LeaderContactSection[], opts: { now?: Date } = {}): Promise<Uint8Array> {
  const now = opts.now ?? new Date();
  // Same as the Printable View: a section with nobody in it is left off.
  const listed = sections.filter((s) => s.people.length > 0);
  const total = listed.reduce((sum, s) => sum + s.people.length, 0);

  const pdf = await PDFDocument.create();
  pdf.setTitle(`${RECEIPT_ORG_NAME} Committee & Leaders Contact Information`);
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
  draw("Committee & Leaders Contact Information", MARGIN + logo + 12, y - 17, fonts.bold, 17, BLUE);
  draw(
    `${total} ${total === 1 ? "person" : "people"}  •  Generated ${longDate(now)}`,
    MARGIN + logo + 12,
    y - 33,
    fonts.regular,
    9.5,
    GRAY
  );
  y -= logo + 8;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: WIDTH - MARGIN, y }, thickness: 2, color: GOLD });
  y -= 18;

  if (listed.length === 0) {
    draw("Nobody is on the list yet.", MARGIN, y - TEXT_SIZE, fonts.italic, TEXT_SIZE + 1, GRAY);
  }

  // ---- Layout of one person's row ----
  const layoutPerson = (person: LeaderContactSection["people"][number]): Row => {
    // Sanitised before it's measured: widthOfTextAtSize throws on a character the font can't encode.
    const fit = (text: string, col: number, font = fonts.regular) =>
      wrap(safe(text), font, TEXT_SIZE, COL_W[col] - 2 * PAD_X);
    const cells = [
      fit(person.name, 0, fonts.bold),
      fit(formatPositions(person.positions) || "—", 1),
      fit(person.email || "—", 2),
      fit(person.phone ? formatPhoneNumber(person.phone) : "—", 3),
    ];
    return { cells, height: Math.max(...cells.map((lines) => lines.length)) * LEADING + 2 * PAD_Y };
  };

  const newPage = () => {
    page = pdf.addPage([WIDTH, HEIGHT]);
    y = HEIGHT - MARGIN;
  };

  const drawSectionHeader = (section: LeaderContactSection, continued: boolean) => {
    page.drawRectangle({ x: MARGIN, y: y - TITLE_BAR_H, width: CONTENT_WIDTH, height: TITLE_BAR_H, color: BLUE });
    draw(continued ? `${section.label} (continued)` : section.label, MARGIN + PAD_X + 2, y - 15, fonts.bold, 11, WHITE);
    draw(
      `${section.people.length} ${section.people.length === 1 ? "person" : "people"}`,
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

  const drawRow = (row: Row) => {
    row.cells.forEach((lines, col) => {
      lines.forEach((line, n) =>
        draw(
          line,
          COL_X[col] + PAD_X,
          y - PAD_Y - TEXT_SIZE * 0.82 - n * LEADING,
          col === 0 ? fonts.bold : fonts.regular,
          TEXT_SIZE
        )
      );
    });
    y -= row.height;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: WIDTH - MARGIN, y }, thickness: 0.5, color: LINE });
  };

  // ---- Sections ----
  for (const [index, section] of listed.entries()) {
    const rows = section.people.map(layoutPerson);
    if (index > 0) y -= SECTION_GAP;

    // A section never starts where its title, headings and first person won't all fit.
    if (y - (TITLE_BAR_H + HEAD_ROW_H + rows[0].height) < BOTTOM) newPage();
    drawSectionHeader(section, false);

    for (const row of rows) {
      if (y - row.height < BOTTOM) {
        newPage();
        drawSectionHeader(section, true);
      }
      drawRow(row);
    }
  }

  // ---- Footer, on every page (the total is only known now) ----
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: MARGIN, y: 0.6 * INCH }, end: { x: WIDTH - MARGIN, y: 0.6 * INCH }, thickness: 0.5, color: LINE });
    const left = safe(`${RECEIPT_ORG_NAME}  •  Committee & leaders contacts  •  ${longDate(now)}`);
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
