import type { PaymentRecordKind, PaymentRecordStatus } from "@/generated/prisma/enums";
import { RAFFLE_METHOD_LABELS, isRaffleMethod } from "@/lib/raffleMath";

/**
 * Labels and filters for Admin → Payment Records (the page, its CSV export
 * and the action that records an outcome), kept in one place so the three
 * always agree. What a payment record is and how it gets written is in
 * src/lib/paymentRecords.ts.
 */

export const PAYMENT_RECORD_STATUSES = [
  "NEEDS_DECISION",
  "REFUNDED",
  "KEPT_BY_PACK",
  "ENTERED_IN_ERROR",
  "NOT_APPLICABLE",
] as const satisfies readonly PaymentRecordStatus[];

export function isPaymentRecordStatus(value: string): value is PaymentRecordStatus {
  return (PAYMENT_RECORD_STATUSES as readonly string[]).includes(value);
}

export const PAYMENT_RECORD_STATUS_LABELS: Record<PaymentRecordStatus, string> = {
  NEEDS_DECISION: "Needs decision",
  REFUNDED: "Refunded",
  KEPT_BY_PACK: "Kept by pack",
  ENTERED_IN_ERROR: "Entered by mistake",
  NOT_APPLICABLE: "Not applicable",
};

/** The badge-pill color for each status: red while someone still has to decide. */
export const PAYMENT_RECORD_STATUS_BADGES: Record<PaymentRecordStatus, string> = {
  NEEDS_DECISION: "badge-unpaid",
  REFUNDED: "badge-paid",
  KEPT_BY_PACK: "badge-junior",
  ENTERED_IN_ERROR: "badge-pending",
  NOT_APPLICABLE: "badge-viewer",
};

export function paymentRecordKindLabel(kind: PaymentRecordKind, isCredit = false): string {
  switch (kind) {
    case "DUES":
      return "Dues";
    case "EVENT":
      return "Event payment";
    case "GUEST_GROUP":
      return "Guest group payment";
    case "TRIP":
      return "Trip payment";
    case "RAFFLE":
      return "50/50 raffle payment";
    case "TRIP_EXPENSE":
      return isCredit ? "Trip vendor credit" : "Trip expense";
  }
}

/** Raffle payments store the method's enum value ("ZELLE"); everything else has none. */
export function paymentMethodLabel(method: string | null): string | null {
  if (!method) return null;
  return isRaffleMethod(method) ? RAFFLE_METHOD_LABELS[method] : method;
}

/** The tabs (?status=…). "Needs decision" is the default: those are the ones waiting on someone. */
export const PAYMENT_RECORD_FILTERS = {
  needs: { label: "Needs decision", status: "NEEDS_DECISION" },
  refunded: { label: "Refunded", status: "REFUNDED" },
  kept: { label: "Kept by pack", status: "KEPT_BY_PACK" },
  mistake: { label: "Entered by mistake", status: "ENTERED_IN_ERROR" },
  na: { label: "Not applicable", status: "NOT_APPLICABLE" },
  all: { label: "All", status: null },
} as const satisfies Record<string, { label: string; status: PaymentRecordStatus | null }>;

export type PaymentRecordFilter = keyof typeof PAYMENT_RECORD_FILTERS;

export function parsePaymentRecordFilter(value: string | null | undefined): PaymentRecordFilter {
  return value && Object.hasOwn(PAYMENT_RECORD_FILTERS, value) ? (value as PaymentRecordFilter) : "needs";
}

/** The Prisma `where` for a tab. */
export function paymentRecordFilterWhere(filter: PaymentRecordFilter): { status?: PaymentRecordStatus } {
  const status = PAYMENT_RECORD_FILTERS[filter].status;
  return status ? { status } : {};
}

/**
 * Contact details a trip registration carried (the only kind that has them),
 * read defensively: `details` is untyped JSON, and rows the safety-net
 * trigger wrote can hold nulls where the app would have left a key out.
 */
export function paymentRecordContact(details: unknown): { email: string | null; phone: string | null } {
  if (!details || typeof details !== "object" || Array.isArray(details)) return { email: null, phone: null };
  const d = details as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
  return { email: text(d.contactEmail), phone: text(d.contactPhone) };
}

/**
 * The form's fingerprint of a record's outcome: changes on every save, so a
 * second admin's form that was loaded before the first one saved is turned
 * away instead of quietly overwriting it.
 */
export function paymentRecordVersion(record: { resolvedAt: Date | null }): string {
  return record.resolvedAt ? record.resolvedAt.toISOString() : "new";
}
