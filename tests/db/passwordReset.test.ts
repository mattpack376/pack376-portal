/*
 * The reset/invite link lifecycle against a real Postgres: issuing links,
 * finishing them (completeResetAction), and an Admin reset, including the
 * races between them. Each race uses real transactions on two connections —
 * the app's Prisma client and db.pool — or holds the app mid-flight inside
 * bcrypt (testState.pauses["bcrypt.hash"]) while the database changes under it.
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, type TestContext } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import bcrypt from "bcryptjs";
import { openTransaction, waitForLockWait, withTestDatabase } from "../support/db";
import { asAnonymous, form, gate, resetTestState, runAs, settle, testState } from "../support/context";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

const db = withTestDatabase("password_reset");
let reset: typeof import("@/lib/actions/passwordReset");
let users: typeof import("@/lib/actions/users");
let tokens: typeof import("@/lib/resetTokens");
let resetPage: typeof import("@/app/portal/reset/[token]/page");
let resetForm: typeof import("@/components/SetPasswordForm");

before(async () => {
  await db.ready;
  reset = await import("@/lib/actions/passwordReset");
  users = await import("@/lib/actions/users");
  tokens = await import("@/lib/resetTokens");
  resetPage = await import("@/app/portal/reset/[token]/page");
  resetForm = await import("@/components/SetPasswordForm");
});

beforeEach(() => resetTestState());

const ORIGINAL_PASSWORD = "original-password";
// A cheap real bcrypt hash for fixtures, so creating users doesn't go through
// (and count as) the app's own hashing.
const ORIGINAL_HASH = bcrypt.hashSync(ORIGINAL_PASSWORD, 4);
const INVALID_LINK = /invalid, expired, or has already been used/;

let sequence = 0;
async function makeUser(options: { role?: "ADMIN" | "PARENT" | "DEN"; username?: string; email?: string | null; active?: boolean } = {}) {
  sequence += 1;
  return db.prisma.user.create({
    data: {
      username: options.username ?? `reset-user-${sequence}`,
      passwordHash: ORIGINAL_HASH,
      role: options.role ?? "PARENT",
      displayName: `Reset User ${sequence}`,
      email: options.email ?? null,
      active: options.active ?? true,
    },
  });
}

async function makeAdmin(username?: string) {
  return makeUser({ role: "ADMIN", username: username ?? `reset-admin-${sequence + 1}` });
}

type Completion =
  | { kind: "redirect"; to: string; cookie: string | undefined }
  | { kind: "state"; state: Awaited<ReturnType<typeof import("@/lib/actions/passwordReset").completeResetAction>> };

/** Runs the real action as an anonymous visitor, the way the reset page does. */
async function complete(token: string, password: string, confirmPassword = password): Promise<Completion> {
  const { result, cookies } = await asAnonymous(() =>
    settle(reset.completeResetAction({}, form({ token, password, confirmPassword }))),
  );
  if (result.ok) return { kind: "state", state: result.value };
  const to = (result.error as Error & { redirect?: string }).redirect;
  if (to) return { kind: "redirect", to, cookie: cookies.get(SESSION_COOKIE) };
  throw result.error;
}

function errorOf(outcome: Completion) {
  assert.equal(outcome.kind, "state", "expected the action to refuse, not sign in");
  return outcome.kind === "state" ? (outcome.state.error ?? "") : "";
}

/** Counts every bcrypt hash/compare the app starts from here on. */
function countBcrypt() {
  const counts = { hash: 0, compare: 0 };
  testState.pauses["bcrypt.hash"] = async () => {
    counts.hash += 1;
  };
  testState.pauses["bcrypt.compare"] = async () => {
    counts.compare += 1;
  };
  return counts;
}

/** Holds the first bcrypt.hash the app starts until resume(); later hashes run freely. */
function pauseFirstHash() {
  const entered = gate();
  const resume = gate();
  let paused = false;
  testState.pauses["bcrypt.hash"] = async () => {
    if (paused) return;
    paused = true;
    entered.open();
    await resume.wait;
  };
  return { entered: entered.wait, resume: resume.open };
}

async function userRow(id: string) {
  return db.prisma.user.findUniqueOrThrow({ where: { id } });
}

/** Links for this account that would still be accepted right now. */
async function usableLinkCount(userId: string) {
  const { rows } = await db.pool.query(
    `SELECT count(*)::int AS n FROM "PasswordResetToken" WHERE "userId" = $1 AND "usedAt" IS NULL AND "expiresAt" > ${UTC_NOW}`,
    [userId],
  );
  return rows[0].n as number;
}

async function auditCount(action: string, entityId: string) {
  return db.prisma.auditLog.count({ where: { action, entityId } });
}

function tokenFromUrl(url: string) {
  const token = url.split("/portal/reset/")[1];
  assert.ok(token, `no token in ${url}`);
  return token;
}

/** The link an Admin reset handed out, from the on-screen invite or the (fake) email. */
function linkFromResetResult(result: Awaited<ReturnType<typeof import("@/lib/actions/users").resetPasswordAction>>) {
  assert.equal(result.ok, true, `reset refused: ${"error" in result ? result.error : ""}`);
  if ("invite" in result && result.invite) return tokenFromUrl(result.invite.url);
  const email = testState.emails.at(-1);
  assert.ok(email?.text, "the reset link was neither shown nor emailed");
  const match = email.text.match(/\/portal\/reset\/([A-Za-z0-9_-]+)/);
  assert.ok(match, "no reset link in the email");
  return match[1];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let failureSequence = 0;
/**
 * Makes the database itself refuse an INSERT into `table` whenever
 * `condition` (SQL over NEW, subqueries allowed) holds — a real failure in
 * the middle of the app's transaction, not a mock. Returns a function that
 * lifts it early; it is lifted at the end of the test regardless.
 */
async function failInsertsWhen(t: TestContext, table: string, condition: string) {
  failureSequence += 1;
  const name = `test_fail_insert_${failureSequence}`;
  await db.pool.query(`
    CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF ${condition} THEN RAISE EXCEPTION 'simulated write failure (${name})'; END IF;
      RETURN NEW;
    END $$`);
  await db.pool.query(`CREATE TRIGGER ${name} BEFORE INSERT ON "${table}" FOR EACH ROW EXECUTE FUNCTION ${name}()`);
  const lift = async () => {
    await db.pool.query(`DROP TRIGGER IF EXISTS ${name} ON "${table}"`);
    await db.pool.query(`DROP FUNCTION IF EXISTS ${name}()`);
  };
  t.after(lift);
  return lift;
}

/** The text of every <h1> in some rendered markup. */
function headings(html: string) {
  return [...html.matchAll(/<h1[^>]*>(.*?)<\/h1>/g)].map((m) => m[1]);
}

/** The reset page exactly as a visitor's browser first receives it. */
async function renderResetPage(token: string) {
  return renderToStaticMarkup(await resetPage.default({ params: Promise.resolve({ token }) }));
}

// Prisma keeps DateTime columns as UTC in "timestamp without time zone", and
// the test server's sessions may run in another zone, so SQL here spells out
// "now" in UTC to agree with the app's clock.
const UTC_NOW = `(now() AT TIME ZONE 'UTC')`;
const UTC_CLOCK = `(clock_timestamp() AT TIME ZONE 'UTC')`;

describe("finishing a reset link", () => {
  it("sets the password, signs in with the committed session version, and spends the link", async () => {
    const user = await makeUser();
    await db.prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 3, lockedUntil: new Date(Date.now() + 60_000) } });
    const token = await tokens.issueResetToken(user.id);

    const outcome = await complete(token, "brand-new-password");
    assert.equal(outcome.kind, "redirect");
    assert.equal(outcome.kind === "redirect" && outcome.to, "/portal");

    const after = await userRow(user.id);
    assert.ok(bcrypt.compareSync("brand-new-password", after.passwordHash));
    assert.equal(after.sessionVersion, user.sessionVersion + 1);
    assert.equal(after.failedLoginCount, 0);
    assert.equal(after.lockedUntil, null);
    assert.equal(await usableLinkCount(user.id), 0);

    const cookie = outcome.kind === "redirect" ? outcome.cookie : undefined;
    assert.ok(cookie, "a session cookie was set");
    const session = await verifySessionToken(cookie);
    assert.equal(session?.userId, user.id);
    assert.equal(session?.sv, after.sessionVersion, "the cookie carries the committed session version");

    const entry = await db.prisma.auditLog.findFirstOrThrow({ where: { action: "user.setOwnPassword", entityId: user.id } });
    assert.equal(entry.actorUserId, user.id);

    // The same link can't be used again.
    assert.match(errorOf(await complete(token, "another-password")), INVALID_LINK);
  });

  it("spends every other outstanding link for the account too", async () => {
    const user = await makeUser();
    const first = await tokens.issueResetToken(user.id);
    // A second unused link alongside the first, as an older release could
    // leave behind (it is in the same credential generation as the first).
    const { credentialVersion } = await userRow(user.id);
    await db.pool.query(
      `INSERT INTO "PasswordResetToken" (id, "userId", "tokenHash", "expiresAt", "credentialVersion")
       VALUES ('legacy-extra', $1, 'not-a-real-hash', ${UTC_NOW} + interval '1 hour', $2)`,
      [user.id, credentialVersion],
    );
    assert.equal(await usableLinkCount(user.id), 2);

    assert.equal((await complete(first, "brand-new-password")).kind, "redirect");
    assert.equal(await usableLinkCount(user.id), 0);
  });

  it("refuses bad input and dead links before any bcrypt work", async () => {
    const user = await makeUser();
    const superseded = await tokens.issueResetToken(user.id);
    const live = await tokens.issueResetToken(user.id); // supersedes the first
    const usedUser = await makeUser();
    const usedOnce = await tokens.issueResetToken(usedUser.id);
    assert.equal((await complete(usedOnce, "brand-new-password")).kind, "redirect");
    const expiredUser = await makeUser();
    const expired = await tokens.issueResetToken(expiredUser.id);
    await db.pool.query(`UPDATE "PasswordResetToken" SET "expiresAt" = ${UTC_NOW} - interval '1 second' WHERE "userId" = $1`, [expiredUser.id]);
    const deletedUser = await makeUser();
    const deleted = await tokens.issueResetToken(deletedUser.id);
    await db.prisma.user.delete({ where: { id: deletedUser.id } });

    const counts = countBcrypt();
    const cases: [string, string, string, RegExp][] = [
      ["missing token", "", "brand-new-password", INVALID_LINK],
      ["garbage token", "not-a-token", "brand-new-password", INVALID_LINK],
      ["well-formed but unknown", "A".repeat(43), "brand-new-password", INVALID_LINK],
      ["oversize token", "A".repeat(100_000), "brand-new-password", INVALID_LINK],
      ["token with a bad character", `${"A".repeat(42)}!`, "brand-new-password", INVALID_LINK],
      ["superseded link", superseded, "brand-new-password", INVALID_LINK],
      ["already-used link", usedOnce, "brand-new-password", INVALID_LINK],
      ["expired link", expired, "brand-new-password", INVALID_LINK],
      ["deleted account", deleted, "brand-new-password", INVALID_LINK],
      ["short password", live, "short", /at least 8 characters/],
      ["oversize password", live, "p".repeat(100_000), /too long/],
      ["over 72 bytes", live, "é".repeat(40), /too long/],
    ];
    for (const [label, token, password, expected] of cases) {
      assert.match(errorOf(await complete(token, password)), expected, label);
    }
    assert.match(errorOf(await complete(live, "brand-new-password", "different-password")), /don't match/);
    assert.equal(counts.hash, 0, "no bcrypt hash for any refused request");
    assert.equal(counts.compare, 0);

    // None of that spent the live link.
    assert.equal(await usableLinkCount(user.id), 1);
    testState.pauses = {};
    assert.equal((await complete(live, "brand-new-password")).kind, "redirect");
  });

  it("marks a dead link, and why, so the form can offer the recovery path", async () => {
    const outcome = await complete("A".repeat(43), "brand-new-password");
    assert.equal(outcome.kind === "state" && outcome.state.linkDead, "invalid");
    assert.match(errorOf(outcome), /Ask an admin to send you a new one/);
    const user = await makeUser();
    const token = await tokens.issueResetToken(user.id);
    const short = await complete(token, "short");
    assert.equal(short.kind === "state" && short.state.field, "password");
    assert.equal(short.kind === "state" && short.state.linkDead, undefined);
  });

  it("refuses an inactive account without hashing or spending the link", async () => {
    const user = await makeUser({ role: "DEN", active: false });
    const token = await tokens.issueInviteToken(user.id);
    const counts = countBcrypt();
    const outcome = await complete(token, "brand-new-password");
    assert.match(errorOf(outcome), /inactive/);
    assert.equal(outcome.kind === "state" && outcome.state.linkDead, "inactive");
    assert.equal(counts.hash, 0);
    assert.equal((await userRow(user.id)).passwordHash, ORIGINAL_HASH);
  });

  it("the page's heading matches the link's state on first load", async () => {
    const user = await makeUser();
    const token = await tokens.issueResetToken(user.id);
    const usable = await renderResetPage(token);
    assert.deepEqual(headings(usable), ["Set Your Password"]);
    assert.match(usable, /<form/);
    assert.doesNotMatch(usable, /role="alert"/);

    const invalid = await renderResetPage("A".repeat(43));
    assert.deepEqual(headings(invalid), ["Link Invalid"]);
    assert.match(invalid, /role="alert"[^>]*>This link is invalid, expired, or has already been used/);
    assert.match(invalid, /href="\/portal\/login"/);
    assert.doesNotMatch(invalid, /<form|Choose a password/);

    await db.prisma.user.update({ where: { id: user.id }, data: { active: false } });
    const inactive = await renderResetPage(token);
    assert.deepEqual(headings(inactive), ["Account Inactive"]);
    assert.match(inactive, /role="alert"[^>]*>This account is inactive/);
    assert.doesNotMatch(inactive, /<form|Choose a password/);
  });

  it("after a submit finds the link dead, the form shows the same view as the page, heading included", async () => {
    const noop = () => {};
    const render = (state: import("@/lib/actions/passwordReset").CompleteResetState) =>
      renderToStaticMarkup(createElement(resetForm.SetPasswordView, { token: "A".repeat(43), state, formAction: noop, pending: false }));

    // A link that is spent between the page loading and the submit.
    const user = await makeUser();
    const token = await tokens.issueResetToken(user.id);
    const pageHtml = await renderResetPage(token);
    assert.deepEqual(headings(pageHtml), ["Set Your Password"]);
    assert.equal((await complete(token, "brand-new-password")).kind, "redirect");
    const spent = await complete(token, "another-password");
    assert.equal(spent.kind, "state");
    const afterSpent = render(spent.kind === "state" ? spent.state : {});
    assert.deepEqual(headings(afterSpent), ["Link Invalid"], "no \"Set Your Password\" above a dead link");
    assert.doesNotMatch(afterSpent, /Set Your Password|Choose a password|<form|type="password"/);
    assert.ok(
      (await renderResetPage(token)).includes(afterSpent),
      "exactly what the page shows when it loads that link now",
    );

    // An account switched off between the page loading and the submit.
    const denUser = await makeUser({ role: "DEN" });
    const invite = await tokens.issueInviteToken(denUser.id);
    await db.prisma.user.update({ where: { id: denUser.id }, data: { active: false } });
    const inactive = await complete(invite, "brand-new-password");
    const afterInactive = render(inactive.kind === "state" ? inactive.state : {});
    assert.deepEqual(headings(afterInactive), ["Account Inactive"]);
    assert.doesNotMatch(afterInactive, /Set Your Password|<form/);

    // A refusal that isn't about the link keeps the form and its heading.
    const fresh = await tokens.issueResetToken(user.id);
    const mismatch = await complete(fresh, "brand-new-password", "different-password");
    const afterMismatch = render(mismatch.kind === "state" ? mismatch.state : {});
    assert.deepEqual(headings(afterMismatch), ["Set Your Password"]);
    assert.match(afterMismatch, /<form/);
  });

  it("refuses everything while the firewall rate-limits this connection", async () => {
    const user = await makeUser();
    const token = await tokens.issueResetToken(user.id);
    testState.rateLimited = true;
    const counts = countBcrypt();
    assert.match(errorOf(await complete(token, "brand-new-password")), /Too many/);
    assert.equal(counts.hash, 0);
    assert.equal(await usableLinkCount(user.id), 1, "the link is untouched");
    assert.equal(await auditCount("user.setOwnPassword", user.id), 0);
    testState.rateLimited = false;
    assert.equal((await complete(token, "brand-new-password")).kind, "redirect");
  });

  it("reports the link state on the page without spending it", async () => {
    const user = await makeUser();
    const token = await tokens.issueResetToken(user.id);
    assert.equal(await tokens.resetLinkStatus(token), "usable");
    assert.equal(await tokens.resetLinkStatus(token), "usable", "looking twice doesn't spend it");
    assert.equal(await tokens.resetLinkStatus("A".repeat(43)), "invalid");
    assert.equal(await tokens.resetLinkStatus("x".repeat(5000)), "invalid");
    await db.prisma.user.update({ where: { id: user.id }, data: { active: false } });
    assert.equal(await tokens.resetLinkStatus(token), "inactive");
  });
});

describe("races while a link is being finished", () => {
  it("one link submitted twice at once changes the password once", async () => {
    for (let round = 0; round < 10; round++) {
      const user = await makeUser();
      const token = await tokens.issueResetToken(user.id);
      // Hold both submissions inside bcrypt until both have passed every
      // check before it, so they really do race to commit.
      let inside = 0;
      const bothInside = gate();
      // Fails the assertion below rather than hanging if only one gets there.
      const fallback = setTimeout(bothInside.open, 5000);
      testState.pauses["bcrypt.hash"] = async () => {
        inside += 1;
        if (inside === 2) bothInside.open();
        await bothInside.wait;
      };
      const results = await Promise.all([complete(token, "password-from-a"), complete(token, "password-from-b")]);
      clearTimeout(fallback);
      testState.pauses = {};
      assert.equal(inside, 2, "both submissions passed the cheap checks and hashed");

      const winners = results.filter((r) => r.kind === "redirect");
      assert.equal(winners.length, 1, `round ${round}: exactly one submission signs in`);
      const loser = results.find((r) => r.kind === "state");
      assert.ok(loser);
      assert.match(errorOf(loser), INVALID_LINK);

      const after = await userRow(user.id);
      assert.equal(after.sessionVersion, user.sessionVersion + 1, "the password changed exactly once");
      const winnerPassword = results[0].kind === "redirect" ? "password-from-a" : "password-from-b";
      assert.ok(bcrypt.compareSync(winnerPassword, after.passwordHash), "the stored password is the winner's");
      assert.equal(await auditCount("user.setOwnPassword", user.id), 1);
      const winner = winners[0];
      const session = await verifySessionToken((winner.kind === "redirect" && winner.cookie) || "");
      assert.equal(session?.sv, after.sessionVersion);
    }
  });

  it("an Admin reset that commits while a completion is hashing defeats the completion", async () => {
    const admin = await makeAdmin();
    const user = await makeUser({ email: "parent@example.test" });
    const oldLink = await tokens.issueResetToken(user.id);

    const pause = pauseFirstHash();
    const completion = complete(oldLink, "password-from-old-link");
    await pause.entered;

    // The Admin reset runs start to finish (its own hash isn't paused).
    const adminResult = await runAs(admin, () => users.resetPasswordAction(user.id));
    const newLink = linkFromResetResult(adminResult);
    const afterAdmin = await userRow(user.id);
    assert.equal(afterAdmin.sessionVersion, user.sessionVersion + 1);

    pause.resume();
    const outcome = await completion;
    assert.match(errorOf(outcome), INVALID_LINK);

    const final = await userRow(user.id);
    assert.equal(final.passwordHash, afterAdmin.passwordHash, "the Admin's reset stands");
    assert.equal(final.sessionVersion, afterAdmin.sessionVersion, "no later session version was issued");
    assert.ok(!bcrypt.compareSync("password-from-old-link", final.passwordHash));
    assert.equal(await auditCount("user.setOwnPassword", user.id), 0);

    // The Admin's link is the one that works.
    testState.pauses = {};
    assert.equal((await complete(newLink, "password-from-new-link")).kind, "redirect");
    assert.ok(bcrypt.compareSync("password-from-new-link", (await userRow(user.id)).passwordHash));
  });

  it("an Admin reset that committed first leaves the old link dead, with no bcrypt work", async () => {
    const admin = await makeAdmin();
    const user = await makeUser();
    const oldLink = await tokens.issueResetToken(user.id);
    linkFromResetResult(await runAs(admin, () => users.resetPasswordAction(user.id)));
    const afterAdmin = await userRow(user.id);

    const counts = countBcrypt();
    assert.match(errorOf(await complete(oldLink, "password-from-old-link")), INVALID_LINK);
    assert.equal(counts.hash, 0);
    assert.equal((await userRow(user.id)).passwordHash, afterAdmin.passwordHash);
  });

  it("a completion waits for an Admin reset holding the account, then fails if it commits", async (t) => {
    const user = await makeUser();
    const oldLink = await tokens.issueResetToken(user.id);

    // An Admin reset mid-transaction on another connection: account row
    // locked, password replaced, old links spent, a new one issued.
    const holder = await openTransaction(db.pool);
    t.after(() => holder.rollback());
    await holder.query(`SELECT id FROM "User" WHERE id = $1 FOR UPDATE`, [user.id]);
    await holder.query(
      `UPDATE "User" SET "passwordHash" = 'admin-placeholder', "sessionVersion" = "sessionVersion" + 1,
              "credentialVersion" = "credentialVersion" + 1 WHERE id = $1`,
      [user.id],
    );
    await holder.query(`UPDATE "PasswordResetToken" SET "usedAt" = ${UTC_NOW} WHERE "userId" = $1 AND "usedAt" IS NULL`, [user.id]);

    const completion = complete(oldLink, "password-from-old-link");
    await waitForLockWait(db.pool, 15_000);
    await holder.commit();

    assert.match(errorOf(await completion), INVALID_LINK);
    const final = await userRow(user.id);
    assert.equal(final.passwordHash, "admin-placeholder");
    assert.equal(final.sessionVersion, user.sessionVersion + 1);
  });

  it("a completion waits for an Admin reset holding the account, then succeeds if it rolls back", async (t) => {
    const user = await makeUser();
    const link = await tokens.issueResetToken(user.id);

    const holder = await openTransaction(db.pool);
    t.after(() => holder.rollback());
    await holder.query(`SELECT id FROM "User" WHERE id = $1 FOR UPDATE`, [user.id]);
    await holder.query(`UPDATE "User" SET "passwordHash" = 'admin-placeholder' WHERE id = $1`, [user.id]);
    await holder.query(`UPDATE "PasswordResetToken" SET "usedAt" = ${UTC_NOW} WHERE "userId" = $1 AND "usedAt" IS NULL`, [user.id]);

    const completion = complete(link, "password-from-link");
    await waitForLockWait(db.pool, 15_000);
    await holder.rollback();

    assert.equal((await completion).kind, "redirect");
    assert.ok(bcrypt.compareSync("password-from-link", (await userRow(user.id)).passwordHash));
  });

  it("refuses a link that expired while its password was being hashed", async () => {
    const user = await makeUser();
    const token = await tokens.issueResetToken(user.id);
    const pause = pauseFirstHash();
    const completion = complete(token, "brand-new-password");
    await pause.entered; // passed the cheap check while the link was still good
    await db.pool.query(`UPDATE "PasswordResetToken" SET "expiresAt" = ${UTC_NOW} - interval '1 millisecond' WHERE "userId" = $1`, [user.id]);
    pause.resume();

    assert.match(errorOf(await completion), INVALID_LINK);
    const final = await userRow(user.id);
    assert.equal(final.passwordHash, ORIGINAL_HASH);
    assert.equal(final.sessionVersion, user.sessionVersion);
    const { rows } = await db.pool.query(`SELECT "usedAt" FROM "PasswordResetToken" WHERE "userId" = $1`, [user.id]);
    assert.equal(rows[0].usedAt, null, "an expired link isn't marked used, just refused");
  });

  it("checks expiry at the final write, after waiting for the account lock", async (t) => {
    const user = await makeUser();
    const token = await tokens.issueResetToken(user.id);
    // Another change holds the account row (it changes nothing in the end).
    const holder = await openTransaction(db.pool);
    t.after(() => holder.rollback());
    await holder.query(`SELECT id FROM "User" WHERE id = $1 FOR UPDATE`, [user.id]);

    // The completion passes the cheap check, hashes, and queues for the lock.
    const completion = complete(token, "brand-new-password");
    await waitForLockWait(db.pool, 15_000);
    // Only now — well after it started waiting — does the link run out. A
    // completion that took "now" before its wait (or used the transaction's
    // start time) would still see the link as live.
    await sleep(100);
    await db.pool.query(
      `UPDATE "PasswordResetToken" SET "expiresAt" = ${UTC_CLOCK} - interval '50 milliseconds' WHERE "userId" = $1`,
      [user.id],
    );
    await holder.rollback();

    assert.match(errorOf(await completion), INVALID_LINK);
    assert.equal((await userRow(user.id)).passwordHash, ORIGINAL_HASH);
    const { rows } = await db.pool.query(`SELECT "usedAt" FROM "PasswordResetToken" WHERE "userId" = $1`, [user.id]);
    assert.equal(rows[0].usedAt, null);
  });

  it("refuses when the account is switched inactive while hashing", async () => {
    const user = await makeUser({ role: "DEN" });
    const token = await tokens.issueInviteToken(user.id);
    const pause = pauseFirstHash();
    const completion = complete(token, "brand-new-password");
    await pause.entered;
    await db.pool.query(`UPDATE "User" SET active = false, "sessionVersion" = "sessionVersion" + 1 WHERE id = $1`, [user.id]);
    pause.resume();

    const outcome = await completion;
    assert.match(errorOf(outcome), /inactive/);
    const final = await userRow(user.id);
    assert.equal(final.passwordHash, ORIGINAL_HASH);
    assert.equal(await auditCount("user.setOwnPassword", user.id), 0);
  });

  it("waits for a deactivation in progress, then refuses", async (t) => {
    const user = await makeUser({ role: "DEN" });
    const token = await tokens.issueInviteToken(user.id);
    // Switching the account off, not yet committed.
    const holder = await openTransaction(db.pool);
    t.after(() => holder.rollback());
    await holder.query(`UPDATE "User" SET active = false, "sessionVersion" = "sessionVersion" + 1 WHERE id = $1`, [user.id]);

    const completion = complete(token, "brand-new-password");
    await waitForLockWait(db.pool, 15_000);
    await holder.commit();

    assert.match(errorOf(await completion), /inactive/);
    assert.equal((await userRow(user.id)).passwordHash, ORIGINAL_HASH);
    assert.equal(await auditCount("user.setOwnPassword", user.id), 0);
  });

  it("refuses a link from an older generation even if it was never marked used", async () => {
    const user = await makeUser();
    const token = await tokens.issueResetToken(user.id);
    // As if something had moved the account on without marking this link.
    await db.pool.query(`UPDATE "User" SET "credentialVersion" = "credentialVersion" + 1 WHERE id = $1`, [user.id]);
    assert.equal(await usableLinkCount(user.id), 1, "the row itself still looks unused");
    assert.equal(await tokens.resetLinkStatus(token), "invalid");
    assert.match(errorOf(await complete(token, "brand-new-password")), INVALID_LINK);
    assert.equal((await userRow(user.id)).passwordHash, ORIGINAL_HASH);
  });

  it("refuses at the final write a link whose generation moved on while hashing", async () => {
    const user = await makeUser();
    const token = await tokens.issueResetToken(user.id);
    const pause = pauseFirstHash();
    const completion = complete(token, "brand-new-password");
    await pause.entered;
    await db.pool.query(`UPDATE "User" SET "credentialVersion" = "credentialVersion" + 1 WHERE id = $1`, [user.id]);
    pause.resume();
    assert.match(errorOf(await completion), INVALID_LINK);
    assert.equal((await userRow(user.id)).passwordHash, ORIGINAL_HASH);
  });

  it("refuses cleanly when the account is deleted while hashing", async () => {
    const user = await makeUser();
    const token = await tokens.issueResetToken(user.id);
    const pause = pauseFirstHash();
    const completion = complete(token, "brand-new-password");
    await pause.entered;
    await db.prisma.user.delete({ where: { id: user.id } });
    pause.resume();

    assert.match(errorOf(await completion), INVALID_LINK);
    assert.equal(await db.prisma.user.count({ where: { id: user.id } }), 0);
  });

  it("a password write that fails rolls back and leaves the link usable", async (t) => {
    const user = await makeUser({ username: "reset-write-fails" });
    const token = await tokens.issueResetToken(user.id);
    // A real database failure on the password write, for this account only.
    await db.pool.query(`
      CREATE FUNCTION test_refuse_password_write() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'simulated password write failure'; END $$`);
    await db.pool.query(`
      CREATE TRIGGER test_refuse_password_write BEFORE UPDATE OF "passwordHash" ON "User"
      FOR EACH ROW WHEN (NEW.username = 'reset-write-fails') EXECUTE FUNCTION test_refuse_password_write()`);
    t.after(async () => {
      await db.pool.query(`DROP TRIGGER IF EXISTS test_refuse_password_write ON "User"`);
      await db.pool.query(`DROP FUNCTION IF EXISTS test_refuse_password_write()`);
    });

    const failed = await complete(token, "brand-new-password");
    assert.match(errorOf(failed), /couldn't be saved/);
    assert.equal(await usableLinkCount(user.id), 1, "the link wasn't spent");
    assert.equal((await userRow(user.id)).sessionVersion, user.sessionVersion);
    assert.equal(await auditCount("user.setOwnPassword", user.id), 0);

    await db.pool.query(`DROP TRIGGER test_refuse_password_write ON "User"`);
    assert.equal((await complete(token, "brand-new-password")).kind, "redirect", "the same link works on retry");
  });
});

describe("issuing links", () => {
  it("two links issued at once leave exactly one usable (the later one)", async (t) => {
    const user = await makeUser();
    // Another issue mid-transaction: account row locked, a new link inserted.
    const holder = await openTransaction(db.pool);
    t.after(() => holder.rollback());
    await holder.query(`SELECT id FROM "User" WHERE id = $1 FOR UPDATE`, [user.id]);
    await holder.query(`UPDATE "PasswordResetToken" SET "usedAt" = ${UTC_NOW} WHERE "userId" = $1 AND "usedAt" IS NULL`, [user.id]);
    await holder.query(
      `INSERT INTO "PasswordResetToken" (id, "userId", "tokenHash", "expiresAt") VALUES ('holder-link', $1, 'holder-hash', ${UTC_NOW} + interval '1 hour')`,
      [user.id],
    );

    const issuing = tokens.issueResetToken(user.id);
    await waitForLockWait(db.pool);
    await holder.commit();
    const later = await issuing;

    assert.equal(await usableLinkCount(user.id), 1);
    const { rows } = await db.pool.query(`SELECT "usedAt" FROM "PasswordResetToken" WHERE id = 'holder-link'`);
    assert.notEqual(rows[0].usedAt, null, "the earlier link was spent by the later one");
    assert.equal(await tokens.resetLinkStatus(later), "usable");
  });

  it("concurrent issues for one account always leave a single usable link", async () => {
    for (let round = 0; round < 20; round++) {
      const user = await makeUser();
      const issued = await Promise.all([
        tokens.issueResetToken(user.id),
        tokens.issueInviteToken(user.id),
        tokens.issueResetToken(user.id),
      ]);
      assert.equal(await usableLinkCount(user.id), 1, `round ${round}`);
      const statuses = await Promise.all(issued.map((token) => tokens.resetLinkStatus(token)));
      assert.equal(statuses.filter((s) => s === "usable").length, 1, `round ${round}: one link works`);
    }
  });

  it("concurrent Admin resets leave one usable link and both revocations", async () => {
    const admin = await makeAdmin();
    const user = await makeUser();
    const results = await Promise.all([
      runAs(admin, () => users.resetPasswordAction(user.id)),
      runAs(admin, () => users.resetPasswordAction(user.id)),
    ]);
    const links = results.map((r) => linkFromResetResult(r));
    assert.equal(await usableLinkCount(user.id), 1);
    assert.equal((await userRow(user.id)).sessionVersion, user.sessionVersion + 2);
    const statuses = await Promise.all(links.map((link) => tokens.resetLinkStatus(link)));
    assert.deepEqual([...statuses].sort(), ["invalid", "usable"]);
    assert.equal(await auditCount("user.resetPassword", user.id), 2);
  });
});

describe("Admin reset", () => {
  it("kills the password and sessions, issues one link and emails it without a password", async () => {
    const admin = await makeAdmin();
    const user = await makeUser({ email: "family@example.test" });
    const earlier = await tokens.issueInviteToken(user.id);

    const result = await runAs(admin, () => users.resetPasswordAction(user.id));
    assert.deepEqual(result, { ok: true, emailedTo: "family@example.test" });
    const link = linkFromResetResult(result);

    const after = await userRow(user.id);
    assert.ok(!bcrypt.compareSync(ORIGINAL_PASSWORD, after.passwordHash), "the old password stopped working");
    assert.equal(after.sessionVersion, user.sessionVersion + 1);
    assert.equal(await tokens.resetLinkStatus(earlier), "invalid");
    assert.equal(await tokens.resetLinkStatus(link), "usable");
    assert.equal(await usableLinkCount(user.id), 1);

    const email = testState.emails.at(-1);
    assert.equal(email?.to, "family@example.test");
    // The link and the username, and no "Password: …" line of any kind.
    assert.ok(email?.text?.includes(`/portal/reset/${link}`));
    assert.ok(email?.text?.includes(`Username: ${user.username}`));
    assert.ok(!/^\s*(temporary\s+)?password\b/im.test(email?.text ?? ""), "no password in the email text");
    assert.ok(!/<strong>\s*(temporary\s+)?password/i.test(email?.html ?? ""), "no password in the email HTML");
    const entry = await db.prisma.auditLog.findFirstOrThrow({ where: { action: "user.resetPassword", entityId: user.id } });
    assert.equal(entry.actorUserId, admin.id);
  });

  it("commits all or nothing: a failure at any step leaves the password, sessions and old link as they were", async (t) => {
    // If the reset were split into more than one commit (the old shape: kill
    // the password, commit, then issue the link), an older link finished in
    // between would still be current and would overwrite the Admin's reset.
    // A real failure at each later step proves there is no such gap: nothing
    // is committed unless everything is.
    const admin = await makeAdmin();
    const steps: [string, string, (userId: string) => string][] = [
      ["issuing the new link", "PasswordResetToken", (userId) => `NEW."userId" = '${userId}'`],
      ["writing the audit entry", "AuditLog", (userId) => `NEW.action = 'user.resetPassword' AND NEW."entityId" = '${userId}'`],
    ];
    for (const [step, table, condition] of steps) {
      const user = await makeUser({ email: "all-or-nothing@example.test" });
      const oldLink = await tokens.issueResetToken(user.id);
      const before = await userRow(user.id);
      const lift = await failInsertsWhen(t, table, condition(user.id));
      const emailsBefore = testState.emails.length;

      const attempt = await settle(runAs(admin, () => users.resetPasswordAction(user.id)));

      const after = await userRow(user.id);
      assert.equal(after.passwordHash, before.passwordHash, `${step}: the password wasn't killed`);
      assert.equal(after.sessionVersion, before.sessionVersion, `${step}: no session was revoked`);
      assert.equal(after.credentialVersion, before.credentialVersion, `${step}: the link generation didn't move`);
      assert.equal(await tokens.resetLinkStatus(oldLink), "usable", `${step}: the old link is still the live one`);
      assert.equal(await usableLinkCount(user.id), 1, step);
      assert.equal(await auditCount("user.resetPassword", user.id), 0, `${step}: no audit entry for a change that didn't happen`);
      assert.equal(testState.emails.length, emailsBefore, `${step}: no email went out`);
      assert.ok(attempt.ok, `${step}: the Admin gets a message, not an error page`);
      assert.deepEqual(attempt.value, { ok: false, error: "The password couldn't be reset. Please try again in a moment." }, step);

      // With the failure gone, the same reset goes through and replaces the old link.
      await lift();
      const newLink = linkFromResetResult(await runAs(admin, () => users.resetPasswordAction(user.id)));
      assert.equal(await tokens.resetLinkStatus(oldLink), "invalid", step);
      assert.equal(await tokens.resetLinkStatus(newLink), "usable", step);
      assert.equal((await userRow(user.id)).sessionVersion, before.sessionVersion + 1, step);
    }
  });

  it("shows the link on screen when the account has no email", async () => {
    const admin = await makeAdmin();
    const user = await makeUser({ role: "DEN" });
    const result = await runAs(admin, () => users.resetPasswordAction(user.id));
    assert.equal(result.ok && "invite" in result && result.invite?.username, user.username);
    assert.equal(testState.emails.length, 0);
    assert.equal(await tokens.resetLinkStatus(linkFromResetResult(result)), "usable");
  });

  it("an ordinary Admin can't reset the master admin; nothing changes", async () => {
    const admin = await makeAdmin();
    const master = await makeUser({ role: "ADMIN", username: "mattrosen" });
    const counts = countBcrypt();
    const result = await runAs(admin, () => users.resetPasswordAction(master.id));
    assert.deepEqual(result, { ok: false, error: "Only a master admin can reset a master admin's password." });
    assert.equal(counts.hash, 0);
    const after = await userRow(master.id);
    assert.equal(after.passwordHash, ORIGINAL_HASH);
    assert.equal(after.sessionVersion, master.sessionVersion);
    assert.equal(await usableLinkCount(master.id), 0);

    // The master admin can.
    const result2 = await runAs(master, () => users.resetPasswordAction(admin.id));
    assert.equal(result2.ok, true);
  });

  it("non-Admins and unknown accounts are refused", async () => {
    const parent = await makeUser();
    const target = await makeUser();
    assert.deepEqual(await runAs(parent, () => users.resetPasswordAction(target.id)), { ok: false, error: "Not authorized." });
    const admin = await makeAdmin();
    assert.deepEqual(await runAs(admin, () => users.resetPasswordAction("no-such-user")), { ok: false, error: "User not found." });
    assert.equal((await userRow(target.id)).passwordHash, ORIGINAL_HASH);
  });
});

describe("creating an account with an invite", () => {
  it("creates the login and a usable invite together", async () => {
    const admin = await makeAdmin();
    const result = await runAs(admin, () => users.createAdminAction("new-photographer", "New Photographer", "PHOTOGRAPHER"));
    assert.equal(result.ok, true);
    const created = await db.prisma.user.findUniqueOrThrow({ where: { username: "new-photographer" } });
    assert.equal(created.role, "PHOTOGRAPHER");
    const link = result.ok && "invite" in result && result.invite ? tokenFromUrl(result.invite.url) : "";
    assert.equal(await tokens.resetLinkStatus(link), "usable");
    assert.equal(await auditCount("user.create", created.id), 1);
  });

  it("creates the login, its invite and its audit entry all or nothing", async (t) => {
    const admin = await makeAdmin();
    const username = "all-or-nothing-login";
    const steps: [string, string, string][] = [
      ["the invite", "PasswordResetToken", `(SELECT username FROM "User" WHERE id = NEW."userId") = '${username}'`],
      ["the audit entry", "AuditLog", `NEW.action = 'user.create' AND NEW."entityId" IN (SELECT id FROM "User" WHERE username = '${username}')`],
    ];
    for (const [step, table, condition] of steps) {
      const lift = await failInsertsWhen(t, table, condition);
      const attempt = await settle(
        runAs(admin, () => users.createAdminAction(username, "All Or Nothing", "PHOTOGRAPHER", "aon@example.test")),
      );
      assert.equal(await db.prisma.user.count({ where: { username } }), 0, `${step}: no login without its invite and record`);
      assert.equal(await db.prisma.auditLog.count({ where: { action: "user.create", summary: { contains: username } } }), 0, step);
      assert.equal(testState.emails.length, 0, `${step}: no invite email`);
      assert.ok(attempt.ok, `${step}: the Admin gets a message, not an error page`);
      assert.deepEqual(attempt.value, { ok: false, error: "The account couldn't be created. Please try again in a moment." }, step);
      await lift();
    }
    const created = await runAs(admin, () => users.createAdminAction(username, "All Or Nothing", "PHOTOGRAPHER", "aon@example.test"));
    assert.deepEqual(created, { ok: true, emailedTo: "aon@example.test" });
    const user = await db.prisma.user.findUniqueOrThrow({ where: { username } });
    assert.equal(await usableLinkCount(user.id), 1);
    assert.equal(await auditCount("user.create", user.id), 1);
  });

  it("two creates of the same username at once: one account, one readable refusal", async () => {
    const admin = await makeAdmin();
    const results = await Promise.all([
      runAs(admin, () => users.createAdminAction("same-name", "First", "PHOTOGRAPHER")),
      runAs(admin, () => users.createAdminAction("same-name", "Second", "PHOTOGRAPHER")),
    ]);
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.deepEqual(
      results.find((r) => !r.ok),
      { ok: false, error: "That username is already taken." },
    );
    assert.equal(await db.prisma.user.count({ where: { username: "same-name" } }), 1);
    const created = await db.prisma.user.findUniqueOrThrow({ where: { username: "same-name" } });
    assert.equal(await usableLinkCount(created.id), 1);
  });

  it("keeps the reserved and master-only guards", async () => {
    const admin = await makeAdmin();
    assert.deepEqual(await runAs(admin, () => users.createAdminAction("howell", "Squatter", "PHOTOGRAPHER")), {
      ok: false,
      error: "That username is reserved and can't be created from the admin panel.",
    });
    assert.deepEqual(await runAs(admin, () => users.createAdminAction("another-admin", "Another", "ADMIN")), {
      ok: false,
      error: "Only the master admin can create Admin accounts.",
    });
    assert.equal(await db.prisma.user.count({ where: { username: { in: ["howell", "another-admin"] } } }), 0);
  });

  it("rejects malformed or oversize input before any work", async () => {
    const admin = await makeAdmin();
    const counts = countBcrypt();
    const attempts = [
      () => users.createAdminAction("x".repeat(300), "Name", "PHOTOGRAPHER"),
      () => users.createAdminAction("okname", "n".repeat(500), "PHOTOGRAPHER"),
      () => users.createAdminAction("okname2", "Name", "PHOTOGRAPHER", "not an email"),
      () => users.createAdminAction(42 as unknown as string, "Name", "PHOTOGRAPHER"),
    ];
    for (const attempt of attempts) {
      const result = await runAs(admin, attempt);
      assert.equal(result.ok, false);
    }
    assert.equal(counts.hash, 0);
    assert.equal(await db.prisma.user.count({ where: { username: { in: ["okname", "okname2"] } } }), 0);
  });
});
