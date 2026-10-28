import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/authorize";
import { toCsv, centsToDollarsString, csvResponse } from "@/lib/csv";
import { toDateOnlyString, todayDateOnlyString } from "@/lib/dateOnly";
import {
  PAYMENT_RECORD_FILTERS,
  PAYMENT_RECORD_STATUS_LABELS,
  paymentMethodLabel,
  paymentRecordContact,
  paymentRecordFilterWhere,
  paymentRecordKindLabel,
  parsePaymentRecordFilter,
} from "@/lib/paymentRecordView";

const day = (date: Date | null) => toDateOnlyString(date) ?? "";
const timestamp = (date: Date | null) => (date ? date.toISOString().replace("T", " ").slice(0, 16) + " UTC" : "");

/**
 * Every payment record in the selected tab (?status=, same keys as the page),
 * newest first — the whole set, not just the page's latest 200. Families'
 * payments and contact details, so Admin only, and the shared CSV helpers
 * neutralize formula injection and send it private, no-store.
 */
export async function GET(request: Request) {
  await requireAdminSession();

  const filter = parsePaymentRecordFilter(new URL(request.url).searchParams.get("status"));
  const records = await prisma.paymentRecord.findMany({
    where: paymentRecordFilterWhere(filter),
    orderBy: [{ deletedAt: "desc" }, { id: "asc" }],
  });

  const rows: (string | number)[][] = [
    [
      "Status",
      "Type",
      "Paid For",
      "Paid By",
      "Amount",
      "Paid On",
      "Method",
      "Payment Note",
      "Voided Before Delete",
      "Void Reason",
      "Recorded By",
      "Contact Email",
      "Contact Phone",
      "Why Deleted",
      "Deleted At",
      "Deleted By",
      "Saved By",
      "Refunded Amount",
      "Refunded On",
      "Outcome Note",
      "Outcome Updated At",
      "Outcome Updated By",
    ],
    ...records.map((r) => {
      const contact = paymentRecordContact(r.details);
      return [
        PAYMENT_RECORD_STATUS_LABELS[r.status],
        paymentRecordKindLabel(r.kind, r.isCredit),
        r.paidFor,
        r.paidBy ?? "",
        centsToDollarsString(r.amountCents),
        day(r.paidOn),
        paymentMethodLabel(r.method) ?? "",
        r.note ?? "",
        r.wasVoided ? "Yes" : "",
        r.voidReason ?? "",
        r.recordedByName ?? "",
        contact.email ?? "",
        contact.phone ?? "",
        r.deletionReason,
        timestamp(r.deletedAt),
        r.deletedByName ?? "",
        r.capturedBy === "database" ? "Safety net (fewer details)" : "App",
        r.refundedCents === null ? "" : centsToDollarsString(r.refundedCents),
        day(r.refundedOn),
        r.resolutionNote ?? "",
        timestamp(r.resolvedAt),
        r.resolvedByName ?? "",
      ];
    }),
  ];

  const slug = PAYMENT_RECORD_FILTERS[filter].label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return csvResponse(toCsv(rows), `payment-records-${slug}-${todayDateOnlyString()}.csv`);
}
