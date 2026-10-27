/*
 * No login can exist that sign-in won't look up. Sign-in refuses a username
 * over MAX_USERNAME_LENGTH before touching the database; the
 * User_username_length_check constraint (migration
 * 20261027150001_limit_username_length) makes the database refuse to store
 * one, whichever screen sends it, and the migration itself is safe on a
 * database that already holds a longer name.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { before, beforeEach, describe, it } from "node:test";
import bcrypt from "bcryptjs";
import { withTestDatabase } from "../support/db";
import { asAnonymous, form, resetTestState, runAs, settle, testState } from "../support/context";
import { MAX_USERNAME_LENGTH, USERNAME_TOO_LONG_MESSAGE } from "@/lib/credentialInput";

const db = withTestDatabase("username_length");
let login: typeof import("@/app/portal/login/actions");
let users: typeof import("@/lib/actions/users");
let dens: typeof import("@/lib/actions/dens");
let parents: typeof import("@/lib/actions/parents");

before(async () => {
  await db.ready;
  login = await import("@/app/portal/login/actions");
  users = await import("@/lib/actions/users");
  dens = await import("@/lib/actions/dens");
  parents = await import("@/lib/actions/parents");
});

beforeEach(() => resetTestState());

const CONSTRAINT = "User_username_length_check";
const MIGRATION = path.join(process.cwd(), "prisma/migrations/20261027150001_limit_username_length/migration.sql");
const PASSWORD = "correct-horse-battery";
const HASH = bcrypt.hashSync(PASSWORD, 4);

/**
 * Names right at the limit, counted the way the database counts (UTF-8
 * bytes), from a one-byte, a two-byte and a four-byte character. Each test
 * picks its own characters so the names never collide.
 */
function atLimit(ascii: string, accented: string, emoji: string) {
  return {
    ascii: ascii.repeat(MAX_USERNAME_LENGTH),
    accented: accented.repeat(MAX_USERNAME_LENGTH / 2), // 127 characters, 254 bytes
    emoji: emoji.repeat(Math.floor(MAX_USERNAME_LENGTH / 4)), // 63 emoji, 252 bytes
  };
}

/**
 * Names just past it. The accented one is only 128 characters: under the
 * limit by character count, over it in bytes.
 */
const OVER_LIMIT = {
  ascii: "a".repeat(MAX_USERNAME_LENGTH + 1),
  accented: "é".repeat(MAX_USERNAME_LENGTH / 2 + 1),
  emoji: "😀".repeat(Math.floor(MAX_USERNAME_LENGTH / 4) + 1),
};

let sequence = 0;
async function makeUser(username: string, role: "ADMIN" | "PARENT" = "PARENT") {
  sequence += 1;
  return db.prisma.user.create({ data: { username, passwordHash: HASH, role, displayName: `Length User ${sequence}` } });
}

async function insertUsername(username: string) {
  sequence += 1;
  return db.pool.query(
    `INSERT INTO "User" (id, username, "passwordHash", role, "displayName", "updatedAt")
     VALUES ($1, $2, 'not-a-hash', 'PARENT', 'Raw insert', now())`,
    [`raw-${sequence}`, username],
  );
}

async function constraintExists() {
  const { rows } = await db.pool.query(
    `SELECT 1 FROM pg_constraint WHERE conname = $1 AND conrelid = '"User"'::regclass`,
    [CONSTRAINT],
  );
  return rows.length === 1;
}

async function signIn(username: string, password: string) {
  const { result } = await asAnonymous(() => settle(login.loginAction({}, form({ username, password }))));
  if (result.ok) return { kind: "state" as const, state: result.value };
  const to = (result.error as Error & { redirect?: string }).redirect;
  if (to) return { kind: "redirect" as const, to };
  throw result.error;
}

/** Refused, either with a message or by the database's error. */
function refused(attempt: Awaited<ReturnType<typeof settle>>) {
  if (!attempt.ok) return true;
  const value = attempt.value as { ok?: boolean; error?: string } | undefined;
  return value?.ok === false || Boolean(value?.error);
}

describe("username length", () => {
  it("the database refuses a username sign-in wouldn't look up", async () => {
    assert.equal(await constraintExists(), true);
    for (const [label, username] of Object.entries(atLimit("a", "é", "😀"))) {
      await assert.doesNotReject(insertUsername(username), label);
    }
    for (const [label, username] of Object.entries(OVER_LIMIT)) {
      await assert.rejects(insertUsername(username), { code: "23514", constraint: CONSTRAINT }, label);
    }
    // Renaming an existing login is held to the same limit.
    const user = await makeUser("short-name");
    await assert.rejects(
      db.pool.query(`UPDATE "User" SET username = $1 WHERE id = $2`, [OVER_LIMIT.ascii, user.id]),
      { code: "23514", constraint: CONSTRAINT },
    );
  });

  it("every login the database allows can sign in", async () => {
    for (const [label, username] of Object.entries(atLimit("b", "è", "😃"))) {
      await makeUser(username);
      const outcome = await signIn(username, PASSWORD);
      assert.equal(outcome.kind, "redirect", `${label}: signed in`);
    }
  });

  it("an Admin creating a login gets a readable refusal, counted in bytes like the database", async () => {
    const admin = await makeUser("length-admin", "ADMIN");
    const counts = { hash: 0 };
    testState.pauses["bcrypt.hash"] = async () => {
      counts.hash += 1;
    };
    for (const [label, username] of Object.entries(OVER_LIMIT)) {
      const result = await runAs(admin, () => users.createAdminAction(username, "Too Long", "PHOTOGRAPHER"));
      assert.deepEqual(result, { ok: false, error: USERNAME_TOO_LONG_MESSAGE }, label);
    }
    assert.equal(counts.hash, 0, "refused before any work");
    assert.equal(await db.prisma.user.count({ where: { displayName: "Too Long" } }), 0);

    const fits = atLimit("c", "ê", "😄").accented;
    const created = await runAs(admin, () => users.createAdminAction(fits, "Just Fits", "PHOTOGRAPHER"));
    assert.equal(created.ok, true);
    assert.equal((await db.prisma.user.findUniqueOrThrow({ where: { username: fits } })).displayName, "Just Fits");
  });

  it("screens that don't check the limit themselves still can't create such a login", async () => {
    // Den logins, manual Parent Portal accounts and parent invites (src/lib/actions/dens.ts and
    // parents.ts) don't check the length before creating the login. The database stops them,
    // so no login exists that could use its invite link once and then never sign in again.
    const admin = await makeUser("length-admin-2", "ADMIN");
    const denLogin = `den-${"d".repeat(MAX_USERNAME_LENGTH)}`;
    const denAttempt = await settle(
      runAs(admin, () =>
        dens.createDenAction(
          {},
          form({ rank: "WOLF", scoutingYear: "2026-2027", label: "Long Login", createLogin: "on", username: denLogin }),
        ),
      ),
    );
    assert.ok(refused(denAttempt), "den login refused");

    const parentLogin = `parent-${"p".repeat(MAX_USERNAME_LENGTH)}`;
    const parentAttempt = await settle(runAs(admin, () => parents.createParentAccountAction(parentLogin, "Long Login Parent")));
    assert.ok(refused(parentAttempt), "manual parent account refused");

    const den = await db.prisma.den.create({ data: { rank: "BEAR", scoutingYear: "2026-2027", label: "Invite Den" } });
    const scout = await db.prisma.scout.create({ data: { denId: den.id, firstName: "Long", lastName: "Email" } });
    const longEmail = `${"e".repeat(MAX_USERNAME_LENGTH)}@example.test`;
    const contact = await db.prisma.parent.create({ data: { scoutId: scout.id, name: "Long Email Parent", email: longEmail } });
    const inviteAttempt = await settle(runAs(admin, () => parents.inviteParentPortalAction(contact.id)));
    assert.ok(refused(inviteAttempt), "parent invite refused");

    assert.equal(await db.prisma.user.count({ where: { username: { in: [denLogin, parentLogin, longEmail] } } }), 0);
    assert.equal((await db.prisma.parent.findUniqueOrThrow({ where: { id: contact.id } })).userId, null);
    assert.equal(testState.emails.length, 0, "no invite went out");
  });

  // Last: it drops and re-adds the constraint on this file's database.
  it("the migration skips the constraint, with a notice, when an existing login is already too long", async () => {
    const sql = readFileSync(MIGRATION, "utf8");
    const client = await db.pool.connect();
    const notices: string[] = [];
    client.on("notice", (notice) => notices.push(notice.message ?? ""));
    try {
      // As if production already held a longer name when this migration ran.
      await client.query(`ALTER TABLE "User" DROP CONSTRAINT "${CONSTRAINT}"`);
      await client.query(
        `INSERT INTO "User" (id, username, "passwordHash", role, "displayName", "updatedAt")
         VALUES ('legacy-long', $1, 'not-a-hash', 'PARENT', 'Legacy', now())`,
        [OVER_LIMIT.accented],
      );

      await client.query(sql);
      assert.equal(await constraintExists(), false, "not added over a row that breaks it");
      assert.ok(notices.some((message) => /Skipped User_username_length_check: 1 existing username/.test(message)), notices.join("; "));
      // The deploy carries on, and the long row can still be edited.
      await client.query(`UPDATE "User" SET "sessionVersion" = "sessionVersion" + 1 WHERE id = 'legacy-long'`);

      // Once the row is shortened, the same migration adds the constraint.
      await client.query(`UPDATE "User" SET username = 'legacy-shortened' WHERE id = 'legacy-long'`);
      await client.query(sql);
      assert.equal(await constraintExists(), true);
      await assert.rejects(insertUsername(OVER_LIMIT.ascii), { code: "23514", constraint: CONSTRAINT });
    } finally {
      client.release();
    }
  });
});
