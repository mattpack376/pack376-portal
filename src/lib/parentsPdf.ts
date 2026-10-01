import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { RECEIPT_EMBLEM_PNG_BASE64 } from "@/lib/receiptEmblem";
import { RECEIPT_ORG_NAME } from "@/lib/receipts";
import { formatPhoneNumber } from "@/lib/phone";
import { RANK_ORDER, denDisplayName } from "@/lib/rankConfig";
import type { Rank } from "@/generated/prisma/enums";

/*
 * The parent contact list as a PDF: Letter, portrait, one table per den. A den
 * that runs past the bottom of a page carries on at the top of the next with
 * its title bar and column headings repeated, and a scout's parent rows are
 * never split across the break. Same content and den order as the Printable
 * View, and the same data the CSV exports carry.
 */

export type ParentsPdfDen = {
  rank: Rank;
  scoutingYear: string;
  label: string;
  scouts: {
    firstName: string;
    lastName: string;
    parents: { name: string; email: string | null; phone: string | null }[];
  }[];
};

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
const DEN_GAP = 16;

const COL_LABELS = ["SCOUT", "PARENT / GUARDIAN", "EMAIL", "PHONE"];
const COL_X = [0, 125, 260, 435].map((x) => MARGIN + x);
const COL_W = [125, 135, 175, CONTENT_WIDTH - 435];

const PACK_TIME_ZONE = "America/New_York";

type Fonts = { regular: PDFFont; bold: PDFFont; italic: PDFFont };

/** One scout's rows: a line list per column, kept together on a page. */
type ScoutBlock = { rows: { cells: string[][]; height: number; muted?: boolean }[]; height: number };

/** Drops characters the built-in Helvetica can't draw (it would throw) rather than failing the export. */
function makeSafe(font: PDFFont) {
  const supported = new Set(font.getCharacterSet());
  return (text: string) =>
    Array.from(text)
      .map((ch) => (supported.has(ch.codePointAt(0)!) ? ch : "?"))
      .join("");
}

/**
 * Greedy word wrap. A single word wider than the column (a long email) is
 * broken after its last "@", ".", "-" or "_" that fits, or by character if it
 * has none.
 */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = "";
    for (const ch of Array.from(word)) {
      if (!line || font.widthOfTextAtSize(line + ch, size) <= maxWidth) {
        line += ch;
        continue;
      }
      const cut = Math.max(...["@", ".", "-", "_"].map((mark) => line.lastIndexOf(mark)));
      if (cut > 0 && cut < line.length - 1) {
        lines.push(line.slice(0, cut + 1));
        line = line.slice(cut + 1) + ch;
      } else {
        lines.push(line);
        line = ch;
      }
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

/** Same download headers as the parent-contact CSV routes: private, uncached, saved as a file. */
export function parentsPdfResponse(bytes: Uint8Array, filename: string): Response {
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function longDate(now: Date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PACK_TIME_ZONE,
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(now);
}

/** `scope` names what's listed — "All dens", or a single den's name — for the subtitle. */
export async function buildParentsPdf(
  denList: ParentsPdfDen[],
  opts: { scope: string; now?: Date }
): Promise<Uint8Array> {
  const now = opts.now ?? new Date();
  const dens = [...denList].sort((a, b) => {
    if (a.scoutingYear !== b.scoutingYear) return b.scoutingYear.localeCompare(a.scoutingYear);
    return RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank);
  });
  const scoutCount = dens.reduce((sum, den) => sum + den.scouts.length, 0);

  const pdf = await PDFDocument.create();
  pdf.setTitle(`${RECEIPT_ORG_NAME} Parent Contact Information`);
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
  draw("Parent / Guardian Contact Information", MARGIN + logo + 12, y - 17, fonts.bold, 17, BLUE);
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

  // ---- Layout of one scout's rows ----
  const layoutScout = (scout: ParentsPdfDen["scouts"][number]): ScoutBlock => {
    const name = `${scout.firstName} ${scout.lastName}`.trim();
    const rowHeight = (cells: string[][]) =>
      Math.max(...cells.map((lines) => lines.length)) * LEADING + 2 * PAD_Y;
    // Sanitised before it's measured: widthOfTextAtSize throws on a character the font can't encode.
    const fit = (text: string, col: number, font = fonts.regular) =>
      wrap(safe(text), font, TEXT_SIZE, COL_W[col] - 2 * PAD_X);

    if (scout.parents.length === 0) {
      const cells = [fit(name, 0), fit("No contacts on file", 1, fonts.italic), [], []];
      const height = rowHeight(cells);
      return { rows: [{ cells, height, muted: true }], height };
    }
    const rows = scout.parents.map((parent, i) => {
      const cells = [
        i === 0 ? fit(name, 0) : [],
        fit(parent.name, 1),
        fit(parent.email || "—", 2),
        fit(parent.phone ? formatPhoneNumber(parent.phone) : "—", 3),
      ];
      return { cells, height: rowHeight(cells) };
    });
    return { rows, height: rows.reduce((sum, row) => sum + row.height, 0) };
  };

  const newPage = () => {
    page = pdf.addPage([WIDTH, HEIGHT]);
    y = HEIGHT - MARGIN;
  };

  const drawDenHeader = (den: ParentsPdfDen, continued: boolean) => {
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

  const drawScout = (block: ScoutBlock) => {
    for (const row of block.rows) {
      row.cells.forEach((lines, col) => {
        lines.forEach((line, n) =>
          draw(
            line,
            COL_X[col] + PAD_X,
            y - PAD_Y - TEXT_SIZE * 0.82 - n * LEADING,
            row.muted && col === 1 ? fonts.italic : fonts.regular,
            TEXT_SIZE,
            row.muted && col === 1 ? GRAY : DARK
          )
        );
      });
      y -= row.height;
    }
    page.drawLine({ start: { x: MARGIN, y }, end: { x: WIDTH - MARGIN, y }, thickness: 0.5, color: LINE });
  };

  // ---- Dens ----
  for (const [index, den] of dens.entries()) {
    const blocks = den.scouts.map(layoutScout);
    if (index > 0) y -= DEN_GAP;

    // A den never starts where its title, headings and first scout won't all fit.
    const firstHeight = blocks[0]?.height ?? TEXT_SIZE + 2 * PAD_Y;
    if (y - (TITLE_BAR_H + HEAD_ROW_H + firstHeight) < BOTTOM) newPage();
    drawDenHeader(den, false);

    if (blocks.length === 0) {
      draw("No scouts yet.", MARGIN + PAD_X, y - PAD_Y - TEXT_SIZE * 0.82, fonts.italic, TEXT_SIZE, GRAY);
      y -= TEXT_SIZE + 2 * PAD_Y;
      continue;
    }
    for (const block of blocks) {
      if (y - block.height < BOTTOM) {
        newPage();
        drawDenHeader(den, true);
      }
      drawScout(block);
    }
  }

  // ---- Footer, on every page (the total is only known now) ----
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: MARGIN, y: 0.6 * INCH }, end: { x: WIDTH - MARGIN, y: 0.6 * INCH }, thickness: 0.5, color: LINE });
    const left = safe(`${RECEIPT_ORG_NAME}  •  Parent / Guardian contacts  •  ${longDate(now)}`);
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
