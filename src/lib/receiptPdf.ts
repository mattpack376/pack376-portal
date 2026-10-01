import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { RECEIPT_EMBLEM_PNG_BASE64 } from "@/lib/receiptEmblem";
import {
  RECEIPT_EIN,
  RECEIPT_KIND_INFO,
  RECEIPT_COUNCIL_NAME,
  RECEIPT_OFFICIAL_NAME,
  RECEIPT_ORG_NAME,
  RECEIPT_STATUS_LABELS,
  formatReceiptMoney,
  isPaymentKind,
  receiptLongDate,
  receiptShortDate,
  type ReceiptData,
} from "@/lib/receipts";

/*
 * Letter-size, one page. Coordinates are in points from the bottom-left and
 * follow the receipt layout the pack signed off on, so a change here changes
 * a document that goes out to families — keep the header and spacing as is.
 */
const INCH = 72;
const WIDTH = 8.5 * INCH;
const HEIGHT = 11 * INCH;
const MARGIN = 0.75 * INCH;

const BLUE = rgb(0, 0x3f / 255, 0x87 / 255);
const GOLD = rgb(0xf7 / 255, 0xa8 / 255, 0x1b / 255);
const DARK = rgb(0x1a / 255, 0x1a / 255, 0x1a / 255);
const GRAY = rgb(0x55 / 255, 0x55 / 255, 0x55 / 255);
const LINE = rgb(0xcc / 255, 0xcc / 255, 0xcc / 255);
const BOX_FILL = rgb(0xf4 / 255, 0xf7 / 255, 0xfb / 255);
const WHITE = rgb(1, 1, 1);

const PACK_TIME_ZONE = "America/New_York";

/** "09/29/2026 6:38 PM" in the pack's time zone — the server itself runs in UTC. */
function generatedStamp(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PACK_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("month")}/${get("day")}/${get("year")} ${get("hour")}:${get("minute")} ${get("dayPeriod")}`;
}

type Fonts = { regular: PDFFont; bold: PDFFont; italic: PDFFont };

/** Drops characters the built-in Helvetica can't draw (it would throw) rather than failing the receipt. */
function makeSafe(fonts: Fonts) {
  const supported = new Set(fonts.regular.getCharacterSet());
  return (text: string) =>
    Array.from(text)
      .map((ch) => (supported.has(ch.codePointAt(0)!) ? ch : "?"))
      .join("");
}

export async function buildReceiptPdf(data: ReceiptData, now: Date = new Date()): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${RECEIPT_ORG_NAME} ${data.kind === "DONATION" ? "Donation" : "Payment"} Receipt`);
  pdf.setAuthor(RECEIPT_ORG_NAME);
  pdf.setCreator(RECEIPT_ORG_NAME);
  const page = pdf.addPage([WIDTH, HEIGHT]);

  const fonts: Fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
  };
  const safe = makeSafe(fonts);
  const emblem = await pdf.embedPng(Buffer.from(RECEIPT_EMBLEM_PNG_BASE64, "base64"));

  const text = (
    value: string,
    x: number,
    y: number,
    font: PDFFont,
    size: number,
    color = DARK,
    align: "left" | "right" | "center" = "left"
  ) => {
    const s = safe(value);
    const w = font.widthOfTextAtSize(s, size);
    const left = align === "right" ? x - w : align === "center" ? x - w / 2 : x;
    page.drawText(s, { x: left, y, font, size, color });
  };

  /** Shrinks a line to fit its column, then trims with an ellipsis if it still won't. */
  const fit = (value: string, font: PDFFont, size: number, maxWidth: number, minSize: number) => {
    let s = safe(value);
    let sz = size;
    while (font.widthOfTextAtSize(s, sz) > maxWidth && sz > minSize) sz -= 0.5;
    while (font.widthOfTextAtSize(s, sz) > maxWidth && s.length > 1) s = s.slice(0, -2).trimEnd() + "…";
    return { s, sz };
  };
  const fitText = (
    value: string,
    x: number,
    y: number,
    font: PDFFont,
    size: number,
    maxWidth: number,
    minSize: number,
    color = DARK,
    align: "left" | "right" = "left"
  ) => {
    const { s, sz } = fit(value, font, size, maxWidth, minSize);
    text(s, x, y, font, sz, color, align);
  };

  const isPayment = isPaymentKind(data.kind);
  const contentWidth = WIDTH - 2 * MARGIN;

  // ---- Header band (do not change) ----
  const bandH = 1.6 * INCH;
  page.drawRectangle({ x: 0, y: HEIGHT - bandH, width: WIDTH, height: bandH, color: BLUE });
  page.drawRectangle({ x: 0, y: HEIGHT - bandH - 0.06 * INCH, width: WIDTH, height: 0.06 * INCH, color: GOLD });

  const logoSize = 1.05 * INCH;
  page.drawImage(emblem, {
    x: MARGIN,
    y: HEIGHT - bandH + (bandH - logoSize) / 2,
    width: logoSize,
    height: logoSize,
  });

  const textX = MARGIN + logoSize + 0.3 * INCH;
  text(RECEIPT_ORG_NAME, textX, HEIGHT - bandH / 2 + 14, fonts.bold, 20, WHITE);
  text("New York, NY  •  pack376nyc.org", textX, HEIGHT - bandH / 2 - 6, fonts.regular, 11, WHITE);
  text(
    isPayment ? "Official Payment Receipt" : "Official Donation Receipt",
    textX,
    HEIGHT - bandH / 2 - 24,
    fonts.italic,
    10,
    GOLD
  );

  // ---- Date, top right ----
  let y = HEIGHT - bandH - 0.5 * INCH;
  text(
    `${isPayment ? "Date Paid" : "Date Received"}: ${receiptLongDate(data.date)}`,
    WIDTH - MARGIN,
    y,
    fonts.bold,
    11,
    DARK,
    "right"
  );

  // ---- Received from ----
  y -= 0.45 * INCH;
  text("RECEIVED FROM", MARGIN, y, fonts.bold, 10, GRAY);
  y -= 20;
  fitText(data.receivedFrom, MARGIN, y, fonts.bold, 14, contentWidth, 9);
  y -= 18;
  const subline = isPayment ? (data.scoutName ? `Parent/Guardian of ${data.scoutName}` : "") : "Donor";
  if (subline) fitText(subline, MARGIN, y, fonts.regular, 11, contentWidth, 8);

  // ---- Amount box ----
  y -= 0.5 * INCH;
  const boxH = 1.0 * INCH;
  page.drawRectangle({
    x: MARGIN,
    y: y - boxH,
    width: contentWidth,
    height: boxH,
    color: BOX_FILL,
    borderColor: LINE,
    borderWidth: 1,
  });
  text(isPayment ? "AMOUNT PAID" : "DONATION AMOUNT", MARGIN + 20, y - 24, fonts.bold, 10, GRAY);
  text(formatReceiptMoney(data.amountCents), MARGIN + 20, y - 58, fonts.bold, 30, BLUE);

  const rightX = WIDTH - MARGIN - 20;
  if (data.method) {
    text("PAYMENT METHOD", rightX, y - 24, fonts.bold, 10, GRAY, "right");
    text(data.method, rightX, y - 46, fonts.bold, 14, DARK, "right");
    text(`Received ${receiptShortDate(data.date)}`, rightX, y - 64, fonts.regular, 10, GRAY, "right");
  } else {
    text(isPayment ? "DATE PAID" : "DATE RECEIVED", rightX, y - 24, fonts.bold, 10, GRAY, "right");
    text(receiptShortDate(data.date), rightX, y - 46, fonts.bold, 14, DARK, "right");
  }

  // ---- Detail rows ----
  y -= boxH + 0.55 * INCH;
  const row = (label: string, value: string) => {
    text(label, MARGIN, y, fonts.bold, 10, GRAY);
    fitText(value, MARGIN + 1.8 * INCH, y, fonts.regular, 11, contentWidth - 1.8 * INCH, 8);
    page.drawLine({
      start: { x: MARGIN, y: y - 8 },
      end: { x: WIDTH - MARGIN, y: y - 8 },
      thickness: 1,
      color: LINE,
    });
    y -= 30;
  };

  if (isPayment) {
    if (data.scoutName) row("Scout", data.scoutName);
    row("For", data.purpose);
    if (data.kind === "DUES" && data.season) row("Season", data.season);
    if (data.status !== "NONE") {
      const paidInFullDues = data.kind === "DUES" && data.status === "FULL";
      row(
        "Status",
        paidInFullDues
          ? "Paid in full — no balance owed for this season"
          : RECEIPT_STATUS_LABELS[data.status]
      );
    }
  } else {
    row("Donor", data.receivedFrom);
    row("Recipient", RECEIPT_ORG_NAME);
    row("Type", RECEIPT_KIND_INFO.DONATION.defaultPurpose);
    row("Status", "Received with thanks");
  }

  // ---- Thank you ----
  y -= 0.35 * INCH;
  text(
    isPayment
      ? "Thank you for your payment and for being part of Pack 376!"
      : "Thank you for your generous support of Pack 376 and our scouts!",
    MARGIN,
    y,
    fonts.italic,
    11
  );

  // ---- Tax-deductible acknowledgment (donations only) ----
  if (!isPayment) {
    y -= 0.5 * INCH;
    text("TAX-DEDUCTIBLE DONATION", MARGIN, y, fonts.bold, 10, GRAY);
    y -= 18;
    text(
      "Cub Scout Pack 376 is a tax-exempt organization under section 501(c)(3) of the Internal Revenue Code.",
      MARGIN,
      y,
      fonts.regular,
      10
    );
    y -= 15;
    text(
      "Your contribution is tax-deductible to the extent allowed by law. No goods or services were provided",
      MARGIN,
      y,
      fonts.regular,
      10
    );
    y -= 15;
    text("in exchange for this contribution. Please keep this receipt for your tax records.", MARGIN, y, fonts.regular, 10);
    y -= 24;
    text(RECEIPT_COUNCIL_NAME, MARGIN, y, fonts.bold, 10);
    y -= 15;
    text(RECEIPT_OFFICIAL_NAME, MARGIN, y, fonts.bold, 10);
    y -= 15;
    text(`EIN: ${RECEIPT_EIN}`, MARGIN, y, fonts.regular, 10);
    y -= 0.45 * INCH;
  } else {
    y -= 0.55 * INCH;
  }

  // ---- Generated by ----
  page.drawLine({ start: { x: MARGIN, y }, end: { x: WIDTH - MARGIN, y }, thickness: 1, color: LINE });
  y -= 18;
  const issuer = data.issuedByTitle ? `${data.issuedByName} — ${data.issuedByTitle}` : data.issuedByName;
  fitText(`Generated by ${issuer}  •  ${generatedStamp(now)}`, MARGIN, y, fonts.regular, 9, contentWidth, 7, GRAY);

  // ---- Footer ----
  page.drawLine({
    start: { x: MARGIN, y: 0.85 * INCH },
    end: { x: WIDTH - MARGIN, y: 0.85 * INCH },
    thickness: 1,
    color: LINE,
  });
  const noun = RECEIPT_KIND_INFO[data.kind].noun;
  const via = isPayment && data.method ? ` via ${data.method}` : "";
  const footer = fit(
    `${RECEIPT_ORG_NAME}  •  Chartered by the Boy Scouts of America  •  This receipt confirms ${isPayment ? "" : "a "}${noun} received${via} on ${receiptShortDate(data.date)}`,
    fonts.regular,
    8,
    contentWidth,
    6
  );
  text(footer.s, WIDTH / 2, 0.65 * INCH, fonts.regular, footer.sz, GRAY, "center");

  return pdf.save();
}
