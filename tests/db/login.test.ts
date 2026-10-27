/*
 * loginAction against a real Postgres: input bounds and the firewall check
 * come before any database or bcrypt work, and the existing lockout and
 * sign-in audit trail still work.
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import bcrypt from "bcryptjs";
import { withTestDatabase } from "../support/db";
import { asAnonymous, form, resetTestState, settle, testState } from "../support/context";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import LoginView from "@/app/portal/login/LoginView";

const db = withTestDatabase("login");
let login: typeof import("@/app/portal/login/actions");

before(async () => {
  await db.ready;
  login = await import("@/app/portal/login/actions");
});

beforeEach(() => resetTestState());

const PASSWORD = "correct-horse-battery";
const HASH = bcrypt.hashSync(PASSWORD, 4);

async function makeUser(username: string, options: { active?: boolean } = {}) {
  return db.prisma.user.create({
    data: { username, passwordHash: HASH, role: "PARENT", displayName: username, active: options.active ?? true },
  });
}

async function signIn(username: string, password: string) {
  const { result, cookies } = await asAnonymous(() => settle(login.loginAction({}, form({ username, password }))));
  if (result.ok) return { kind: "state" as const, state: result.value };
  const to = (result.error as Error & { redirect?: string }).redirect;
  if (to) return { kind: "redirect" as const, to, cookie: cookies.get(SESSION_COOKIE) };
  throw result.error;
}

/** The state the action handed back; fails the test if it signed in instead. */
async function refusal(username: string, password: string) {
  const outcome = await signIn(username, password);
  assert.equal(outcome.kind, "state", `expected a refusal for ${username.slice(0, 40)}`);
  return outcome.kind === "state" ? outcome.state : {};
}

/** Which inputs the real form marks invalid for this state. */
function markedFields(state: Awaited<ReturnType<typeof refusal>>) {
  const html = renderToStaticMarkup(createElement(LoginView, { state, formAction: () => {}, pending: false }));
  return ["username", "password"].filter((id) => {
    const tag = html.match(new RegExp(`<input id="${id}"[^>]*>`))?.[0] ?? "";
    return /aria-invalid="true"/.test(tag) && /aria-describedby="login-error"/.test(tag);
  });
}

function countBcrypt() {
  const counts = { compare: 0 };
  testState.pauses["bcrypt.compare"] = async () => {
    counts.compare += 1;
  };
  return counts;
}

describe("loginAction", () => {
  it("refuses oversize input before any database or bcrypt work", async () => {
    await makeUser("bounded-user");
    const counts = countBcrypt();
    const before = await db.prisma.auditLog.count();
    for (const [username, password] of [
      ["u".repeat(10_000), PASSWORD],
      ["bounded-user", "p".repeat(100_000)],
    ]) {
      const outcome = await signIn(username, password);
      assert.equal(outcome.kind, "state");
      assert.equal(outcome.kind === "state" && outcome.state.error, "Invalid username or password.");
    }
    assert.equal(counts.compare, 0);
    assert.equal(await db.prisma.auditLog.count(), before, "no audit row per oversize request");
    assert.equal((await db.prisma.user.findUniqueOrThrow({ where: { username: "bounded-user" } })).failedLoginCount, 0);
  });

  it("writes nothing and checks no password while rate limited", async () => {
    await makeUser("limited-user");
    testState.rateLimited = true;
    const counts = countBcrypt();
    const before = await db.prisma.auditLog.count();
    const outcome = await signIn("limited-user", "wrong-password");
    assert.match(outcome.kind === "state" ? (outcome.state.error ?? "") : "", /Too many login attempts/);
    assert.equal(counts.compare, 0);
    assert.equal(await db.prisma.auditLog.count(), before);
    assert.equal((await db.prisma.user.findUniqueOrThrow({ where: { username: "limited-user" } })).failedLoginCount, 0);
  });

  it("keeps the username (never the password) after a refusal", async () => {
    await makeUser("keeps-name");
    const outcome = await signIn("  Keeps-Name ", "wrong-password");
    assert.equal(outcome.kind, "state");
    if (outcome.kind !== "state") return;
    assert.equal(outcome.state.username, "keeps-name");
    assert.ok(!JSON.stringify(outcome.state).includes("wrong-password"));
  });

  it("still counts failures, locks after five, and audits them", async () => {
    const user = await makeUser("lockout-user");
    for (let i = 0; i < 5; i++) await signIn("lockout-user", "wrong-password");
    const after = await db.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(after.failedLoginCount, 5);
    assert.ok(after.lockedUntil && after.lockedUntil > new Date());
    assert.equal(await db.prisma.auditLog.count({ where: { action: "auth.failed", entityId: user.id } }), 5);

    const locked = await signIn("lockout-user", PASSWORD);
    assert.match(locked.kind === "state" ? (locked.state.error ?? "") : "", /Too many failed attempts/);
  });

  it("signs in with the right password", async () => {
    const user = await makeUser("good-user");
    const outcome = await signIn("good-user", PASSWORD);
    assert.equal(outcome.kind, "redirect");
    if (outcome.kind !== "redirect") return;
    const session = await verifySessionToken(outcome.cookie ?? "");
    assert.equal(session?.userId, user.id);
    assert.equal(await db.prisma.auditLog.count({ where: { action: "auth.signIn", entityId: user.id } }), 1);
  });

  it("marks only the fields a refusal is about", async () => {
    const both = ["username", "password"];
    await makeUser("fields-user");
    await makeUser("fields-inactive", { active: false });

    // A wrong password and an unknown username get the same reply, marks
    // included, so the form says nothing about which usernames exist.
    const wrong = await refusal("fields-user", "wrong-password");
    const unknown = await refusal("no-such-user", "wrong-password");
    assert.deepEqual(wrong, { error: "Invalid username or password.", fields: both, username: "fields-user" });
    assert.deepEqual(unknown, { ...wrong, username: "no-such-user" });
    assert.deepEqual(await refusal("u".repeat(10_000), PASSWORD), { error: "Invalid username or password.", fields: both });
    assert.deepEqual(markedFields(wrong), both);
    assert.deepEqual(markedFields(unknown), both);

    // Blank (whitespace-only, which gets past the browser's `required`): only that field.
    assert.deepEqual(markedFields(await refusal("   ", PASSWORD)), ["username"]);
    assert.deepEqual(markedFields(await refusal("fields-user", "")), ["password"]);
    assert.deepEqual(markedFields(await refusal("", "")), both);

    // Refusals that aren't about what was typed are announced, but mark nothing.
    const inactive = await refusal("fields-inactive", PASSWORD);
    assert.match(inactive.error ?? "", /inactive/);
    assert.deepEqual(markedFields(inactive), []);
    for (let i = 0; i < 3; i++) await refusal("fields-user", "wrong-password");
    const locking = await refusal("fields-user", "wrong-password"); // the fifth failure in a row
    assert.match(locking.error ?? "", /Too many failed attempts/);
    assert.deepEqual(markedFields(locking), []);
    const locked = await refusal("fields-user", PASSWORD);
    assert.match(locked.error ?? "", /Too many failed attempts/);
    assert.deepEqual(markedFields(locked), []);
    testState.rateLimited = true;
    const limited = await refusal("fields-user", "wrong-password");
    assert.match(limited.error ?? "", /Too many login attempts/);
    assert.deepEqual(markedFields(limited), []);
  });

  it("asks for both fields when one is blank", async () => {
    const outcome = await signIn("", "");
    assert.equal(outcome.kind === "state" && outcome.state.error, "Enter a username and password.");
  });
});
