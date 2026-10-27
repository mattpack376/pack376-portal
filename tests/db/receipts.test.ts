/*
 * Receipts against a real database: one receipt per form submission key, the
 * row (with the issued PDF and a PENDING email status) written before the
 * email is handed to Resend, SENT/FAILED recorded after, and no retry or
 * concurrent request sending the same email twice. Resend is the
 * controllable stand-in from tests/doubles, so failures can be simulated and
 * nothing is ever sent.
 */
import assert from "node:assert/strict";
import { afterEach, before, describe, it, mock } from "node:test";
import { openTransaction, waitForLockWait, withTestDatabase } from "../support/db";
import { gate, resetTestState, runAs, testState, type SessionUser } from "../support/context";
import { installControllableResend, resetResendControl, type ResendCall } from "../doubles/resend";
import { newReceiptRequestKey, type ReceiptInput } from "@/lib/receipts";

const resend = installControllableResend();
const db = withTestDatabase("receipts");
let receipts: typeof import("@/lib/actions/receipts");
let admin: SessionUser;
let juniorAdmin: SessionUser;

before(async () => {
  await db.ready;
  mock.method(console, "error", () => {});
  receipts = await import("@/lib/actions/receipts");
  const a = await db.prisma.user.create({
    data: { username: "receipt-admin", passwordHash: "x", role: "ADMIN", displayName: "Receipt Admin", email: "admin@example.com" },
  });
  const j = await db.prisma.user.create({
    data: { username: "receipt-junior", passwordHash: "x", role: "JUNIOR_ADMIN", displayName: "Junior" },
  });
  admin = { id: a.id, role: "ADMIN", sessionVersion: 0 };
  juniorAdmin = { id: j.id, role: "JUNIOR_ADMIN", sessionVersion: 0 };
});

afterEach(async () => {
  resetTestState();
  resetResendControl(resend);
  process.env.RESEND_API_KEY ??= "re_test_only";
});

const ADDRESS = "donor@example.com";

const input = (overrides: Partial<ReceiptInput> = {}): ReceiptInput => ({
  kind: "DONATION",
  receivedFrom: `Pat <b>Donor</b> & "Co"`,
  scoutName: "",
  purpose: "",
  season: "",
  amount: "90",
  date: "2026-10-20",
  method: "Zelle",
  status: "FULL",
  issuedByName: "M. Rosen",
  issuedByTitle: "Committee Chair",
  emailTo: ADDRESS,
  ...overrides,
});

const generate = (key: string, data = input()) => runAs(admin, () => receipts.generateReceiptAction(data, key));
const emailIt = (key: string, data = input()) => runAs(admin, () => receipts.emailReceiptAction(data, key));
const resendIt = (id: string, key: string, to = ADDRESS) => runAs(admin, () => receipts.resendReceiptAction(id, to, key));

const byKey = (key: string) => db.prisma.receipt.findUniqueOrThrow({ where: { idempotencyKey: key }, include: { document: true } });
const attachmentOf = (call: ResendCall | undefined) => call?.message?.attachments?.[0];

async function until(condition: () => boolean, what: string) {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > 5000) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("saving a receipt (Download)", () => {
  it("saves one receipt per key, with the issued PDF, and returns that same file on a retry", async () => {
    const key = newReceiptRequestKey();
    const first = await generate(key);
    const second = await generate(key);
    assert.ok(first.ok && second.ok);
    assert.equal(second.id, first.id);
    assert.equal(second.pdfBase64, first.pdfBase64, "the stored file, not a redraw");
    assert.equal(first.rebuilt, false);

    const row = await byKey(key);
    assert.equal(await db.prisma.receipt.count({ where: { idempotencyKey: key } }), 1);
    assert.ok(row.document);
    assert.equal(Buffer.from(row.document.pdf).toString("base64"), first.pdfBase64);
    assert.match(row.document.sha256, /^[0-9a-f]{64}$/);
    assert.equal(row.document.templateVersion, 1);
    assert.equal(row.emailStatus, null);
    assert.equal(await db.prisma.auditLog.count({ where: { action: "receipt.generate", entityId: row.id } }), 1);
  });

  it("a new key is a new receipt; a key reused with different details is refused", async () => {
    const key = newReceiptRequestKey();
    const first = await generate(key);
    const other = await generate(newReceiptRequestKey());
    assert.ok(first.ok && other.ok);
    assert.notEqual(other.id, first.id);

    const changed = await generate(key, input({ amount: "91" }));
    assert.deepEqual(changed, { ok: false, error: "This page is out of date. Reload it and try again." });
    assert.equal((await byKey(key)).amountCents, 9000);
  });

  it("refuses a missing or malformed key and non-Admins", async () => {
    const before = await db.prisma.receipt.count();
    for (const key of ["", "abc", "Z".repeat(32), `${newReceiptRequestKey()}x`]) {
      assert.equal((await generate(key)).ok, false, key);
    }
    await assert.rejects(runAs(juniorAdmin, () => receipts.generateReceiptAction(input(), newReceiptRequestKey())), /Not authorized/);
    await assert.rejects(runAs(juniorAdmin, () => receipts.emailReceiptAction(input(), newReceiptRequestKey())), /Not authorized/);
    assert.equal(await db.prisma.receipt.count(), before);
  });

  it("two saves with one key that wait on each other leave one receipt (holder commits)", async () => {
    const key = newReceiptRequestKey();
    const holder = await openTransaction(db.pool);
    try {
      // The other request's insert, not yet committed: same key, same details.
      await holder.query(
        `INSERT INTO "Receipt" ("id","kind","receivedFrom","purpose","amountCents","receiptDate","method","issuedByName","issuedByTitle","idempotencyKey")
         VALUES ('holder-receipt','DONATION',$1,'Monetary donation',9000,'2026-10-20','Zelle','M. Rosen','Committee Chair',$2)`,
        [input().receivedFrom, key]
      );
      const pending = generate(key);
      await waitForLockWait(db.pool); // blocked on the unique key
      await holder.commit();
      const result = await pending;
      assert.ok(result.ok);
      assert.equal(result.id, "holder-receipt", "the loser returns the winner's receipt");
    } finally {
      await holder.rollback();
    }
    assert.equal(await db.prisma.receipt.count({ where: { idempotencyKey: key } }), 1);
  });

  it("... and when the other insert rolls back, this one saves", async () => {
    const key = newReceiptRequestKey();
    const holder = await openTransaction(db.pool);
    try {
      await holder.query(
        `INSERT INTO "Receipt" ("id","kind","receivedFrom","purpose","amountCents","receiptDate","issuedByName","idempotencyKey")
         VALUES ('holder-rolled-back','DONATION','x','x',1,'2026-10-20','x',$1)`,
        [key]
      );
      const pending = generate(key);
      await waitForLockWait(db.pool);
      await holder.rollback();
      const result = await pending;
      assert.ok(result.ok);
      assert.notEqual(result.id, "holder-rolled-back");
    } finally {
      await holder.rollback();
    }
    assert.equal((await byKey(key)).amountCents, 9000);
  });

  it("stress: two saves with one key at once always make one receipt", async () => {
    for (let i = 0; i < 20; i++) {
      const key = newReceiptRequestKey();
      const [a, b] = await Promise.all([generate(key), generate(key)]);
      assert.ok(a.ok && b.ok, `iteration ${i}`);
      assert.equal(a.id, b.id);
      assert.equal(a.pdfBase64, b.pdfBase64);
      assert.equal(await db.prisma.receipt.count({ where: { idempotencyKey: key } }), 1);
      assert.equal(await db.prisma.auditLog.count({ where: { action: "receipt.generate", entityId: a.id } }), 1);
    }
  });
});

describe("emailing a receipt", () => {
  it("writes the receipt, its PDF and PENDING before handing the email to Resend, with no transaction open", async () => {
    const key = newReceiptRequestKey();
    let seenMidSend: { emailStatus: string; emailAttemptTo: string; emailAttemptId: string; hasDocument: boolean } | undefined;
    let openTransactions = -1;
    resend.queue.push({
      beforeResult: async () => {
        const { rows } = await db.pool.query(
          `SELECT r."emailStatus", r."emailAttemptTo", r."emailAttemptId", d."receiptId" IS NOT NULL AS "hasDocument"
             FROM "Receipt" r LEFT JOIN "ReceiptDocument" d ON d."receiptId" = r."id" WHERE r."idempotencyKey" = $1`,
          [key]
        );
        seenMidSend = rows[0];
        const open = await db.pool.query(
          `SELECT count(*)::int AS n FROM pg_stat_activity
            WHERE datname = current_database() AND state LIKE 'idle in transaction%' AND pid <> pg_backend_pid()`
        );
        openTransactions = open.rows[0].n;
      },
    });

    const result = await emailIt(key);
    assert.deepEqual(result, { ok: true, id: (await byKey(key)).id, sentTo: ADDRESS });
    assert.deepEqual(seenMidSend && { ...seenMidSend, emailAttemptId: typeof seenMidSend.emailAttemptId }, {
      emailStatus: "PENDING",
      emailAttemptTo: ADDRESS,
      emailAttemptId: "string",
      hasDocument: true,
    });
    assert.equal(openTransactions, 0, "no lock is held while the email goes out");

    const row = await byKey(key);
    assert.equal(row.emailStatus, "SENT");
    assert.equal(row.emailedTo, ADDRESS);
    assert.ok(row.emailedAt);
    assert.equal(row.emailError, null);

    const call = resend.calls[0];
    assert.equal(call.message?.to, ADDRESS);
    assert.equal(call.message?.bcc, "matt.pack376@gmail.com", "the records copy is unchanged");
    assert.equal(call.message?.replyTo, "admin@example.com");
    assert.equal(call.options?.idempotencyKey, `pack376-receipt/${row.id}/${row.emailAttemptId}`);
    assert.ok(row.document);
    assert.deepEqual(attachmentOf(call)?.content, Buffer.from(row.document.pdf), "the stored PDF is what was attached");
    assert.ok(!(call.message?.html ?? "").includes("<b>Donor</b>"), "the donor name is escaped");
    assert.equal(await db.prisma.auditLog.count({ where: { action: "receipt.email", entityId: row.id } }), 1);
  });

  it("the same key twice: one receipt, one email; the retry says it was already sent", async () => {
    const key = newReceiptRequestKey();
    const first = await emailIt(key);
    const retry = await emailIt(key);
    assert.ok(first.ok && retry.ok);
    assert.equal(retry.id, first.id);
    assert.equal(retry.alreadySent, true);
    assert.equal(testState.emails.length, 1);
    assert.equal(await db.prisma.receipt.count({ where: { idempotencyKey: key } }), 1);
  });

  it("Download then Email of the same form is one receipt, and the email carries the downloaded file", async () => {
    const key = newReceiptRequestKey();
    const downloaded = await generate(key);
    const emailed = await emailIt(key);
    assert.ok(downloaded.ok && emailed.ok);
    assert.equal(emailed.id, downloaded.id);
    assert.equal(attachmentOf(resend.calls[0])?.content.toString("base64"), downloaded.pdfBase64);
    assert.equal(await db.prisma.receipt.count({ where: { idempotencyKey: key } }), 1);
  });

  it("records FAILED with Resend's reason (shortened), keeps the receipt, and a retry sends it", async () => {
    const key = newReceiptRequestKey();
    resend.queue.push({ error: { name: "validation_error", message: `The domain is not verified. ${"x".repeat(5000)}`, statusCode: 403 } });
    const failed = await emailIt(key);
    assert.equal(failed.ok, false);
    assert.match(failed.ok ? "" : failed.error, /^Saved to the history below, but the email to donor@example\.com didn't go out \(The domain is not verified\./);
    assert.equal(testState.emails.length, 0);

    const row = await byKey(key);
    assert.equal(row.emailStatus, "FAILED");
    assert.equal(row.emailedTo, null, "never shown as emailed");
    assert.equal(row.emailAttemptTo, ADDRESS);
    assert.ok(row.emailError?.startsWith("The domain is not verified."));
    assert.ok((row.emailError?.length ?? 0) <= 500);
    assert.ok(row.document, "the receipt and its PDF are saved even though the email failed");
    assert.equal(await db.prisma.auditLog.count({ where: { action: "receipt.emailFailed", entityId: row.id } }), 1);

    const retry = await emailIt(key);
    assert.ok(retry.ok && !retry.alreadySent);
    assert.equal(testState.emails.length, 1);
    const after = await byKey(key);
    assert.equal(after.emailStatus, "SENT");
    assert.equal(after.emailError, null);
    assert.notEqual(after.emailAttemptId, row.emailAttemptId, "a new attempt, with its own Resend key");
    assert.notEqual(resend.calls[1].options?.idempotencyKey, resend.calls[0].options?.idempotencyKey);
  });

  it("records FAILED when the Resend call throws (a dropped connection)", async () => {
    const key = newReceiptRequestKey();
    resend.queue.push({ throws: new Error("socket hang up") });
    const result = await emailIt(key);
    assert.equal(result.ok, false);
    const row = await byKey(key);
    assert.equal(row.emailStatus, "FAILED");
    assert.equal(row.emailError, "socket hang up");
  });

  it("a request arriving while the same receipt is mid-send doesn't send", async () => {
    const key = newReceiptRequestKey();
    const release = gate();
    resend.queue.push({ beforeResult: () => release.wait });
    const first = emailIt(key);
    await until(() => resend.calls.length === 1, "the first send to reach Resend");

    const sameKey = await emailIt(key);
    assert.equal(sameKey.ok, false);
    assert.match(sameKey.ok ? "" : sameKey.error, /being emailed right now/);
    const id = (await byKey(key)).id;
    const otherKey = await resendIt(id, newReceiptRequestKey());
    assert.match(otherKey.ok ? "" : otherKey.error, /being emailed right now/);
    assert.equal(resend.calls.length, 1);

    release.open();
    assert.ok((await first).ok);
    const later = await emailIt(key);
    assert.ok(later.ok && later.alreadySent);
    assert.equal(testState.emails.length, 1);
  });

  it("waits for another request holding the receipt, then sees it already sent (holder commits)", async () => {
    const key = newReceiptRequestKey();
    const saved = await generate(key);
    assert.ok(saved.ok);
    const holder = await openTransaction(db.pool);
    try {
      // The same request, retried elsewhere, finishing its send right now.
      await holder.query(`SELECT "id" FROM "Receipt" WHERE "id" = $1 FOR UPDATE`, [saved.id]);
      const pending = emailIt(key);
      await waitForLockWait(db.pool);
      await holder.query(
        `UPDATE "Receipt" SET "emailStatus" = 'SENT', "emailAttemptKey" = $2, "emailAttemptTo" = $3, "emailAttemptId" = 'other',
                "emailAttemptAt" = now(), "emailedTo" = $3, "emailedAt" = now() WHERE "id" = $1`,
        [saved.id, key, ADDRESS]
      );
      await holder.commit();
      const result = await pending;
      assert.ok(result.ok && result.alreadySent);
    } finally {
      await holder.rollback();
    }
    assert.equal(resend.calls.length, 0, "nothing sent a second time");
  });

  it("... and sends once when the holder rolls back", async () => {
    const key = newReceiptRequestKey();
    const saved = await generate(key);
    assert.ok(saved.ok);
    const holder = await openTransaction(db.pool);
    try {
      await holder.query(`SELECT "id" FROM "Receipt" WHERE "id" = $1 FOR UPDATE`, [saved.id]);
      const pending = emailIt(key);
      await waitForLockWait(db.pool);
      await holder.rollback();
      const result = await pending;
      assert.ok(result.ok && !result.alreadySent);
    } finally {
      await holder.rollback();
    }
    assert.equal(resend.calls.length, 1);
  });

  it("an attempt that never finished isn't re-sent by the same request; a deliberate Resend can send", async () => {
    const key = newReceiptRequestKey();
    const saved = await generate(key);
    assert.ok(saved.ok);
    await db.prisma.receipt.update({
      where: { id: saved.id },
      data: {
        emailStatus: "PENDING",
        emailAttemptKey: key,
        emailAttemptTo: ADDRESS,
        emailAttemptId: "crashed",
        emailAttemptAt: new Date(Date.now() - 16 * 60 * 1000),
      },
    });
    const retry = await emailIt(key);
    assert.match(retry.ok ? "" : retry.error, /never finished, so it may or may not have gone out/);
    assert.equal(resend.calls.length, 0);

    const deliberate = await resendIt(saved.id, newReceiptRequestKey());
    assert.ok(deliberate.ok);
    assert.equal(resend.calls.length, 1);
    assert.equal((await byKey(key)).emailStatus, "SENT");
  });

  it("stress: the same Email twice at once sends exactly one email", async () => {
    for (let i = 0; i < 20; i++) {
      const key = newReceiptRequestKey();
      const sentBefore = testState.emails.length;
      const results = await Promise.all([emailIt(key), emailIt(key)]);
      assert.equal(testState.emails.length - sentBefore, 1, `iteration ${i}`);
      assert.equal(await db.prisma.receipt.count({ where: { idempotencyKey: key } }), 1);
      // One sent it; the other was told it already went, or is going, out.
      const fresh = results.filter((r) => r.ok && !r.alreadySent);
      assert.equal(fresh.length, 1, `iteration ${i}: ${JSON.stringify(results)}`);
      assert.equal((await byKey(key)).emailStatus, "SENT");
    }
  });

  it("checks the address and email setup before saving anything", async () => {
    const before = await db.prisma.receipt.count();
    for (const emailTo of ["a@example.com, b@example.com", "Pat <pat@example.com>", "pat@example.com\r\nBcc: x@example.com"]) {
      assert.equal((await emailIt(newReceiptRequestKey(), input({ emailTo }))).ok, false, emailTo);
    }
    const key = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    try {
      const result = await emailIt(newReceiptRequestKey());
      assert.deepEqual(result, { ok: false, error: "Email isn't set up on the server yet. Use Download PDF and send it yourself." });
    } finally {
      process.env.RESEND_API_KEY = key;
    }
    assert.equal(await db.prisma.receipt.count(), before);
    assert.equal(resend.calls.length, 0);
  });
});

describe("history: Resend, Download, Delete", () => {
  it("Resend sends the stored PDF; a retried Send with the same key doesn't send twice", async () => {
    const saved = await generate(newReceiptRequestKey());
    assert.ok(saved.ok);
    const key = newReceiptRequestKey();
    const first = await resendIt(saved.id, key, "other@example.com");
    const retried = await resendIt(saved.id, key, "other@example.com");
    assert.ok(first.ok && retried.ok);
    assert.equal(retried.alreadySent, true);
    assert.equal(resend.calls.length, 1);
    assert.equal(attachmentOf(resend.calls[0])?.content.toString("base64"), saved.pdfBase64);

    // Reopening Resend (a new key) is a deliberate second copy.
    assert.ok((await resendIt(saved.id, newReceiptRequestKey(), "other@example.com")).ok);
    assert.equal(resend.calls.length, 2);
    const row = await db.prisma.receipt.findUniqueOrThrow({ where: { id: saved.id } });
    assert.equal(row.emailedTo, "other@example.com");
    assert.equal(await db.prisma.auditLog.count({ where: { action: "receipt.email", entityId: saved.id } }), 2);
  });

  it("Resend refuses a bad address before anything changes", async () => {
    const saved = await generate(newReceiptRequestKey());
    assert.ok(saved.ok);
    for (const to of ["", "a@example.com; b@example.com", "Pat <pat@example.com>"]) {
      assert.equal((await resendIt(saved.id, newReceiptRequestKey(), to)).ok, false, to);
    }
    assert.equal(resend.calls.length, 0);
    assert.equal((await db.prisma.receipt.findUniqueOrThrow({ where: { id: saved.id } })).emailStatus, null);
  });

  it("downloads the stored PDF exactly as issued", async () => {
    const saved = await generate(newReceiptRequestKey());
    assert.ok(saved.ok);
    const download = await runAs(admin, () => receipts.downloadSavedReceiptAction(saved.id));
    assert.ok(download.ok);
    assert.equal(download.pdfBase64, saved.pdfBase64);
    assert.equal(download.rebuilt, false);
    assert.doesNotMatch(download.filename, /_rebuilt/);
  });

  it("a receipt saved before PDFs were kept downloads as a labeled rebuild", async () => {
    const legacy = await db.prisma.receipt.create({
      data: {
        kind: "DUES",
        receivedFrom: "Legacy Parent",
        scoutName: "Sam",
        purpose: "Annual Cub Scout dues",
        season: "2025–2026",
        amountCents: 10000,
        receiptDate: new Date("2025-09-01T00:00:00Z"),
        method: "Cash",
        status: "FULL",
        issuedByName: "M. Rosen",
        createdAt: new Date("2025-09-01T22:00:00Z"),
        emailedTo: "legacy@example.com",
        emailedAt: new Date("2025-09-01T22:00:00Z"),
      },
    });
    const first = await runAs(admin, () => receipts.downloadSavedReceiptAction(legacy.id));
    const second = await runAs(admin, () => receipts.downloadSavedReceiptAction(legacy.id));
    assert.ok(first.ok && second.ok);
    assert.equal(first.rebuilt, true);
    assert.match(first.filename, /_rebuilt\.pdf$/);
    assert.equal(second.pdfBase64, first.pdfBase64, "rebuilt the same way each time");

    assert.ok((await resendIt(legacy.id, newReceiptRequestKey(), "legacy@example.com")).ok);
    assert.doesNotMatch(attachmentOf(resend.calls[0])?.filename ?? "", /_rebuilt/, "the family's copy keeps its usual name");
    assert.equal(await db.prisma.receiptDocument.count({ where: { receiptId: legacy.id } }), 0, "a rebuild is never stored as the issued copy");
  });

  it("never serves or sends a stored PDF that fails its checksum", async () => {
    const saved = await generate(newReceiptRequestKey());
    assert.ok(saved.ok);
    await db.pool.query(`UPDATE "ReceiptDocument" SET "pdf" = 'tampered'::bytea WHERE "receiptId" = $1`, [saved.id]);
    const download = await runAs(admin, () => receipts.downloadSavedReceiptAction(saved.id));
    assert.equal(download.ok, false);
    assert.match(download.ok ? "" : download.error, /failed its integrity check/);
    const sent = await resendIt(saved.id, newReceiptRequestKey());
    assert.equal(sent.ok, false);
    assert.equal(resend.calls.length, 0);
  });

  it("delete removes the receipt and its PDF, with the audit entry in the same transaction", async () => {
    const saved = await generate(newReceiptRequestKey());
    assert.ok(saved.ok);
    assert.deepEqual(await runAs(admin, () => receipts.deleteReceiptAction(saved.id)), { ok: true });
    assert.equal(await db.prisma.receipt.count({ where: { id: saved.id } }), 0);
    assert.equal(await db.prisma.receiptDocument.count({ where: { receiptId: saved.id } }), 0);
    const entry = await db.prisma.auditLog.findFirstOrThrow({ where: { action: "receipt.delete", entityId: saved.id } });
    assert.match(entry.summary, /^Deleted a donation receipt for Pat <b>Donor<\/b> & "Co" \(\$90\.00\) dated 2026-10-20$/);
    assert.deepEqual(await runAs(admin, () => receipts.deleteReceiptAction(saved.id)), { ok: false, error: "That receipt was already deleted." });
    await assert.rejects(runAs(juniorAdmin, () => receipts.deleteReceiptAction("anything")), /Not authorized/);
  });
});
