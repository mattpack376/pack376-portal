import { notFound } from "next/navigation";
import { requireAdminSession } from "@/lib/authorize";
import { getRaffleDetail, type RaffleDetail } from "@/lib/raffleData";
import { toCsv, centsToDollarsString, csvResponse } from "@/lib/csv";
import { toDateOnlyString } from "@/lib/dateOnly";
import { paymentStatusLabel } from "@/lib/paymentStatus";
import { RAFFLE_METHODS, RAFFLE_METHOD_LABELS, formatBoxNumbers } from "@/lib/raffleMath";

type Rows = (string | number)[][];

const money = centsToDollarsString;
const day = (date: Date | null) => toDateOnlyString(date) ?? "";
const timestamp = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : "");

/** Every box on the board, sold or not — the complete assignment record. */
function boxRows(raffle: RaffleDetail): Rows {
  const holders = new Map(raffle.entries.flatMap((entry) => entry.boxNumbers.map((number) => [number, entry] as const)));
  return [
    ["Box", "Status", "Buyer", "Buyer Paid", "Buyer Still Owes", "Winning Box"],
    ...Array.from({ length: raffle.boxCount }, (_, index) => {
      const number = index + 1;
      const entry = holders.get(number);
      return [
        number,
        !entry ? "Available" : entry.remainingCents <= 0 ? "Paid" : "Taken - not paid",
        entry?.name ?? "",
        entry ? money(entry.paidCents) : "",
        entry ? money(Math.max(entry.remainingCents, 0)) : "",
        number === raffle.winningBox ? "WINNER" : "",
      ];
    }),
  ];
}

/** Every payment, voided ones included, with who it was for and whether it was verified. */
function paymentRows(raffle: RaffleDetail): Rows {
  const boxesByEntry = new Map(raffle.entries.map((entry) => [entry.id, formatBoxNumbers(entry.boxNumbers)]));
  return [
    [
      "Buyer",
      "Boxes",
      "Method",
      "Amount",
      "Paid By",
      "Received",
      "Verified",
      "Verified By",
      "Verified On",
      "Voided",
      "Void Reason",
      "Note",
      "Recorded By",
      "Recorded On",
    ],
    ...raffle.payments.map((payment) => [
      payment.entryName ?? "(not matched to a buyer)",
      payment.entryId ? (boxesByEntry.get(payment.entryId) ?? "") : "",
      RAFFLE_METHOD_LABELS[payment.method],
      money(payment.amountCents),
      payment.payerName ?? "",
      day(payment.receivedOn),
      payment.voidedAt ? "" : payment.verifiedAt ? "Yes" : "No",
      payment.verifiedByName ?? "",
      timestamp(payment.verifiedAt),
      payment.voidedAt ? "VOIDED" : "",
      payment.voidReason ?? "",
      payment.note ?? "",
      payment.recordedByUsername ?? "",
      timestamp(payment.createdAt),
    ]),
  ];
}

/** The financial report: the totals, then one line per buyer. */
function summaryRows(raffle: RaffleDetail): Rows {
  const s = raffle.summary;
  return [
    ["Pack 376 50/50 Raffle", raffle.name],
    ["Status", raffle.status === "OPEN" ? "Open" : "Closed"],
    ["Drawing date", day(raffle.drawingDate)],
    ["Boxes on the board", s.boxCount],
    ["Price per box", money(raffle.priceCents)],
    ["Winner's share", `${raffle.prizePercent}%`],
    [],
    ["Boxes sold", s.soldBoxes],
    ["Boxes unsold", s.availableBoxes],
    ["Sales (boxes sold x price)", money(s.salesCents)],
    ...RAFFLE_METHODS.map((method) => [`${RAFFLE_METHOD_LABELS[method]} received`, money(s.byMethod[method].receivedCents)]),
    ["Total collected", money(s.collectedCents)],
    ["Still owed by buyers", money(s.outstandingCents)],
    ["Collected but not matched to a buyer", money(s.unmatchedCents)],
    ["Collected but not verified", money(s.unverifiedCents)],
    [],
    ["Winning box", raffle.winningBox ?? ""],
    ["Winner", raffle.winnerName ?? ""],
    [s.prizeIsFinal ? "Prize" : "Prize so far (not drawn yet)", money(s.prizeCents)],
    ["Prize paid", !s.prizeIsFinal ? "" : raffle.prizePaid ? "Yes" : "No"],
    ["Prize paid on", day(raffle.prizePaidOn)],
    ["Prize paid by", raffle.prizePaidMethod ? RAFFLE_METHOD_LABELS[raffle.prizePaidMethod] : ""],
    ["Pack proceeds (collected minus prize)", money(s.netCents)],
    [],
    ["Buyer", "Boxes", "Number of Boxes", "Cost", "Paid", "Still Owes", "Status", "Notes"],
    ...raffle.entries.map((entry) => [
      entry.name,
      formatBoxNumbers(entry.boxNumbers),
      entry.boxNumbers.length,
      money(entry.owedCents),
      money(entry.paidCents),
      money(Math.max(entry.remainingCents, 0)),
      paymentStatusLabel(entry.remainingCents, entry.paidCents),
      entry.notes ?? "",
    ]),
  ];
}

const REPORTS = {
  summary: { rows: summaryRows, suffix: "financial-report" },
  boxes: { rows: boxRows, suffix: "box-assignments" },
  payments: { rows: paymentRows, suffix: "payments" },
} as const;

/** "Camp Conron 50/50 — October 2026" -> "camp-conron-50-50-october-2026". */
function slug(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "raffle"
  );
}

export async function GET(request: Request, { params }: { params: Promise<{ raffleId: string }> }) {
  // Buyer names and payments: Admin only, like the other exports.
  await requireAdminSession();

  const { raffleId } = await params;
  const raffle = await getRaffleDetail(raffleId);
  if (!raffle) notFound();

  const type = new URL(request.url).searchParams.get("type");
  const report = REPORTS[type === "boxes" || type === "payments" ? type : "summary"];

  return csvResponse(toCsv(report.rows(raffle)), `${slug(raffle.name)}-${report.suffix}.csv`);
}
