/*
 * The receipt helpers shared by the form and the actions, and the PDF
 * builder's stored-copy support: request keys, the one-mailbox email rule,
 * the "rebuilt" file name, and a PDF that's the same file when drawn twice.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isReceiptRequestKey,
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
