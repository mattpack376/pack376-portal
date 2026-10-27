/*
 * Receipts against a real database: one receipt per form submission key, the
 * row (with the issued PDF) and a PENDING email request written before the
 * email is handed to Resend, SENT/FAILED recorded after, and no retry or
 * concurrent request sending the same email twice — whatever other sends of
 * the receipt happen in between, and even when Resend's answer is lost.
 * Resend is the controllable stand-in from tests/doubles (which keeps
 * Resend's idempotency-key rule), so failures can be simulated and nothing is
 * ever sent.
 */
import assert from "node:assert/strict";
import { afterEach, before, describe, it, mock } from "node:test";
import { openTransaction, waitForLockWait, withTestDatabase } from "../support/db";
import { gate, resetTestState, runAs, testState, type SessionUser } from "../support/context";
import { installControllableResend, resetResendControl, type ResendCall } from "../doubles/resend";
import { emailAttemptView, newReceiptRequestKey, type ReceiptInput } from "@/lib/receipts";

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
const attemptsOf = (receiptId: string) =>
  db.prisma.receiptEmailAttempt.findMany({ where: { receiptId }, orderBy: { createdAt: "asc" } });
async function onlyAttempt(receiptId: string) {
  const attempts = await attemptsOf(receiptId);
  assert.equal(attempts.length, 1, "one email request");
  return attempts[0];
}
/** Who actually got an email: what went out, not what was tried. */
const delivered = () => testState.emails.map((m) => m.to);
const keysSent = () => resend.calls.map((c) => c.options?.idempotencyKey);
const deleteIt = (id: string) => runAs(admin, () => receipts.deleteReceiptAction(id));

/**
 * The current time as Prisma stores it in a timestamp-without-time-zone
 * column (UTC). Plain now() would be cast in the session's time zone.
 */
const UTC_NOW = `(now() AT TIME ZONE 'UTC')`;

/** The SDK's answer for a connection that dropped (it returns this rather than throwing). */
const DROPPED = { name: "application_error", statusCode: null, message: "Unable to fetch data. The request could not be resolved." };

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
    assert.equal((await attemptsOf(row.id)).length, 0, "no email request");
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
    let seenMidSend: { status: string; address: string; providerKey: string; hasDocument: boolean } | undefined;
    let openTransactions = -1;
    resend.queue.push({
      beforeResult: async () => {
        const { rows } = await db.pool.query(
          `SELECT a."status", a."address", a."providerKey", d."receiptId" IS NOT NULL AS "hasDocument"
             FROM "Receipt" r
             JOIN "ReceiptEmailAttempt" a ON a."receiptId" = r."id"
             LEFT JOIN "ReceiptDocument" d ON d."receiptId" = r."id"
            WHERE r."idempotencyKey" = $1`,
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
    assert.deepEqual(seenMidSend && { ...seenMidSend, providerKey: typeof seenMidSend.providerKey }, {
      status: "PENDING",
      address: ADDRESS,
      providerKey: "string",
      hasDocument: true,
    });
    assert.equal(openTransactions, 0, "no lock is held while the email goes out");

    const row = await byKey(key);
    assert.equal(row.emailedTo, ADDRESS);
    assert.ok(row.emailedAt);
    const attempt = await onlyAttempt(row.id);
    assert.equal(attempt.status, "SENT");
    assert.equal(attempt.requestKey, key);
    assert.equal(attempt.error, null);
    assert.equal(attempt.mayHaveSent, false);
    assert.ok(attempt.finishedAt);

    const call = resend.calls[0];
    assert.equal(call.message?.to, ADDRESS);
    assert.equal(call.message?.bcc, "matt.pack376@gmail.com", "the records copy is unchanged");
    assert.equal(call.message?.replyTo, "admin@example.com");
    assert.equal(call.options?.idempotencyKey, attempt.providerKey);
    assert.match(attempt.providerKey, new RegExp(`^pack376-receipt/${row.id}/${attempt.id}/1$`));
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
    assert.equal(row.emailedTo, null, "never shown as emailed");
    const attempt = await onlyAttempt(row.id);
    assert.equal(attempt.status, "FAILED");
    assert.equal(attempt.address, ADDRESS);
    assert.equal(attempt.mayHaveSent, false, "Resend refused it, so it didn't go out");
    assert.ok(attempt.error?.startsWith("The domain is not verified."));
    assert.ok((attempt.error?.length ?? 0) <= 500);
    assert.ok(row.document, "the receipt and its PDF are saved even though the email failed");
    assert.equal(await db.prisma.auditLog.count({ where: { action: "receipt.emailFailed", entityId: row.id } }), 1);

    const retry = await emailIt(key);
    assert.ok(retry.ok && !retry.alreadySent);
    assert.equal(testState.emails.length, 1);
    const after = await onlyAttempt(row.id);
    assert.equal(after.status, "SENT");
    assert.equal(after.error, null);
    assert.equal(after.tryCount, 2);
    assert.notEqual(resend.calls[1].options?.idempotencyKey, resend.calls[0].options?.idempotencyKey, "a refused try's key isn't reused");
    assert.equal((await byKey(key)).emailedTo, ADDRESS);
  });

  it("records FAILED, as unconfirmed, when the Resend call throws", async () => {
    const key = newReceiptRequestKey();
    resend.queue.push({ throws: new Error("socket hang up") });
    const result = await emailIt(key);
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.error, /Resend didn't confirm whether the email to donor@example\.com went out \(socket hang up\)\. Press Email again/);
    const attempt = await onlyAttempt((await byKey(key)).id);
    assert.equal(attempt.status, "FAILED");
    assert.equal(attempt.error, "socket hang up");
    assert.equal(attempt.mayHaveSent, true);
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
      // The same request, retried elsewhere, recording its send right now.
      await holder.query(`SELECT "id" FROM "Receipt" WHERE "id" = $1 FOR UPDATE`, [saved.id]);
      const pending = emailIt(key);
      await waitForLockWait(db.pool);
      await holder.query(
        `INSERT INTO "ReceiptEmailAttempt" ("id","receiptId","requestKey","address","addressKey","status","providerKey","providerKeyAt","startedAt","finishedAt")
         VALUES ('holder-attempt',$1,$2,$3,lower($3),'SENT','holder-key',${UTC_NOW},${UTC_NOW},${UTC_NOW})`,
        [saved.id, key, ADDRESS]
      );
      await holder.query(`UPDATE "Receipt" SET "emailedTo" = $2, "emailedAt" = now() WHERE "id" = $1`, [saved.id, ADDRESS]);
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

  it("a send that never finished (server stopped after Resend took it) is retried under its own key: no second copy", async () => {
    const key = newReceiptRequestKey();
    // Resend takes the email, then the answer is lost...
    resend.queue.push({ delivered: true, throws: new Error("socket hang up") });
    assert.equal((await emailIt(key)).ok, false);
    const id = (await byKey(key)).id;
    // ...and, as if the server had stopped right there, nothing was recorded after the PENDING claim.
    await db.prisma.receiptEmailAttempt.updateMany({
      where: { receiptId: id },
      data: { status: "PENDING", error: null, finishedAt: null, mayHaveSent: false, startedAt: new Date(Date.now() - 16 * 60 * 1000) },
    });

    const retry = await emailIt(key);
    assert.ok(retry.ok && !retry.alreadySent, JSON.stringify(retry));
    assert.deepEqual(delivered(), [ADDRESS], "Resend matched the key and didn't send it again");
    assert.equal(keysSent().length, 2);
    assert.equal(keysSent()[1], keysSent()[0]);
    const attempt = await onlyAttempt(id);
    assert.equal(attempt.status, "SENT");
    assert.equal(attempt.mayHaveSent, true, "kept: it was unconfirmed once");
    assert.equal((await byKey(key)).emailedTo, ADDRESS);
  });

  it("a send that never finished and is too old for Resend to remember isn't retried; a deliberate Resend can send", async () => {
    const key = newReceiptRequestKey();
    const saved = await generate(key);
    assert.ok(saved.ok);
    const longAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await db.prisma.receiptEmailAttempt.create({
      data: {
        receiptId: saved.id,
        requestKey: key,
        address: ADDRESS,
        addressKey: ADDRESS,
        status: "PENDING",
        providerKey: "crashed-key",
        providerKeyAt: longAgo,
        startedAt: longAgo,
      },
    });
    const retry = await emailIt(key);
    assert.match(retry.ok ? "" : retry.error, /was never confirmed, and it's too long ago to retry safely, so it may or may not have gone out/);
    assert.equal(resend.calls.length, 0);

    const deliberate = await resendIt(saved.id, newReceiptRequestKey());
    assert.ok(deliberate.ok);
    assert.equal(resend.calls.length, 1);
    assert.notEqual(keysSent()[0], "crashed-key");
    assert.equal((await byKey(key)).emailedTo, ADDRESS);
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
      assert.equal((await onlyAttempt((await byKey(key)).id)).status, "SENT");
    }
  });

  it("checks the address and email setup before saving anything", async () => {
    const before = await db.prisma.receipt.count();
    for (const emailTo of [
      "a@example.com, b@example.com",
      "Pat <pat@example.com>",
      "pat@example.com\r\nBcc: x@example.com",
      "pat\u0085@example.com",
      "pat\u0000@example.com",
      `${"p".repeat(250)}@example.com`,
    ]) {
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
    for (const to of [
      "",
      "a@example.com; b@example.com",
      "Pat <pat@example.com>",
      // Control characters: a NUL can't even be stored, so these must be
      // turned away with a readable error before any write, not crash.
      "a\u0000b@example.com",
      "pat\u0085@example.com",
      "pat@example.com\u0007",
    ]) {
      const result = await resendIt(saved.id, newReceiptRequestKey(), to);
      assert.equal(result.ok, false, JSON.stringify(to));
      assert.match(result.ok ? "" : result.error, /^(Enter the email address|That email address doesn't look right)/);
    }
    assert.equal(resend.calls.length, 0);
    assert.equal((await attemptsOf(saved.id)).length, 0);
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

describe("one request, one email — whatever happens in between", () => {
  it("the form's key to a second address and back: the first address isn't emailed twice", async () => {
    const key = newReceiptRequestKey();
    const first = await emailIt(key, input({ emailTo: "a@example.com" }));
    const second = await emailIt(key, input({ emailTo: "b@example.com" }));
    const again = await emailIt(key, input({ emailTo: "a@example.com" }));
    const otherCase = await emailIt(key, input({ emailTo: "A@Example.COM" }));
    assert.ok(first.ok && !first.alreadySent);
    assert.ok(second.ok && !second.alreadySent, "changing only the address emails the same receipt there");
    assert.deepEqual(again, { ok: true, id: first.id, sentTo: "a@example.com", alreadySent: true });
    assert.deepEqual(otherCase, { ok: true, id: first.id, sentTo: "a@example.com", alreadySent: true });
    assert.deepEqual(delivered(), ["a@example.com", "b@example.com"]);
    assert.equal((await attemptsOf(first.id)).length, 2);
  });

  it("a failed Resend in between doesn't make the form's retry send again", async () => {
    const key = newReceiptRequestKey();
    const first = await emailIt(key);
    assert.ok(first.ok);
    resend.queue.push({ error: { name: "validation_error", statusCode: 422, message: "Invalid `to` field." } });
    assert.equal((await resendIt(first.id, newReceiptRequestKey(), "b@example.com")).ok, false);
    const again = await emailIt(key);
    assert.deepEqual(again, { ok: true, id: first.id, sentTo: ADDRESS, alreadySent: true });
    assert.deepEqual(delivered(), [ADDRESS]);
  });

  it("a deliberate Resend in between doesn't make the form's retry send a third copy", async () => {
    const key = newReceiptRequestKey();
    const first = await emailIt(key);
    assert.ok(first.ok);
    assert.ok((await resendIt(first.id, newReceiptRequestKey(), ADDRESS)).ok, "a deliberate second copy");
    const again = await emailIt(key);
    assert.ok(again.ok && again.alreadySent);
    assert.deepEqual(delivered(), [ADDRESS, ADDRESS]);
  });

  it("Resend's answer lost after it sent: the retry reuses the key, address spelling and reply-to, so no second copy", async () => {
    const key = newReceiptRequestKey();
    resend.queue.push({ delivered: true, error: DROPPED });
    const lost = await emailIt(key, input({ emailTo: "Donor@Example.com" }));
    assert.equal(lost.ok, false);
    assert.match(lost.ok ? "" : lost.error, /^Saved to the history below, but Resend didn't confirm whether the email to Donor@Example\.com went out \(Unable to fetch data/);
    const id = (await byKey(key)).id;
    const unconfirmed = await onlyAttempt(id);
    assert.equal(unconfirmed.status, "FAILED");
    assert.equal(unconfirmed.mayHaveSent, true);
    assert.equal(unconfirmed.replyTo, "admin@example.com");
    assert.equal((await byKey(key)).emailedTo, null);

    // In between, the Admin's own address changes and they retype the
    // recipient in lower case: the retry still sends the identical message.
    await db.prisma.user.update({ where: { id: admin.id }, data: { email: "changed-admin@example.com" } });
    try {
      const retry = await emailIt(key, input({ emailTo: "donor@example.com" }));
      assert.deepEqual(retry, { ok: true, id, sentTo: "Donor@Example.com" });
    } finally {
      await db.prisma.user.update({ where: { id: admin.id }, data: { email: "admin@example.com" } });
    }
    assert.deepEqual(delivered(), ["Donor@Example.com"], "Resend matched the key and returned the first result");
    assert.equal(keysSent()[1], keysSent()[0]);
    assert.equal(resend.calls[1].message?.replyTo, "admin@example.com");
    const after = await onlyAttempt(id);
    assert.equal(after.status, "SENT");
    assert.equal(after.tryCount, 2);
    assert.equal((await byKey(key)).emailedTo, "Donor@Example.com");
    const entry = await db.prisma.auditLog.findFirstOrThrow({ where: { action: "receipt.email", entityId: id } });
    assert.match(entry.summary, /a retry of an unconfirmed try, under the same Resend key, so at most one copy went out/);
  });

  it("an unconfirmed try that never reached Resend: the retry, under the same key, sends it once", async () => {
    const key = newReceiptRequestKey();
    resend.queue.push({ error: DROPPED });
    assert.equal((await emailIt(key)).ok, false);
    const retry = await emailIt(key);
    assert.ok(retry.ok && !retry.alreadySent);
    assert.deepEqual(delivered(), [ADDRESS]);
    assert.equal(keysSent()[1], keysSent()[0]);
  });

  it("server errors and key clashes count as unconfirmed; a named refusal doesn't", async () => {
    const cases = [
      { error: { name: "internal_server_error", statusCode: 500, message: "Internal server error" }, unconfirmed: true },
      { error: { name: "concurrent_idempotent_requests", statusCode: 409, message: "In progress" }, unconfirmed: true },
      { error: { name: "rate_limit_exceeded", statusCode: 429, message: "Too many requests" }, unconfirmed: false },
      { error: { name: "validation_error", statusCode: 422, message: "Invalid `to` field." }, unconfirmed: false },
    ];
    for (const { error, unconfirmed } of cases) {
      const key = newReceiptRequestKey();
      resend.queue.push({ error });
      const result = await emailIt(key);
      assert.equal(result.ok, false);
      const attempt = await onlyAttempt((await byKey(key)).id);
      assert.equal(attempt.mayHaveSent, unconfirmed, error.name);
      assert.match(result.ok ? "" : result.error, unconfirmed ? /didn't confirm whether/ : /didn't go out/, error.name);
    }
  });

  it("once a try may have gone out, a later refusal doesn't free the request to use a new key", async () => {
    const key = newReceiptRequestKey();
    resend.queue.push({ delivered: true, throws: new Error("socket hang up") });
    assert.equal((await emailIt(key)).ok, false);
    resend.queue.push({ error: { name: "rate_limit_exceeded", statusCode: 429, message: "Too many requests" } });
    const refused = await emailIt(key);
    assert.equal(refused.ok, false);
    // The earlier try is still unaccounted for, so this isn't "didn't go out".
    assert.match(refused.ok ? "" : refused.error, /Resend didn't confirm whether the email to donor@example\.com went out \(Too many requests\)\. Press Email again/);
    const id = (await byKey(key)).id;
    assert.equal((await onlyAttempt(id)).mayHaveSent, true, "still unconfirmed");
    const audit = await db.prisma.auditLog.findMany({ where: { action: "receipt.emailFailed", entityId: id }, orderBy: { createdAt: "asc" } });
    assert.equal(audit.length, 2);
    for (const entry of audit) assert.match(entry.summary, /but Resend didn't confirm whether it went out$/);
    const third = await emailIt(key);
    assert.ok(third.ok);
    assert.deepEqual(delivered(), [ADDRESS], "only the first try's email ever went out");
    assert.equal(new Set(keysSent()).size, 1, "every try used the first try's key");
  });

  it("an unconfirmed try too old for Resend to remember isn't retried; a deliberate Resend can send", async () => {
    const key = newReceiptRequestKey();
    resend.queue.push({ error: DROPPED });
    assert.equal((await emailIt(key)).ok, false);
    const id = (await byKey(key)).id;
    await db.prisma.receiptEmailAttempt.updateMany({
      where: { receiptId: id },
      data: { providerKeyAt: new Date(Date.now() - 23 * 60 * 60 * 1000 - 1000) },
    });
    const retry = await emailIt(key);
    assert.match(retry.ok ? "" : retry.error, /too long ago to retry safely/);
    assert.equal(resend.calls.length, 1, "not handed to Resend again");

    const deliberate = await resendIt(id, newReceiptRequestKey());
    assert.ok(deliberate.ok);
    assert.deepEqual(delivered(), [ADDRESS]);
    assert.notEqual(keysSent()[1], keysSent()[0]);
  });
});

describe("a request that went out, then other sends of the receipt", () => {
  it("isn't sent again while another request is left unfinished or is mid-send", async () => {
    const key = newReceiptRequestKey();
    const first = await emailIt(key);
    assert.ok(first.ok && !first.alreadySent);
    const alreadySent = { ok: true, id: first.id, sentTo: ADDRESS, alreadySent: true };

    // Another request, to another address, that the server never finished.
    const longAgo = new Date(Date.now() - 16 * 60 * 1000);
    await db.prisma.receiptEmailAttempt.create({
      data: {
        receiptId: first.id,
        requestKey: newReceiptRequestKey(),
        address: "b@example.com",
        addressKey: "b@example.com",
        status: "PENDING",
        providerKey: "never-finished-key",
        providerKeyAt: longAgo,
        startedAt: longAgo,
      },
    });
    assert.deepEqual(await emailIt(key), alreadySent);

    // A deliberate Resend to a third address, held mid-send at Resend.
    const release = gate();
    resend.queue.push({ beforeResult: () => release.wait });
    const sending = resendIt(first.id, newReceiptRequestKey(), "c@example.com");
    await until(() => resend.calls.length === 2, "the Resend to reach Resend");
    assert.deepEqual(await emailIt(key), alreadySent, "recognized even while another send holds the receipt");
    release.open();
    assert.ok((await sending).ok);

    assert.deepEqual(await emailIt(key), alreadySent);
    assert.deepEqual(delivered(), [ADDRESS, "c@example.com"]);
  });
});

describe("the history's Retry email", () => {
  const retryOf = async (id: string) => {
    const attempts = await db.prisma.receiptEmailAttempt.findMany({ where: { receiptId: id }, orderBy: { startedAt: "desc" }, take: 1 });
    return emailAttemptView(attempts[0], Date.now());
  };

  it("repeats an unconfirmed request itself, so a copy that did go out isn't sent twice", async () => {
    const key = newReceiptRequestKey();
    resend.queue.push({ delivered: true, error: DROPPED });
    assert.equal((await emailIt(key)).ok, false);
    const id = (await byKey(key)).id;

    const view = await retryOf(id);
    assert.deepEqual(view, { state: "unconfirmed", retryKey: key }, "the row offers Retry email with the form's own key");
    assert.ok("retryKey" in view);
    const retry = await resendIt(id, view.retryKey, ADDRESS);
    assert.deepEqual(retry, { ok: true, id, sentTo: ADDRESS });
    assert.deepEqual(delivered(), [ADDRESS], "Resend matched the key and returned the first result");
    assert.equal(keysSent()[1], keysSent()[0]);
    assert.deepEqual(await retryOf(id), { state: "done" });

    // Pressing it again (a double click, a reload) is the same request: nothing more.
    assert.deepEqual(await resendIt(id, key, ADDRESS), { ok: true, id, sentTo: ADDRESS, alreadySent: true });
    assert.equal(resend.calls.length, 2);
  });

  it("repeats a send the server never finished under that send's own key", async () => {
    const key = newReceiptRequestKey();
    resend.queue.push({ delivered: true, throws: new Error("socket hang up") });
    assert.equal((await emailIt(key)).ok, false);
    const id = (await byKey(key)).id;
    // As if the server had stopped right after handing it to Resend.
    await db.prisma.receiptEmailAttempt.updateMany({
      where: { receiptId: id },
      data: { status: "PENDING", error: null, finishedAt: null, mayHaveSent: false, startedAt: new Date(Date.now() - 16 * 60 * 1000) },
    });
    const view = await retryOf(id);
    assert.deepEqual(view, { state: "never-finished", retryKey: key });
    assert.ok((await resendIt(id, key, ADDRESS)).ok);
    assert.deepEqual(delivered(), [ADDRESS]);
    assert.equal(keysSent()[1], keysSent()[0]);
  });

  it("retries a refused request under a new Resend key, and says why it failed without doubled punctuation", async () => {
    const key = newReceiptRequestKey();
    resend.queue.push({ error: { name: "validation_error", statusCode: 422, message: "Invalid `to` field." } });
    const failed = await emailIt(key);
    assert.deepEqual(failed, {
      ok: false,
      error:
        "Saved to the history below, but the email to donor@example.com didn't go out (Invalid `to` field). Check the address and try again, use Retry email on that row, or use Download PDF and send it yourself.",
    });
    const id = (await byKey(key)).id;
    const view = await retryOf(id);
    assert.deepEqual(view, { state: "failed", retryKey: key });

    resend.queue.push({ error: { name: "validation_error", statusCode: 422, message: "Invalid `to` field." } });
    assert.deepEqual(await resendIt(id, key, ADDRESS), {
      ok: false,
      error: "The email to donor@example.com didn't go out (Invalid `to` field). Check the address and try again, or use Download PDF and send it yourself.",
    });
    resend.queue.push({ error: DROPPED });
    assert.deepEqual(await resendIt(id, key, ADDRESS), {
      ok: false,
      error:
        "Resend didn't confirm whether the email to donor@example.com went out (Unable to fetch data. The request could not be resolved). Press Send again to retry: if the first one did go out, it won't be sent twice.",
    });
    assert.ok((await resendIt(id, key, ADDRESS)).ok);
    assert.deepEqual(delivered(), [ADDRESS]);
    const keys = keysSent();
    assert.equal(keys.length, 4);
    assert.equal(new Set(keys.slice(0, 3)).size, 3, "each refused try got a fresh key");
    assert.equal(keys[3], keys[2], "the try after an unconfirmed one reused its key");
  });

  it("offers no retry once an unconfirmed request is too old, and the request itself is refused readably", async () => {
    const key = newReceiptRequestKey();
    resend.queue.push({ error: DROPPED });
    assert.equal((await emailIt(key)).ok, false);
    const id = (await byKey(key)).id;
    await db.prisma.receiptEmailAttempt.updateMany({
      where: { receiptId: id },
      data: { providerKeyAt: new Date(Date.now() - 23 * 60 * 60 * 1000 - 1000) },
    });
    assert.deepEqual(await retryOf(id), { state: "too-old" });
    const refused = await resendIt(id, key, ADDRESS);
    assert.match(refused.ok ? "" : refused.error, /too long ago to retry safely/);
    assert.equal(resend.calls.length, 1);
  });

  it("stress: Retry email and the form's Email of the same unconfirmed request at once hand it to Resend once", async () => {
    for (let i = 0; i < 20; i++) {
      const key = newReceiptRequestKey();
      resend.queue.push({ error: DROPPED });
      assert.equal((await emailIt(key)).ok, false);
      const id = (await byKey(key)).id;
      const callsBefore = resend.calls.length;
      const results = await Promise.all([emailIt(key), resendIt(id, key, ADDRESS)]);
      const fresh = results.filter((r) => r.ok && !r.alreadySent);
      assert.equal(fresh.length, 1, `iteration ${i}: ${JSON.stringify(results)}`);
      for (const other of results.filter((r) => !(r.ok && !r.alreadySent))) {
        assert.ok(other.ok ? other.alreadySent : /being emailed right now/.test(other.error), `iteration ${i}: ${JSON.stringify(other)}`);
      }
      assert.equal(resend.calls.length - callsBefore, 1, `iteration ${i}: one retry reached Resend`);
      assert.equal((await onlyAttempt(id)).status, "SENT");
    }
  });
});

describe("deleting a receipt while it's being emailed", () => {
  it("is refused mid-send and allowed after; the audit entry names every address it went to", async () => {
    const key = newReceiptRequestKey();
    const release = gate();
    resend.queue.push({ beforeResult: () => release.wait });
    const sending = emailIt(key);
    await until(() => resend.calls.length === 1, "the send to reach Resend");
    const id = (await byKey(key)).id;

    const refused = await deleteIt(id);
    assert.deepEqual(refused, { ok: false, error: "This receipt is being emailed right now. Wait a moment, then try deleting it again." });
    assert.equal(await db.prisma.receipt.count({ where: { id } }), 1);
    release.open();
    assert.ok((await sending).ok);

    assert.ok((await resendIt(id, newReceiptRequestKey(), "b@example.com")).ok);
    resend.queue.push({ error: { name: "validation_error", statusCode: 422, message: "Invalid `to` field." } });
    assert.equal((await resendIt(id, newReceiptRequestKey(), "c@example.com")).ok, false);

    assert.deepEqual(await deleteIt(id), { ok: true });
    assert.equal(await db.prisma.receiptEmailAttempt.count({ where: { receiptId: id } }), 0, "its requests go with it");
    const entry = await db.prisma.auditLog.findFirstOrThrow({ where: { action: "receipt.delete", entityId: id } });
    assert.match(entry.summary, /dated 2026-10-20, which had been emailed to donor@example\.com, b@example\.com$/);
    assert.doesNotMatch(entry.summary, /c@example\.com/, "a refused send went nowhere");
  });

  it("the audit entry says when a send was never confirmed either way", async () => {
    const key = newReceiptRequestKey();
    resend.queue.push({ error: DROPPED });
    assert.equal((await emailIt(key)).ok, false);
    const id = (await byKey(key)).id;
    assert.deepEqual(await deleteIt(id), { ok: true });
    const entry = await db.prisma.auditLog.findFirstOrThrow({ where: { action: "receipt.delete", entityId: id } });
    assert.match(entry.summary, /dated 2026-10-20; an email to donor@example\.com was never confirmed either way$/);
  });

  it("waits for a send being claimed, then refuses (holder commits)", async () => {
    const saved = await generate(newReceiptRequestKey());
    assert.ok(saved.ok);
    const holder = await openTransaction(db.pool);
    try {
      // Another request's claim: the receipt row locked, a PENDING request written.
      await holder.query(`SELECT "id" FROM "Receipt" WHERE "id" = $1 FOR UPDATE`, [saved.id]);
      await holder.query(
        `INSERT INTO "ReceiptEmailAttempt" ("id","receiptId","requestKey","address","addressKey","status","providerKey","providerKeyAt","startedAt")
         VALUES ('claiming',$1,$2,$3,lower($3),'PENDING','claiming-key',${UTC_NOW},${UTC_NOW})`,
        [saved.id, newReceiptRequestKey(), ADDRESS]
      );
      const pending = deleteIt(saved.id);
      await waitForLockWait(db.pool);
      await holder.commit();
      const result = await pending;
      assert.equal(result.ok, false);
      assert.match(result.ok ? "" : result.error, /being emailed right now/);
    } finally {
      await holder.rollback();
    }
    assert.equal(await db.prisma.receipt.count({ where: { id: saved.id } }), 1);
  });

  it("... and deletes once that claim rolls back", async () => {
    const saved = await generate(newReceiptRequestKey());
    assert.ok(saved.ok);
    const holder = await openTransaction(db.pool);
    try {
      await holder.query(`SELECT "id" FROM "Receipt" WHERE "id" = $1 FOR UPDATE`, [saved.id]);
      await holder.query(
        `INSERT INTO "ReceiptEmailAttempt" ("id","receiptId","requestKey","address","addressKey","status","providerKey","providerKeyAt","startedAt")
         VALUES ('rolled-back',$1,$2,$3,lower($3),'PENDING','rolled-back-key',${UTC_NOW},${UTC_NOW})`,
        [saved.id, newReceiptRequestKey(), ADDRESS]
      );
      const pending = deleteIt(saved.id);
      await waitForLockWait(db.pool);
      await holder.rollback();
      assert.deepEqual(await pending, { ok: true });
    } finally {
      await holder.rollback();
    }
    assert.equal(await db.prisma.receipt.count({ where: { id: saved.id } }), 0);
  });

  it("stress: Resend and Delete at once never leave an email the deletion's record doesn't mention", async () => {
    const outcomes = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const saved = await generate(newReceiptRequestKey());
      assert.ok(saved.ok);
      const to = `stress-${i}@example.com`;
      const sentBefore = testState.emails.length;
      // The delete starts a little later each time (0–18 ms), so the runs
      // cover it landing before, during and after the send.
      const lateDelete = new Promise<void>((resolve) => setTimeout(resolve, (i % 10) * 2)).then(() => deleteIt(saved.id));
      const [sent, removed] = await Promise.all([resendIt(saved.id, newReceiptRequestKey(), to), lateDelete]);
      outcomes.add(`${sent.ok ? "sent" : "not sent"}/${removed.ok ? "deleted" : "kept"}`);
      const wentOut = testState.emails.length - sentBefore;
      assert.equal(wentOut, sent.ok ? 1 : 0, `iteration ${i}`);
      const exists = (await db.prisma.receipt.count({ where: { id: saved.id } })) === 1;
      assert.equal(exists, !removed.ok, `iteration ${i}`);
      if (wentOut && !exists) {
        // It finished before the delete started: the delete's entry says where it went.
        const entry = await db.prisma.auditLog.findFirstOrThrow({ where: { action: "receipt.delete", entityId: saved.id } });
        assert.ok(entry.summary.includes(to), `iteration ${i}: ${entry.summary}`);
      }
      if (!removed.ok) assert.match(removed.error, /being emailed right now/, `iteration ${i}`);
      if (!sent.ok) assert.equal(sent.error, "That receipt no longer exists.", `iteration ${i}`);
      if (exists) await deleteIt(saved.id);
    }
    process.stdout.write(`# delete-vs-resend outcomes seen: ${[...outcomes].sort().join(", ")}\n`);
  });
});
