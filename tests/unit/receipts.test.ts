/*
 * The receipt helpers shared by the form and the actions, and the PDF
 * builder's stored-copy support: request keys, the one-mailbox email rule,
 * the "rebuilt" file name, and a PDF that's the same file when drawn twice.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EMAIL_ATTEMPT_STALE_MS,
  PROVIDER_KEY_REUSE_MS,
  emailAttemptView,
  isReceiptRequestKey,
  isValidReceiptEmail,
  newReceiptRequestKey,
  receiptFilename,
  sameReceiptData,
  validateReceiptInput,
  type ReceiptInput,
} from "@/lib/receipts";
import { RECEIPT_TEMPLATE_VERSION, buildReceiptPdf, receiptPdfSha256 } from "@/lib/receiptPdf";

const input = (overrides: Partial<ReceiptInput> = {}): ReceiptInput => ({
  kind: "DONATION",
  receivedFrom: "Pat Donor",
  scoutName: "",
  purpose: "",
  season: "",
  amount: "90",
  date: "2026-10-20",
  method: "Zelle",
  status: "FULL",
  issuedByName: "M. Rosen",
  issuedByTitle: "Committee Chair",
  emailTo: "pat@example.com",
  ...overrides,
});

describe("receipt request keys", () => {
  it("are 128 random bits as hex, different every time", () => {
    const keys = new Set(Array.from({ length: 200 }, () => newReceiptRequestKey()));
    assert.equal(keys.size, 200);
    for (const key of keys) assert.ok(isReceiptRequestKey(key), key);
  });

  it("reject anything else", () => {
    for (const value of [undefined, null, 42, "", "abc", "G".repeat(32), "a".repeat(31), "a".repeat(33), `${"a".repeat(31)}\n`]) {
      assert.equal(isReceiptRequestKey(value), false, String(value));
    }
  });
});

describe("validateReceiptInput email", () => {
  it("takes one plain mailbox", () => {
    const result = validateReceiptInput(input({ emailTo: "  pat.parent+pack@example.com " }), { requireEmail: true });
    assert.ok(result.ok);
    assert.equal(result.emailTo, "pat.parent+pack@example.com");
  });

  it("refuses lists, display names, line breaks and oversize addresses", () => {
    for (const emailTo of [
      "a@example.com,b@example.com",
      "a@example.com; b@example.com",
      "Pat <pat@example.com>",
      '"Pat"@example.com',
      "pat@example.com\r\nBcc: x@example.com",
      `${"a".repeat(250)}@example.com`,
    ]) {
      const result = validateReceiptInput(input({ emailTo }), { requireEmail: true });
      assert.equal(result.ok, false, emailTo);
    }
  });

  it("refuses control characters, which isValidEmail's pattern lets through", () => {
    // NUL can't even be stored in Postgres; C1 controls such as U+0085 (NEL)
    // aren't whitespace to a JS regex. All must fail before anything is saved.
    for (const emailTo of ["pat\u0000@example.com", "pat@example.com\u0007", "pat\u0085@example.com", "pat@exa\u009fmple.com", "pat\u007f@example.com"]) {
      assert.equal(isValidReceiptEmail(emailTo), false, JSON.stringify(emailTo));
    }
    for (const emailTo of ["pat\u0000@example.com", "pat\u0085@example.com", "pat@exa\u009fmple.com", "pat\u007f@example.com"]) {
      const result = validateReceiptInput(input({ emailTo }), { requireEmail: true });
      assert.deepEqual(result, { ok: false, error: "That email address doesn't look right." }, JSON.stringify(emailTo));
    }
    // The form cleans C0 controls to spaces like every other field, so one at
    // the very end is trimmed like whitespace: the same address, not another.
    const trailing = validateReceiptInput(input({ emailTo: "pat@example.com\u0007" }), { requireEmail: true });
    assert.ok(trailing.ok && trailing.emailTo === "pat@example.com");
    assert.equal(isValidReceiptEmail("pat@example.com"), true);
  });

  it("never shortens an over-long address into a different one", () => {
    // 260 characters. Cut to its first 200 (as the form's old limit did) it
    // still looks like an address — "…@ex.commmm" — just not the one typed.
    const emailTo = `${"a".repeat(190)}@ex.co${"m".repeat(64)}`;
    assert.equal(validateReceiptInput(input({ emailTo }), { requireEmail: true }).ok, false);
  });
});

describe("receiptFilename", () => {
  it("marks a rebuilt copy", () => {
    const result = validateReceiptInput(input(), { requireEmail: false });
    assert.ok(result.ok);
    assert.equal(receiptFilename(result.data), "Pack376_Donation_Receipt_Pat_Donor_2026-10-20.pdf");
    assert.equal(receiptFilename(result.data, { rebuilt: true }), "Pack376_Donation_Receipt_Pat_Donor_2026-10-20_rebuilt.pdf");
  });
});

describe("sameReceiptData", () => {
  it("compares every printed field", () => {
    const a = validateReceiptInput(input(), { requireEmail: false });
    const b = validateReceiptInput(input({ emailTo: "other@example.com" }), { requireEmail: false });
    const c = validateReceiptInput(input({ amount: "91" }), { requireEmail: false });
    assert.ok(a.ok && b.ok && c.ok);
    assert.equal(sameReceiptData(a.data, b.data), true, "the email address isn't printed");
    assert.equal(sameReceiptData(a.data, c.data), false);
  });
});

describe("buildReceiptPdf", () => {
  it("draws the same receipt into the same file, stamped with its generated time", async () => {
    const result = validateReceiptInput(input({ receivedFrom: `<b>Pat</b> & "Co"` }), { requireEmail: false });
    assert.ok(result.ok);
    const issuedAt = new Date("2026-10-20T22:38:00Z");
    const first = await buildReceiptPdf(result.data, issuedAt);
    const second = await buildReceiptPdf(result.data, issuedAt);
    assert.equal(receiptPdfSha256(first), receiptPdfSha256(second));
    assert.deepEqual(Buffer.from(first), Buffer.from(second));
    assert.match(receiptPdfSha256(first), /^[0-9a-f]{64}$/);
    assert.equal(Buffer.from(first.subarray(0, 5)).toString("latin1"), "%PDF-");

    const later = await buildReceiptPdf(result.data, new Date("2026-10-21T22:38:00Z"));
    assert.notEqual(receiptPdfSha256(first), receiptPdfSha256(later));
    assert.equal(RECEIPT_TEMPLATE_VERSION, 1);
  });
});

describe("emailAttemptView (the history's Emailed to cell)", () => {
  const NOW = Date.parse("2026-10-27T15:00:00Z");
  const ago = (ms: number) => new Date(NOW - ms);
  const KEY = "0123456789abcdef0123456789abcdef";
  const attempt = (over: Partial<Parameters<typeof emailAttemptView>[0] & object> = {}) => ({
    status: "FAILED" as const,
    requestKey: KEY,
    address: "pat@example.com",
    startedAt: ago(60_000),
    providerKeyAt: ago(60_000),
    mayHaveSent: false,
    ...over,
  });

  it("shows nothing to do when there's no request or the latest went out", () => {
    assert.deepEqual(emailAttemptView(undefined, NOW), { state: "done" });
    assert.deepEqual(emailAttemptView(attempt({ status: "SENT" }), NOW), { state: "done" });
    assert.deepEqual(emailAttemptView(attempt({ status: "SENT", mayHaveSent: true }), NOW), { state: "done" });
  });

  it("shows a send under way until it's old enough to count as never finished", () => {
    assert.deepEqual(emailAttemptView(attempt({ status: "PENDING", startedAt: ago(EMAIL_ATTEMPT_STALE_MS - 1) }), NOW), { state: "sending" });
    assert.deepEqual(emailAttemptView(attempt({ status: "PENDING", startedAt: ago(EMAIL_ATTEMPT_STALE_MS) }), NOW), {
      state: "never-finished",
      retryKey: KEY,
    });
  });

  it("offers a retry of the same request for a refusal and for an unconfirmed try", () => {
    assert.deepEqual(emailAttemptView(attempt(), NOW), { state: "failed", retryKey: KEY });
    assert.deepEqual(emailAttemptView(attempt({ mayHaveSent: true }), NOW), { state: "unconfirmed", retryKey: KEY });
    // A refusal is retried under a new Resend key, so its age doesn't matter.
    assert.deepEqual(emailAttemptView(attempt({ providerKeyAt: ago(3 * PROVIDER_KEY_REUSE_MS) }), NOW), { state: "failed", retryKey: KEY });
  });

  it("offers no retry once Resend may have forgotten an unconfirmed try's key", () => {
    const old = ago(PROVIDER_KEY_REUSE_MS);
    assert.deepEqual(emailAttemptView(attempt({ mayHaveSent: true, providerKeyAt: old }), NOW), { state: "too-old" });
    assert.deepEqual(emailAttemptView(attempt({ status: "PENDING", startedAt: old, providerKeyAt: old }), NOW), { state: "too-old" });
    assert.deepEqual(emailAttemptView(attempt({ mayHaveSent: true, providerKeyAt: ago(PROVIDER_KEY_REUSE_MS - 1) }), NOW), {
      state: "unconfirmed",
      retryKey: KEY,
    });
    assert.ok(PROVIDER_KEY_REUSE_MS < 24 * 60 * 60 * 1000, "inside Resend's 24-hour key window");
  });
});
