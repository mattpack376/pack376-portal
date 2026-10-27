/*
 * Photo consent against a real database: consent-link emails only go to a
 * parent address on file for that scout (one-scout and Email All), and the
 * public submission is bounded before any database work and records exactly
 * once per link, even when the same link is submitted twice at once.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { afterEach, before, describe, it, mock } from "node:test";
import { openTransaction, waitForLockWait, withTestDatabase } from "../support/db";
import { form, resetTestState, runAs, testState, type SessionUser } from "../support/context";

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

afterEach(() => resetTestState());

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

const sendOne = (user: SessionUser, scoutId: string, parentEmail: string) =>
  runAs(user, () => consent.sendPhotoConsentLinkEmailAction({}, form({ scoutId, parentEmail })));

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

    const result = await runAs(fx.leaderA, () => consent.emailAllUnansweredConsentLinksAction());
    assert.deepEqual(result, { sent: 3, failed: 0, configured: true });

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
