/*
 * Photo consent against a real database: consent-link emails only go to a
 * parent address on file for that scout (one-scout and Email All), a send
 * Resend didn't confirm is reported as that — not as "didn't go through" —
 * and repeating the same press doesn't email a family twice; and the public
 * submission is bounded before any database work and records exactly once
 * per link, even when the same link is submitted twice at once. Resend is the
 * controllable stand-in from tests/doubles (which keeps Resend's
 * idempotency-key rule), so failures can be simulated and nothing is sent.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { afterEach, before, describe, it, mock } from "node:test";
import { openTransaction, waitForLockWait, withTestDatabase } from "../support/db";
import { form, resetTestState, runAs, testState, type SessionUser } from "../support/context";
import { installControllableResend, resetResendControl } from "../doubles/resend";
import { newRequestKey } from "@/lib/requestKey";

const resend = installControllableResend();
const db = withTestDatabase("photo_consent");
let consent: typeof import("@/lib/actions/photoConsent");

const HOSTILE = `<a href="https://example.invalid/phish">Click</a> & "Al"`;

type Fixture = {
  admin: SessionUser;
  leaderA: SessionUser;
  denA: string;
  denB: string;
};
let fx: Fixture;
let counter = 0;

before(async () => {
  await db.ready;
  mock.method(console, "error", () => {});
  consent = await import("@/lib/actions/photoConsent");

  const denA = await db.prisma.den.create({ data: { rank: "WOLF", scoutingYear: "2026-2027" } });
  const denB = await db.prisma.den.create({ data: { rank: "BEAR", scoutingYear: "2026-2027" } });
  const admin = await db.prisma.user.create({
    data: { username: "consent-admin", passwordHash: "x", role: "ADMIN", displayName: "Consent Admin" },
  });
  const leader = await db.prisma.user.create({
    data: { username: "wolf-leader", passwordHash: "x", role: "DEN", displayName: "Wolf Leader", denAssignments: { create: { denId: denA.id } } },
  });
  fx = {
    admin: { id: admin.id, role: "ADMIN", sessionVersion: 0 },
    leaderA: { id: leader.id, role: "DEN", sessionVersion: 0, denIds: [denA.id] },
    denA: denA.id,
    denB: denB.id,
  };
});

afterEach(() => {
  resetTestState();
  resetResendControl(resend);
});

const token = () => randomBytes(32).toString("base64url");

async function makeScout(opts: {
  denId?: string;
  firstName?: string;
  emails?: (string | null)[];
  active?: boolean;
  link?: boolean;
  answered?: boolean;
}) {
  counter += 1;
  const scout = await db.prisma.scout.create({
    data: {
      denId: opts.denId ?? fx.denA,
      firstName: opts.firstName ?? `Scout${counter}`,
      lastName: "Test",
      active: opts.active ?? true,
    },
  });
  // createdAt order decides "first parent", so add them one at a time.
  for (const [i, email] of (opts.emails ?? []).entries()) {
    await db.prisma.parent.create({
      data: { scoutId: scout.id, name: `Parent ${i}`, email, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)) },
    });
  }
  const record =
    opts.link === false
      ? null
      : await db.prisma.photoConsent.create({
          data: {
            scoutId: scout.id,
            token: token(),
            ...(opts.answered ? { facebook: "CONSENT", website: "CONSENT", fliers: "CONSENT" } : {}),
          },
        });
  return { scout, record };
}

const sendOne = (user: SessionUser, scoutId: string, parentEmail: string, requestKey = newRequestKey()) =>
  runAs(user, () => consent.sendPhotoConsentLinkEmailAction({}, form({ scoutId, parentEmail, requestKey })));
/** `requestKey` null leaves it out of the form. */
const emailAll = (user: SessionUser, requestKey: string | null = newRequestKey()) =>
  runAs(user, () => consent.emailAllUnansweredConsentLinksAction({}, form({ requestKey })));

/** The SDK's answer for a connection that dropped (it returns this rather than throwing). */
const DROPPED = { name: "application_error", statusCode: null, message: "Unable to fetch data. The request could not be resolved." };

describe("single consent-link email: address on file only", () => {
  it("sends to the stored parent address the button named, matched without regard to case", async () => {
    const { scout, record } = await makeScout({ firstName: HOSTILE, emails: [null, "Pat.Parent@Example.com"] });
    const result = await sendOne(fx.admin, scout.id, "  pat.parent@example.COM ");
    assert.deepEqual(result, { sent: true, configured: true });
    assert.equal(testState.emails.length, 1);
    const message = testState.emails[0];
    assert.equal(message.to, "Pat.Parent@Example.com", "the address as stored, not as posted");
    assert.ok(message.html?.includes(`/consent/${record!.token}`));
    assert.ok(!message.html?.includes(HOSTILE), "the hostile first name is escaped in the HTML");
    assert.ok(message.html?.includes("&lt;a href=&quot;https://example.invalid/phish&quot;&gt;"));
    const audit = await db.prisma.auditLog.findFirstOrThrow({ where: { action: "photoConsent.emailLink", entityId: scout.id } });
    assert.match(audit.summary, /to Pat\.Parent@Example\.com$/);
  });

  it("accepts any parent of the scout on file, not just the first", async () => {
    const { scout } = await makeScout({ emails: ["first@example.com", "second@example.com"] });
    assert.equal((await sendOne(fx.admin, scout.id, "second@example.com")).sent, true);
    assert.equal(testState.emails[0].to, "second@example.com");
  });

  it("refuses an address that isn't on file for this scout", async () => {
    const { scout } = await makeScout({ emails: ["pat@example.com"] });
    const { scout: other } = await makeScout({ emails: ["someone-else@example.com"] });
    for (const parentEmail of [
      "attacker@example.invalid",
      "someone-else@example.com", // another scout's parent
      "pat@example.com, attacker@example.invalid",
      "Pat <pat@example.com>",
      "pat@example.com\r\nBcc: attacker@example.invalid",
      `${"p".repeat(300)}@example.com`,
    ]) {
      const result = await sendOne(fx.admin, scout.id, parentEmail);
      assert.match(result.error ?? "", /isn't a parent email on file for this scout/, parentEmail);
    }
    assert.equal(testState.emails.length, 0);
    assert.equal(await db.prisma.auditLog.count({ where: { action: "photoConsent.emailLink", entityId: { in: [scout.id, other.id] } } }), 0);
  });

  it("won't send to a stored value that isn't one plain address", async () => {
    const { scout } = await makeScout({ emails: ["pat@example.com, other@example.com"] });
    const result = await sendOne(fx.admin, scout.id, "pat@example.com, other@example.com");
    assert.ok(result.error);
    assert.equal(testState.emails.length, 0);
  });

  it("keeps the den, active and link checks", async () => {
    const { scout: otherDen } = await makeScout({ denId: fx.denB, emails: ["b@example.com"] });
    assert.deepEqual(await sendOne(fx.leaderA, otherDen.id, "b@example.com"), { error: "Not authorized for this den." });

    const { scout: inactive } = await makeScout({ emails: ["i@example.com"], active: false });
    assert.deepEqual(await sendOne(fx.admin, inactive.id, "i@example.com"), { error: "This scout is marked inactive." });

    const { scout: noLink } = await makeScout({ emails: ["n@example.com"], link: false });
    assert.deepEqual(await sendOne(fx.admin, noLink.id, "n@example.com"), { error: "Generate the link before emailing it." });

    const { scout: mine } = await makeScout({ emails: ["mine@example.com"] });
    assert.equal((await sendOne(fx.leaderA, mine.id, "mine@example.com")).sent, true);
    assert.deepEqual(testState.emails.map((m) => m.to), ["mine@example.com"]);
  });
});

describe("Email All: address on file only", () => {
  it("sends each unanswered scout's own link to its first usable stored address, and only in managed dens", async () => {
    // Clear earlier tests' scouts out of the way.
    await db.prisma.scout.deleteMany({});
    const plain = await makeScout({ firstName: HOSTILE, emails: ["plain@example.com"] });
    const secondUsable = await makeScout({ emails: ["bad, list@example.com", "  usable@example.com  "] });
    const noneUsable = await makeScout({ emails: ["Pat <pat@example.com>", null] });
    const noLinkYet = await makeScout({ emails: ["new@example.com"], link: false });
    await makeScout({ emails: ["answered@example.com"], answered: true });
    await makeScout({ emails: ["inactive@example.com"], active: false });
    await makeScout({ denId: fx.denB, emails: ["other-den@example.com"] });

    const result = await emailAll(fx.leaderA);
    assert.deepEqual(result, { sent: 3, failed: 0, unconfirmed: 0, configured: true });

    const sent = new Map(testState.emails.map((m) => [m.to as string, m]));
    assert.deepEqual([...sent.keys()].sort(), ["new@example.com", "plain@example.com", "usable@example.com"]);
    assert.ok(sent.get("plain@example.com")?.html?.includes(`/consent/${plain.record!.token}`));
    assert.ok(sent.get("usable@example.com")?.html?.includes(`/consent/${secondUsable.record!.token}`));
    assert.ok(!sent.get("plain@example.com")?.html?.includes(HOSTILE), "escaped in the bulk email too");

    // The scout with no link got one, and that's the link it was sent.
    const generated = await db.prisma.photoConsent.findUniqueOrThrow({ where: { scoutId: noLinkYet.scout.id } });
    assert.ok(sent.get("new@example.com")?.html?.includes(`/consent/${generated.token}`));
    // Nothing went anywhere for the scout whose only addresses aren't usable.
    assert.equal(await db.prisma.auditLog.count({ where: { action: "photoConsent.emailLink", entityId: noneUsable.scout.id } }), 0);
  });
});

describe("single consent-link email: an outcome Resend didn't confirm", () => {
  let buttons: typeof import("@/components/EmailConsentLinkButton");
  before(async () => {
    buttons = await import("@/components/EmailConsentLinkButton");
  });

  it("refuses a missing or malformed request key without sending", async () => {
    const { scout } = await makeScout({ emails: ["pat@example.com"] });
    for (const requestKey of [undefined, "", "not-a-key", "A".repeat(32), `${"a".repeat(32)}x`]) {
      const result = await runAs(fx.admin, () =>
        consent.sendPhotoConsentLinkEmailAction({}, form({ scoutId: scout.id, parentEmail: "pat@example.com", requestKey }))
      );
      assert.deepEqual(result, { error: "This page is out of date. Reload it and try again." }, String(requestKey));
    }
    assert.equal(resend.calls.length, 0);
  });

  it("says Resend didn't confirm it, and the same press again doesn't email the family twice", async () => {
    const { scout } = await makeScout({ emails: ["pat@example.com"] });
    const key = newRequestKey();
    // It reached the family, but Resend's answer was lost on the way back.
    resend.queue.push({ delivered: true, error: DROPPED });
    const first = await sendOne(fx.admin, scout.id, "pat@example.com", key);
    assert.deepEqual(first, { sent: false, configured: true, uncertain: true, reason: DROPPED.message });
    assert.equal(buttons.consentLinkOutcomeUnknown(first), true);
    const shown = buttons.consentLinkMessage(first);
    assert.equal(shown?.tone, "alert");
    assert.match(shown?.text ?? "", /^Resend didn't confirm whether it went out, so it may have\. Press the button again/);
    assert.equal(await db.prisma.auditLog.count({ where: { action: "photoConsent.emailLinkUnconfirmed", entityId: scout.id } }), 1);
    assert.equal(await db.prisma.auditLog.count({ where: { action: "photoConsent.emailLink", entityId: scout.id } }), 0);

    const again = await sendOne(fx.admin, scout.id, "pat@example.com", key);
    assert.deepEqual(again, { sent: true, configured: true });
    assert.deepEqual(testState.emails.map((m) => m.to), ["pat@example.com"], "one copy");
    const keys = resend.calls.map((c) => c.options?.idempotencyKey);
    assert.equal(keys.length, 2);
    assert.ok(keys[0]?.includes(key));
    assert.equal(keys[1], keys[0], "both tries under one Resend key");
  });

  it("a refusal says it didn't go out, with Resend's reason, and isn't offered as a repeat", async () => {
    const { scout } = await makeScout({ emails: ["pat@example.com"] });
    resend.queue.push({ error: { name: "validation_error", statusCode: 422, message: "Invalid `to` field." } });
    const result = await sendOne(fx.admin, scout.id, "pat@example.com");
    assert.deepEqual(result, { sent: false, configured: true, reason: "Invalid `to` field." });
    assert.equal(buttons.consentLinkOutcomeUnknown(result), false);
    assert.deepEqual(buttons.consentLinkMessage(result), { tone: "alert", text: "It didn't go out (Invalid `to` field) — copy the link instead." });
    assert.equal(await db.prisma.auditLog.count({ where: { entityId: scout.id, action: { startsWith: "photoConsent.emailLink" } } }), 0);
  });
});

describe("Email All: an outcome Resend didn't confirm", () => {
  let buttons: typeof import("@/components/EmailAllConsentLinksButton");
  before(async () => {
    buttons = await import("@/components/EmailAllConsentLinksButton");
  });

  async function threeFamilies() {
    await db.prisma.scout.deleteMany({});
    return [
      await makeScout({ emails: ["a@example.com"] }),
      await makeScout({ emails: ["b@example.com"] }),
      await makeScout({ emails: ["c@example.com"] }),
    ];
  }

  it("refuses a missing or malformed request key without sending", async () => {
    await threeFamilies();
    for (const requestKey of [null, "", "not-a-key"]) {
      assert.deepEqual(await emailAll(fx.admin, requestKey), { error: "This page is out of date. Reload it and try again." });
    }
    assert.equal(resend.calls.length, 0);
  });

  it("a lost answer is reported as unconfirmed, not 'didn't go through', and the same press again emails nobody twice", async () => {
    const families = await threeFamilies();
    const key = newRequestKey();
    resend.queue.push({ delivered: true, error: DROPPED });
    const first = await emailAll(fx.admin, key);
    assert.deepEqual(first, { sent: 0, failed: 0, unconfirmed: 3, configured: true, repeatable: true });
    assert.equal(testState.emails.length, 3, "it did go out");
    assert.equal(buttons.emailAllOutcomeUnknown(first), true);
    const shown = buttons.emailAllMessage(first);
    assert.equal(shown?.tone, "alert");
    assert.doesNotMatch(shown?.text ?? "", /didn't go through/);
    assert.equal(
      shown?.text,
      "Resend didn't confirm whether the emails to 3 families went out, so they may have. Press Email All again to retry: any family the last try did reach won't get a second copy."
    );
    assert.equal(
      await db.prisma.auditLog.count({
        where: { action: "photoConsent.emailLinkUnconfirmed", entityId: { in: families.map((f) => f.scout.id) } },
      }),
      3
    );

    const again = await emailAll(fx.admin, key);
    assert.deepEqual(again, { sent: 3, failed: 0, unconfirmed: 0, configured: true });
    assert.equal(testState.emails.length, 3, "one copy each");
    assert.deepEqual(
      resend.calls.map((c) => c.options?.idempotencyKey),
      [`pack376-consent-all/${key}/1`, `pack376-consent-all/${key}/1`]
    );
    assert.equal(buttons.emailAllMessage(again)?.text, "Sent to 3 families.");
  });

  it("a refusal of the whole batch is reported as didn't go through", async () => {
    await threeFamilies();
    resend.queue.push({ error: { name: "validation_error", statusCode: 422, message: "Invalid `from` field." } });
    const result = await emailAll(fx.admin);
    assert.deepEqual(result, { sent: 0, failed: 3, unconfirmed: 0, configured: true });
    assert.equal(buttons.emailAllOutcomeUnknown(result), false);
    assert.equal(buttons.emailAllMessage(result)?.text, "3 didn't go through — use each scout's Copy Link instead.");
  });

  it("once the list has changed, a repeat is refused rather than emailing everyone again, and isn't offered again", async () => {
    const [answered] = await threeFamilies();
    const key = newRequestKey();
    resend.queue.push({ delivered: true, error: DROPPED });
    await emailAll(fx.admin, key);
    // One family answers in between, so the list (and the batch) changes.
    await db.prisma.photoConsent.update({
      where: { id: answered.record!.id },
      data: { facebook: "CONSENT", website: "CONSENT", fliers: "CONSENT" },
    });

    const again = await emailAll(fx.admin, key);
    assert.deepEqual(again, { sent: 0, failed: 0, unconfirmed: 2, configured: true, repeatable: false });
    assert.equal(testState.emails.length, 3, "nobody emailed twice");
    assert.equal(buttons.emailAllOutcomeUnknown(again), false, "the next press is a new request");
    assert.match(buttons.emailAllMessage(again)?.text ?? "", /The list has changed since that try, so pressing Email All again would email every family on it again\./);
  });

  it("says 'unconfirmed' alongside what did go out and what didn't", () => {
    assert.equal(
      buttons.emailAllMessage({ sent: 5, failed: 1, unconfirmed: 1, configured: true, repeatable: true })?.text,
      "Sent to 5 families. 1 didn't go through — use each scout's Copy Link instead. Resend didn't confirm whether the email to 1 family went out, so it may have. Press Email All again to retry: any family the last try did reach won't get a second copy."
    );
    assert.deepEqual(buttons.emailAllMessage({ sent: 0, failed: 0, unconfirmed: 0, configured: true }), { tone: "ok", text: "Nobody left to email." });
    assert.equal(buttons.emailAllMessage({}), null);
  });
});

describe("the consent buttons when the server never answers", () => {
  it("a rejected call comes back as unreachable instead of reaching the page's error screen", async () => {
    const { orUnreachable } = await import("@/lib/requestKey");
    const dropped = orUnreachable<{ unreachable?: boolean; sent?: boolean }>(async () => {
      throw new TypeError("Failed to fetch");
    });
    assert.deepEqual(await dropped({}, new FormData()), { unreachable: true });
    const answered = orUnreachable<{ unreachable?: boolean; sent?: boolean }>(async () => ({ sent: true }));
    assert.deepEqual(await answered({}, new FormData()), { sent: true });

    const single = await import("@/components/EmailConsentLinkButton");
    const all = await import("@/components/EmailAllConsentLinksButton");
    assert.equal(single.consentLinkOutcomeUnknown({ unreachable: true }), true);
    assert.equal(all.emailAllOutcomeUnknown({ unreachable: true }), true);
    assert.match(single.consentLinkMessage({ unreachable: true })?.text ?? "", /we don't know whether it went out/);
    assert.match(all.emailAllMessage({ unreachable: true })?.text ?? "", /we don't know whether the emails went out/);
  });

  it("the next press repeats the last one's key only while its outcome is unknown and Resend still remembers it", async () => {
    const { REPEAT_WINDOW_MS, isRequestKey, keyForPress } = await import("@/lib/requestKey");
    const first = keyForPress(null, true, 1_000);
    assert.ok(isRequestKey(first.key));
    assert.equal(keyForPress(first, true, 1_000 + REPEAT_WINDOW_MS - 1), first, "a repeat");
    assert.notEqual(keyForPress(first, false, 2_000).key, first.key, "a known outcome: a new request");
    assert.notEqual(keyForPress(first, true, 1_000 + REPEAT_WINDOW_MS).key, first.key, "too old to repeat safely");
  });
});

describe("public consent submission", () => {
  const answers = { facebook: "CONSENT", website: "DECLINE", fliers: "CONSENT" };
  const submission = (overrides: Record<string, string>) =>
    form({ signedByName: "Pat Parent", signedRelationship: "PARENT", signedDate: "2026-10-20", ...answers, ...overrides });

  async function unchanged(record: { id: string; token: string }) {
    const after = await db.prisma.photoConsent.findUniqueOrThrow({ where: { id: record.id } });
    assert.equal(after.token, record.token, "token not rotated");
    assert.equal(after.signedByName, null);
    assert.equal(await db.prisma.photoConsentHistory.count({ where: { photoConsentId: record.id } }), 0);
  }

  it("refuses an over-long name before any write, keeping what was entered", async () => {
    const { record } = await makeScout({});
    const longName = "N".repeat(121);
    const result = await consent.submitPhotoConsentAction({}, submission({ token: record!.token, signedByName: longName }));
    assert.equal(result.field, "signedByName");
    assert.match(result.error ?? "", /at most 120 characters/);
    assert.equal(result.values?.signedByName, "N".repeat(120));
    assert.equal(result.values?.facebook, "CONSENT");
    assert.equal(result.values?.signedDate, "2026-10-20");
    await unchanged(record!);
  });

  it("refuses malformed tokens, dates, relationships and answers with the field to fix", async () => {
    const { record } = await makeScout({});
    const cases: [Record<string, string>, string | undefined][] = [
      [{ token: "x".repeat(5000) }, undefined],
      [{ token: "short" }, undefined],
      [{ token: `${record!.token}'--` }, undefined],
      [{ token: record!.token, signedDate: "2026-02-31" }, "signedDate"],
      [{ token: record!.token, signedRelationship: "BOSS" }, "signedRelationship"],
      [{ token: record!.token, website: "MAYBE" }, "website"],
      [{ token: record!.token, signedByName: " \u0000\u0007 " }, "signedByName"],
    ];
    for (const [overrides, field] of cases) {
      const result = await consent.submitPhotoConsentAction({}, submission(overrides));
      assert.ok(result.error, JSON.stringify(overrides).slice(0, 80));
      assert.equal(result.field, field);
      assert.equal(result.saved, undefined);
      // Invalid choices are never echoed back as if they were valid.
      assert.ok(["", "PARENT"].includes(result.values?.signedRelationship ?? ""));
      assert.ok(["", "CONSENT", "DECLINE"].includes(result.values?.website ?? ""));
    }
    await unchanged(record!);
  });

  it("records once, rotates the token, and stores a name cleaned to one line", async () => {
    const { record } = await makeScout({});
    const result = await consent.submitPhotoConsentAction({}, submission({ token: record!.token, signedByName: " Pat\u0000 \n Parent " }));
    assert.deepEqual(result, { saved: { facebook: "CONSENT", website: "DECLINE", fliers: "CONSENT" } });
    const after = await db.prisma.photoConsent.findUniqueOrThrow({ where: { id: record!.id } });
    assert.notEqual(after.token, record!.token);
    assert.equal(after.signedByName, "Pat Parent");
    assert.equal(await db.prisma.photoConsentHistory.count({ where: { photoConsentId: record!.id } }), 1);

    const again = await consent.submitPhotoConsentAction({}, submission({ token: record!.token }));
    assert.match(again.error ?? "", /This link isn't valid/);
    assert.equal(await db.prisma.photoConsentHistory.count({ where: { photoConsentId: record!.id } }), 1);
  });

  it("a submission waiting on another of the same link finds it used (readable error, one record)", async () => {
    const { record } = await makeScout({});
    const holder = await openTransaction(db.pool);
    try {
      // The other submission: it holds the row and has rotated the token, not yet committed.
      await holder.query(`SELECT "id" FROM "PhotoConsent" WHERE "id" = $1 FOR UPDATE`, [record!.id]);
      await holder.query(`UPDATE "PhotoConsent" SET "token" = $2 WHERE "id" = $1`, [record!.id, token()]);
      const pending = consent.submitPhotoConsentAction({}, submission({ token: record!.token }));
      await waitForLockWait(db.pool);
      await holder.commit();
      const result = await pending;
      assert.match(result.error ?? "", /This link isn't valid/);
    } finally {
      await holder.rollback();
    }
    assert.equal(await db.prisma.photoConsentHistory.count({ where: { photoConsentId: record!.id } }), 0);
  });

  it("goes ahead when the other transaction holding the row rolls back", async () => {
    const { record } = await makeScout({});
    const holder = await openTransaction(db.pool);
    try {
      await holder.query(`SELECT "id" FROM "PhotoConsent" WHERE "id" = $1 FOR UPDATE`, [record!.id]);
      const pending = consent.submitPhotoConsentAction({}, submission({ token: record!.token }));
      await waitForLockWait(db.pool);
      await holder.rollback();
      assert.ok((await pending).saved);
    } finally {
      await holder.rollback();
    }
    assert.equal(await db.prisma.photoConsentHistory.count({ where: { photoConsentId: record!.id } }), 1);
  });

  it("stress: the same link submitted twice at once records exactly once", async () => {
    for (let i = 0; i < 20; i++) {
      const { record } = await makeScout({});
      const results = await Promise.all([
        consent.submitPhotoConsentAction({}, submission({ token: record!.token, signedByName: "First" })),
        consent.submitPhotoConsentAction({}, submission({ token: record!.token, signedByName: "Second" })),
      ]);
      assert.equal(results.filter((r) => r.saved).length, 1, `iteration ${i}`);
      assert.equal(results.filter((r) => r.error).length, 1, `iteration ${i}`);
      const history = await db.prisma.photoConsentHistory.findMany({ where: { photoConsentId: record!.id } });
      assert.equal(history.length, 1);
      const after = await db.prisma.photoConsent.findUniqueOrThrow({ where: { id: record!.id } });
      assert.equal(after.signedByName, history[0].signedByName, "the stored answer is the recorded one");
    }
  });
});

describe("consent form markup after a refusal", () => {
  async function render(state: import("@/lib/actions/photoConsent").SubmitConsentState) {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { PhotoConsentFields } = await import("@/components/PhotoConsentForm");
    return renderToStaticMarkup(
      createElement(PhotoConsentFields, {
        state,
        formAction: () => {},
        pending: false,
        token: "t".repeat(43),
        scoutFirstName: "Al",
        onFile: { facebook: "PENDING", website: "PENDING", fliers: "PENDING", signedByName: "On File", signedRelationship: null },
        dateValue: "2026-10-20",
        onDateChange: () => {},
      })
    );
  }
  const tag = (html: string, pattern: RegExp) => html.match(pattern)?.[0] ?? "";

  it("marks the refused field, ties it to the alert, and keeps what was entered", async () => {
    const html = await render({
      error: "Your name can be at most 120 characters.",
      field: "signedByName",
      values: {
        facebook: "CONSENT",
        website: "DECLINE",
        fliers: "",
        signedByName: `Pat "<Parent>"`,
        signedRelationship: "GUARDIAN",
        signedDate: "2026-10-20",
      },
    });
    assert.match(html, /<div id="photo-consent-error" class="form-error" role="alert" tabindex="-1">Your name can be at most 120 characters\.<\/div>/);

    const name = tag(html, /<input id="signedByName"[^>]*>/);
    assert.match(name, /aria-invalid="true"/);
    assert.match(name, /aria-describedby="photo-consent-error"/);
    assert.match(name, /value="Pat &quot;&lt;Parent&gt;&quot;"/, "the typed name is kept (as text)");
    assert.match(name, /maxLength="120"/i);
    assert.doesNotMatch(tag(html, /<input id="signedDate"[^>]*>/), /aria-invalid/);
    assert.doesNotMatch(tag(html, /<select id="signedRelationship"[^>]*>/), /aria-invalid/);

    assert.match(tag(html, /<input id="facebook-consent"[^>]*>/), /checked=""/);
    assert.match(tag(html, /<input[^>]*name="website"[^>]*value="DECLINE"[^>]*>/), /checked=""/);
    assert.doesNotMatch(tag(html, /<input id="fliers-consent"[^>]*>/), /checked/);
    const fliersDecline = tag(html, /<input[^>]*name="fliers"[^>]*value="DECLINE"[^>]*>/);
    assert.ok(fliersDecline, "the Decline radio rendered");
    assert.doesNotMatch(fliersDecline, /checked/);
    assert.match(html, /<option value="GUARDIAN" selected="">/);
  });

  it("marks a whole choice group when that's what was missing", async () => {
    const html = await render({ error: "Choose consent or decline for all three.", field: "website", values: undefined });
    assert.match(
      tag(html, /<div class="form-field" role="radiogroup" aria-labelledby="website-label"[^>]*>/),
      /aria-invalid="true" aria-describedby="photo-consent-error"/
    );
    assert.doesNotMatch(tag(html, /<div class="form-field" role="radiogroup" aria-labelledby="facebook-label"[^>]*>/), /aria-invalid/);
    assert.match(tag(html, /<input id="signedByName"[^>]*>/), /value="On File"/, "with nothing echoed, what's on file stays");
  });

  it("shows no alert and marks nothing before a submit", async () => {
    const html = await render({});
    assert.doesNotMatch(html, /role="alert"|aria-invalid/);
  });
});
