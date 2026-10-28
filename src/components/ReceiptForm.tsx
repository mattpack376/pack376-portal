"use client";

import { useState, useTransition } from "react";
import {
  emailReceiptAction,
  generateReceiptAction,
  type EmailReceiptResult,
  type GenerateReceiptResult,
} from "@/lib/actions/receipts";
import { base64PdfFile } from "@/lib/savePdf";
import PdfDownloadButton from "@/components/PdfDownloadButton";
import { MAX_EMAIL_LENGTH } from "@/lib/formValues";
import { SIGNED_OUT_HINT } from "@/lib/requestKey";
import {
  RECEIPT_KINDS,
  RECEIPT_KIND_INFO,
  RECEIPT_METHODS,
  RECEIPT_STATUSES,
  RECEIPT_STATUS_LABELS,
  isPaymentKind,
  newReceiptRequestKey,
  seasonForDate,
  type ReceiptInput,
  type ReceiptKind,
} from "@/lib/receipts";

type Message = { kind: "ok" | "error"; text: string } | null;

/*
 * A Server Action call that gets no answer at all — a dropped connection, a
 * timeout, an error page instead of a result — rejects. Left alone inside a
 * transition, that would replace the whole page with the error screen and
 * take the form, its fields and its request key with it. The two calls below
 * catch it instead and say so, leaving the form as it was: pressing the same
 * button again then repeats the same request under the same key, which the
 * server already makes safe.
 */

/** Download PDF's result: the message to show, and the file to hand over (null when there's none). */
export async function receiptPdfOutcome(
  call: () => Promise<GenerateReceiptResult>,
  mode: "share" | "download"
): Promise<{ message: Message; file: File | null }> {
  let result: GenerateReceiptResult;
  try {
    result = await call();
  } catch {
    return {
      message: {
        kind: "error",
        text: `Couldn't get an answer from the server, so we don't know whether the receipt was saved. Press Download PDF again: it won't be saved twice. ${SIGNED_OUT_HINT}`,
      },
      file: null,
    };
  }
  if (!result.ok) return { message: { kind: "error", text: result.error }, file: null };
  return {
    message: {
      kind: "ok",
      text: mode === "share" ? "Receipt saved to the history below." : "Receipt downloaded and saved to the history below.",
    },
    file: base64PdfFile(result.pdfBase64, result.filename),
  };
}

/** Email PDF's message. `to` is the address as typed, for when the server never answered. */
export async function emailReceiptOutcome(
  call: () => Promise<EmailReceiptResult>,
  to: string,
  recordsEmail: string
): Promise<Message> {
  let result: EmailReceiptResult;
  try {
    result = await call();
  } catch {
    return {
      kind: "error",
      text: `Couldn't get an answer from the server, so we don't know whether the email to ${to || "that address"} went out. Press Email PDF again to retry: if it did go out, it won't be sent twice. ${SIGNED_OUT_HINT}`,
    };
  }
  if (!result.ok) return { kind: "error", text: result.error };
  return {
    kind: "ok",
    text: result.alreadySent
      ? `This receipt was already emailed to ${result.sentTo}, so it wasn't sent again. To send another copy, use Resend in the history below.`
      : `Emailed to ${result.sentTo}. A copy went to ${recordsEmail} and it's saved to the history below.`,
  };
}

/**
 * The receipt builder. Fields live in plain state and the buttons call the
 * Server Actions directly rather than submitting a <form>: React 19 resets an
 * action form after every submit, which would wipe the fields right after a
 * Download — and the usual next step is to Email the same receipt.
 *
 * `requestKey` names the receipt on screen. Download and Email both send it,
 * so Download-then-Email is one history entry and pressing either again on
 * this page — a double click, or a retry after the server's answer was lost —
 * finds the receipt (and the email) it already made instead of making
 * another. It changes whenever a printed field does; the email address isn't
 * printed, so changing only that emails the same receipt to the new address.
 * It isn't kept anywhere but this page: after a reload, the history below is
 * what shows whether a receipt was saved or emailed.
 */
export default function ReceiptForm({
  today,
  defaultIssuerName,
  defaultIssuerTitle,
  recordsEmail,
}: {
  today: string;
  defaultIssuerName: string;
  defaultIssuerTitle: string;
  recordsEmail: string;
}) {
  const [kind, setKind] = useState<ReceiptKind>("DONATION");
  const [receivedFrom, setReceivedFrom] = useState("");
  const [scoutName, setScoutName] = useState("");
  const [purpose, setPurpose] = useState(RECEIPT_KIND_INFO.DONATION.defaultPurpose);
  const [season, setSeason] = useState(seasonForDate(today));
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState("");
  const [status, setStatus] = useState("FULL");
  const [issuedByName, setIssuedByName] = useState(defaultIssuerName);
  const [issuedByTitle, setIssuedByTitle] = useState(defaultIssuerTitle);
  const [emailTo, setEmailTo] = useState("");
  const [requestKey, setRequestKey] = useState(newReceiptRequestKey);
  const [message, setMessage] = useState<Message>(null);
  const [pending, startTransition] = useTransition();

  const payment = isPaymentKind(kind);
  const edited = (fn: () => void) => {
    fn();
    setRequestKey(newReceiptRequestKey());
    setMessage(null);
  };

  const changeKind = (next: ReceiptKind) =>
    edited(() => {
      if (!purpose || purpose === RECEIPT_KIND_INFO[kind].defaultPurpose) setPurpose(RECEIPT_KIND_INFO[next].defaultPurpose);
      setKind(next);
    });

  const changeDate = (next: string) =>
    edited(() => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(next) && season === seasonForDate(date)) setSeason(seasonForDate(next));
      setDate(next);
    });

  const input = (): ReceiptInput => ({
    kind,
    receivedFrom,
    scoutName,
    purpose,
    season,
    amount,
    date,
    method,
    status,
    issuedByName,
    issuedByTitle,
    emailTo,
  });

  // Builds the PDF and saves it to the history; PdfDownloadButton then
  // downloads it, or on a phone opens the share sheet with it. Inside the
  // transition so Email waits while it builds. receiptPdfOutcome turns every
  // answer, even none, into a message, so the promise always settles and the
  // button never sticks on "Preparing…".
  const buildPdf = (mode: "share" | "download") =>
    new Promise<File | null>((resolve) =>
      startTransition(async () => {
        setMessage(null);
        const { message: next, file } = await receiptPdfOutcome(() => generateReceiptAction(input(), requestKey), mode);
        setMessage(next);
        resolve(file);
      })
    );

  const email = () => {
    if (!window.confirm(`Email this receipt to ${emailTo.trim() || "the address entered"}? A copy also goes to ${recordsEmail}.`)) return;
    startTransition(async () => {
      setMessage(null);
      setMessage(await emailReceiptOutcome(() => emailReceiptAction(input(), requestKey), emailTo.trim(), recordsEmail));
    });
  };

  return (
    <div className="info-card">
      <div className="form-field">
        <label htmlFor="receipt-kind">Receipt type</label>
        <select id="receipt-kind" value={kind} onChange={(e) => changeKind(e.target.value as ReceiptKind)}>
          {RECEIPT_KINDS.map((k) => (
            <option key={k} value={k}>
              {RECEIPT_KIND_INFO[k].label}
            </option>
          ))}
        </select>
        <p className="form-note">{RECEIPT_KIND_INFO[kind].blurb}</p>
      </div>

      <div className="form-row">
        <div className="form-field">
          <label htmlFor="receipt-from">{payment ? "Received from (parent/guardian)" : "Donor name"}</label>
          <input id="receipt-from" type="text" maxLength={100} value={receivedFrom} onChange={(e) => edited(() => setReceivedFrom(e.target.value))} />
        </div>
        {payment && (
          <div className="form-field">
            <label htmlFor="receipt-scout">Scout{kind === "OTHER" ? " (optional)" : ""}</label>
            <input id="receipt-scout" type="text" maxLength={100} value={scoutName} onChange={(e) => edited(() => setScoutName(e.target.value))} />
          </div>
        )}
      </div>

      {payment && (
        <div className="form-row">
          <div className="form-field" style={{ flexGrow: 2 }}>
            <label htmlFor="receipt-purpose">What it was for</label>
            <input id="receipt-purpose" type="text" maxLength={120} value={purpose} onChange={(e) => edited(() => setPurpose(e.target.value))} />
          </div>
          {kind === "DUES" && (
            <div className="form-field">
              <label htmlFor="receipt-season">Season</label>
              <input id="receipt-season" type="text" maxLength={20} value={season} onChange={(e) => edited(() => setSeason(e.target.value))} />
            </div>
          )}
        </div>
      )}

      <div className="form-row">
        <div className="form-field">
          <label htmlFor="receipt-amount">Amount ($)</label>
          <input id="receipt-amount" type="text" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => edited(() => setAmount(e.target.value))} />
        </div>
        <div className="form-field">
          <label htmlFor="receipt-date">{payment ? "Date paid" : "Date received"}</label>
          <input id="receipt-date" type="date" value={date} onChange={(e) => changeDate(e.target.value)} />
        </div>
        <div className="form-field">
          <label htmlFor="receipt-method">Payment method (optional)</label>
          <select id="receipt-method" value={method} onChange={(e) => edited(() => setMethod(e.target.value))}>
            <option value="">Not shown</option>
            {RECEIPT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        {payment && (
          <div className="form-field">
            <label htmlFor="receipt-status">Status</label>
            <select id="receipt-status" value={status} onChange={(e) => edited(() => setStatus(e.target.value))}>
              {RECEIPT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {RECEIPT_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="form-row">
        <div className="form-field">
          <label htmlFor="receipt-issuer">Generated by (name)</label>
          <input id="receipt-issuer" type="text" maxLength={60} value={issuedByName} onChange={(e) => edited(() => setIssuedByName(e.target.value))} />
        </div>
        <div className="form-field">
          <label htmlFor="receipt-title">Title</label>
          <input id="receipt-title" type="text" maxLength={60} value={issuedByTitle} onChange={(e) => edited(() => setIssuedByTitle(e.target.value))} />
        </div>
      </div>

      <div className="form-field">
        <label htmlFor="receipt-email">Email receipt to (only needed to send it)</label>
        <input
          id="receipt-email"
          type="email"
          inputMode="email"
          autoComplete="off"
          maxLength={MAX_EMAIL_LENGTH}
          value={emailTo}
          onChange={(e) => {
            setEmailTo(e.target.value);
            setMessage(null);
          }}
        />
        <p className="form-note">Emailed receipts are BCC&apos;d to {recordsEmail}. Every receipt you download or email is also saved in the history below.</p>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <PdfDownloadButton className="btn btn-primary" disabled={pending} getFile={buildPdf} />
        <button type="button" className="btn btn-quiet" disabled={pending} onClick={email}>
          Email PDF
        </button>
      </div>

      {/* Two regions so each is announced the right way: an error interrupts, a confirmation waits its turn. */}
      <p role="status" aria-live="polite" style={{ marginTop: 12, fontSize: 14, fontWeight: 600, color: "var(--teal)" }}>
        {message?.kind === "ok" ? message.text : ""}
      </p>
      {message?.kind === "error" && (
        <p role="alert" style={{ marginTop: 0, fontSize: 14, fontWeight: 600, color: "var(--carnival-red)" }}>
          {message.text}
        </p>
      )}
    </div>
  );
}
