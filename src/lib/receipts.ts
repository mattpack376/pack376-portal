/*
 * Receipt types, kinds and input validation. No server-only imports, so the
 * form (client) and the Server Actions share one definition of what a valid
 * receipt is — the actions re-validate everything regardless, since they
 * receive whatever a caller sends.
 */
import { dollarsToCents } from "@/lib/formValues";

/**
 * What the IRS letter (Banking/IRS Determination Letter 501c(3).pdf) lists for
 * the pack's exemption: the Federal Identification Number issued to Greater
 * New York Councils under BSA's group exemption. Printed on donation receipts.
 */
export const RECEIPT_ORG_NAME = "Cub Scout Pack 376";
export const RECEIPT_COUNCIL_NAME = "Greater New York Councils, Scouting America";
export const RECEIPT_OFFICIAL_NAME = "GNYC BSA Pack 3376F";
export const RECEIPT_EIN = "13-1624015";

/** Every emailed receipt is BCC'd here, so the pack has a copy outside the portal too. */
export const RECEIPT_RECORDS_EMAIL = "matt.pack376@gmail.com";

export const RECEIPT_KINDS = ["DONATION", "DUES", "CAMPING", "EVENT", "OTHER"] as const;
export type ReceiptKind = (typeof RECEIPT_KINDS)[number];

export const RECEIPT_METHODS = ["Zelle", "Cash", "Check", "Card", "Other"] as const;
export const RECEIPT_STATUSES = ["FULL", "PARTIAL", "NONE"] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

export const RECEIPT_STATUS_LABELS: Record<ReceiptStatus, string> = {
  FULL: "Paid in full",
  PARTIAL: "Partial payment",
  NONE: "Don't show a status",
};

type KindInfo = {
  label: string;
  /** Shown in the picker's help text. */
  blurb: string;
  /** The "For" line a payment receipt starts with — editable on the form. */
  defaultPurpose: string;
  /** "dues payment", "camping payment"… used in the footer sentence. */
  noun: string;
};

export const RECEIPT_KIND_INFO: Record<ReceiptKind, KindInfo> = {
  DONATION: {
    label: "Donation",
    blurb: "A gift to the pack. Includes the 501(c)(3) tax-deductible language, official name and EIN.",
    defaultPurpose: "Monetary donation",
    noun: "donation",
  },
  DUES: {
    label: "Dues",
    blurb: "Annual Cub Scout dues for a scout, with the season.",
    defaultPurpose: "Annual Cub Scout dues",
    noun: "dues payment",
  },
  CAMPING: {
    label: "Camping / trip",
    blurb: "A camping or trip payment for a scout, such as Camp Conron.",
    defaultPurpose: "Camping trip payment",
    noun: "camping payment",
  },
  EVENT: {
    label: "Event",
    blurb: "An event registration or fee.",
    defaultPurpose: "Event registration",
    noun: "event payment",
  },
  OTHER: {
    label: "Other payment",
    blurb: "Anything else. Type what it was for.",
    defaultPurpose: "",
    noun: "payment",
  },
};

export function isPaymentKind(kind: ReceiptKind) {
  return kind !== "DONATION";
}

/** What the form sends — raw strings as typed, nothing trusted. */
export type ReceiptInput = {
  kind: string;
  receivedFrom: string;
  scoutName: string;
  purpose: string;
  season: string;
  amount: string;
  date: string;
  method: string;
  status: string;
  issuedByName: string;
  issuedByTitle: string;
  emailTo: string;
};

/** A validated receipt, ready to draw. */
export type ReceiptData = {
  kind: ReceiptKind;
  receivedFrom: string;
  scoutName: string;
  purpose: string;
  season: string;
  amountCents: number;
  /** YYYY-MM-DD */
  date: string;
  method: string;
  status: ReceiptStatus;
  issuedByName: string;
  issuedByTitle: string;
};

const MAX_AMOUNT_CENTS = 100_000_00;
const EMAIL_PATTERN = /^[^\s@,;<>()]+@[^\s@,;<>()]+\.[^\s@,;<>()]+$/;

function clean(value: unknown, max: number): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function isValidReceiptEmail(value: string) {
  return value.length <= 200 && EMAIL_PATTERN.test(value);
}

export function formatReceiptMoney(cents: number) {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export type ReceiptValidation =
  | { ok: true; data: ReceiptData; emailTo: string }
  | { ok: false; error: string };

export function validateReceiptInput(input: ReceiptInput, opts: { requireEmail: boolean }): ReceiptValidation {
  const kind = RECEIPT_KINDS.find((k) => k === input?.kind);
  if (!kind) return { ok: false, error: "Pick a receipt type." };

  const receivedFrom = clean(input.receivedFrom, 100);
  if (!receivedFrom) {
    return { ok: false, error: kind === "DONATION" ? "Enter the donor's name." : "Enter who the payment was received from." };
  }

  const amountCents = dollarsToCents(String(input.amount ?? "").replace(/[$,\s]/g, ""));
  if (amountCents === null || amountCents <= 0) return { ok: false, error: "Enter an amount greater than $0." };
  if (amountCents > MAX_AMOUNT_CENTS) return { ok: false, error: "That amount is too large for a receipt." };

  const date = clean(input.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00.000Z`).getTime())) {
    return { ok: false, error: "Enter a valid date." };
  }

  const method = clean(input.method, 30);
  if (method && !(RECEIPT_METHODS as readonly string[]).includes(method)) {
    return { ok: false, error: "Pick a payment method from the list." };
  }

  const issuedByName = clean(input.issuedByName, 60);
  if (!issuedByName) return { ok: false, error: "Enter who is issuing the receipt." };
  const issuedByTitle = clean(input.issuedByTitle, 60);

  const purpose = isPaymentKind(kind) ? clean(input.purpose, 120) || RECEIPT_KIND_INFO[kind].defaultPurpose : RECEIPT_KIND_INFO[kind].defaultPurpose;
  if (isPaymentKind(kind) && !purpose) return { ok: false, error: "Enter what the payment was for." };

  const status = RECEIPT_STATUSES.find((s) => s === input.status) ?? "FULL";

  const emailTo = clean(input.emailTo, 200);
  if (opts.requireEmail) {
    if (!emailTo) return { ok: false, error: "Enter the email address to send the receipt to." };
    if (!isValidReceiptEmail(emailTo)) return { ok: false, error: "That email address doesn't look right." };
  }

  return {
    ok: true,
    emailTo,
    data: {
      kind,
      receivedFrom,
      scoutName: isPaymentKind(kind) ? clean(input.scoutName, 100) : "",
      purpose,
      season: kind === "DUES" ? clean(input.season, 20) : "",
      amountCents,
      date,
      method,
      status: isPaymentKind(kind) ? status : "FULL",
      issuedByName,
      issuedByTitle,
    },
  };
}

/** "2026-09-25" -> "September 25, 2026". */
export function receiptLongDate(iso: string) {
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "2026-09-25" -> "9/25/2026". */
export function receiptShortDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${m}/${d}/${y}`;
}

/** "Matt Rosen" -> "M. Rosen"; a single word is left alone. */
export function defaultIssuerName(displayName: string) {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return displayName.trim();
  return `${parts[0][0].toUpperCase()}. ${parts[parts.length - 1]}`;
}

/** The scouting season a payment date falls in: Aug–Dec starts one, Jan–Jul ends one. */
export function seasonForDate(iso: string) {
  const [y, m] = iso.split("-").map(Number);
  return m >= 8 ? `${y}–${y + 1}` : `${y - 1}–${y}`;
}

export function receiptFilename(data: ReceiptData) {
  const kind = data.kind === "DONATION" ? "Donation" : "Payment";
  const who = data.receivedFrom.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "Receipt";
  return `Pack376_${kind}_Receipt_${who}_${data.date}.pdf`;
}

/** The columns of a stored Receipt row that make up what is printed. */
export type ReceiptRecordFields = {
  kind: string;
  receivedFrom: string;
  scoutName: string;
  purpose: string;
  season: string;
  amountCents: number;
  receiptDate: Date;
  method: string;
  status: string;
  issuedByName: string;
  issuedByTitle: string;
};

/** A stored row back to drawable data. receiptDate is a UTC-midnight @db.Date value. */
export function receiptDataFromRecord(record: ReceiptRecordFields): ReceiptData {
  return {
    kind: (RECEIPT_KINDS.find((k) => k === record.kind) ?? "OTHER") as ReceiptKind,
    receivedFrom: record.receivedFrom,
    scoutName: record.scoutName,
    purpose: record.purpose,
    season: record.season,
    amountCents: record.amountCents,
    date: record.receiptDate.toISOString().slice(0, 10),
    method: record.method,
    status: (RECEIPT_STATUSES.find((s) => s === record.status) ?? "FULL") as ReceiptStatus,
    issuedByName: record.issuedByName,
    issuedByTitle: record.issuedByTitle,
  };
}

/** True when a stored receipt already says exactly what this data would print. */
export function receiptRecordMatches(record: ReceiptRecordFields, data: ReceiptData) {
  const stored = receiptDataFromRecord(record);
  return (Object.keys(data) as (keyof ReceiptData)[]).every((key) => stored[key] === data[key]);
}
