/*
 * The guards around changing a login (User row) and the 2026-11 hardening
 * that went with them:
 *
 * - the all-dens Den Leader test logins (ALL_DENS_TEST_USERNAMES, "denmatt")
 *   are master-only to change and reserved, like the master and ledger
 *   accounts, since the username alone opens every den;
 * - every Server Action that writes to a User row — or bumps its
 *   sessionVersion through a linked contact — asks assertCanMutateUser before
 *   its first write;
 * - the two payment deletes ask assertAdmin before any lookup;
 * - contact fields (name, email, phone) are bounded.
 *
 * The behaviour against a real database is in tests/db/userMutationGuards.test.ts;
 * this file checks the rules themselves and that each action is wired to them.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ALL_DENS_TEST_USERNAMES, isAllDensTestUsername } from "@/lib/denTestAccounts";
import { canSetUserActive, isMasterOnlyMutableUsername, isProtectedUsername } from "@/lib/masterAdmins";
import { assertCanMutateUser, isReservedUsername, MASTER_ONLY_ACCOUNT_MESSAGE } from "@/lib/authorize";
import { contactFieldsError, MAX_NAME_LENGTH, MAX_PHONE_LENGTH } from "@/lib/formValues";
import type { SessionPayload } from "@/lib/session";

const ROOT = process.cwd();

describe("all-dens Den Leader test logins", () => {
  it("are listed lowercase, and denmatt is one", () => {
    assert.ok(ALL_DENS_TEST_USERNAMES.includes("denmatt"));
    for (const username of ALL_DENS_TEST_USERNAMES) assert.equal(username, username.trim().toLowerCase());
  });

  it("are master-only to change, however the name is typed", () => {
    for (const username of ALL_DENS_TEST_USERNAMES) {
      assert.ok(isMasterOnlyMutableUsername(username), username);
      assert.ok(isMasterOnlyMutableUsername(` ${username.toUpperCase()} `), username);
    }
    assert.ok(!isMasterOnlyMutableUsername("denleader-someone"));
  });

  it("are reserved, so a freed name can't be created again from the admin panel", () => {
    for (const username of ALL_DENS_TEST_USERNAMES) {
      assert.ok(isReservedUsername(username), username);
      assert.ok(isReservedUsername(username.toUpperCase()), username);
    }
    // Reserved is wider than protected: a master admin can still delete one.
    for (const username of ALL_DENS_TEST_USERNAMES) assert.ok(!isProtectedUsername(username), username);
    assert.ok(!isReservedUsername("denleader-someone"));
  });

  it("can only be switched inactive by a master admin", () => {
    const target = { id: "u-test", username: "denmatt", role: "DEN" };
    assert.ok(isAllDensTestUsername(target.username));
    assert.equal(canSetUserActive({ userId: "u-admin", isMaster: false }, target), false);
    assert.equal(canSetUserActive({ userId: "u-master", isMaster: true }, target), true);
    // An ordinary Den Leader login stays switchable by any Admin.
    assert.equal(canSetUserActive({ userId: "u-admin", isMaster: false }, { ...target, username: "denleader-x" }), true);
  });

  it("assertCanMutateUser refuses a non-Admin session without needing the database", async () => {
    const session: SessionPayload = {
      userId: "u-den",
      role: "DEN",
      denIds: [],
      scoutIds: [],
      displayName: "Den Leader",
      sv: 0,
    };
    await assert.rejects(assertCanMutateUser(session, { username: "denmatt" }), { message: MASTER_ONLY_ACCOUNT_MESSAGE });
    // Not master-only: passes straight through.
    await assertCanMutateUser(session, { username: "denleader-someone" });
  });
});

/** The body of one exported async function, from its signature to the next top-level export. */
function functionBody(file: string, name: string): string {
  const source = readFileSync(join(ROOT, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const start = source.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${name} not found in ${file}`);
  const next = source.indexOf("\nexport ", start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

/** A write through Prisma: the first one a guard has to come before. */
const FIRST_WRITE =
  /\b(?:prisma|tx)\.(?:\$transaction|\w+\.(?:update|updateMany|create|createMany|delete|deleteMany|upsert))\(|\brefreshParentSession\(/;

describe("every User-row write asks assertCanMutateUser first", () => {
  const GUARDED: [file: string, action: string][] = [
    ["src/lib/actions/users.ts", "updateUserEmailAction"],
    ["src/lib/actions/users.ts", "updateUserPhoneAction"],
    ["src/lib/actions/users.ts", "updateUserDisplayNameAction"],
    ["src/lib/actions/users.ts", "updateUserRoleAction"],
    ["src/lib/actions/users.ts", "updateUserDensAction"],
    ["src/lib/actions/users.ts", "deleteUserAction"],
    ["src/lib/actions/users.ts", "resetPasswordAction"],
    ["src/lib/actions/parents.ts", "addParentAction"],
    ["src/lib/actions/parents.ts", "updateParentAction"],
    ["src/lib/actions/parents.ts", "removeParentAction"],
    ["src/lib/actions/parents.ts", "inviteParentPortalAction"],
    ["src/lib/actions/parents.ts", "unlinkParentScoutAction"],
    ["src/lib/actions/parents.ts", "attachParentToScoutAction"],
    ["src/lib/actions/parents.ts", "revokeParentPortalAction"],
    ["src/lib/actions/households.ts", "addUserToHouseholdAction"],
    ["src/lib/actions/households.ts", "removeUserFromHouseholdAction"],
  ];

  for (const [file, action] of GUARDED) {
    it(`${action} (${file})`, () => {
      const body = functionBody(file, action);
      const guard = body.search(/\bassertCanMutate(?:Linked)?User\(/);
      assert.ok(guard >= 0, "no assertCanMutateUser call");
      const write = body.search(FIRST_WRITE);
      assert.ok(write < 0 || guard < write, "a write comes before assertCanMutateUser");
    });
  }

  it("setUserActiveAction goes through canSetUserActive, which knows the master-only accounts", () => {
    assert.match(functionBody("src/lib/actions/users.ts", "setUserActiveAction"), /\bcanSetUserActive\(/);
    const source = readFileSync(join(ROOT, "src/lib/masterAdmins.ts"), "utf8");
    assert.match(source, /isMasterOnlyMutableUsername\(target\.username\) && !viewer\.isMaster/);
  });
});

describe("payment deletes check the Admin level before any lookup", () => {
  for (const action of ["deleteEventPaymentAction", "deleteGuestGroupPaymentAction"]) {
    it(action, () => {
      const body = functionBody("src/lib/actions/events.ts", action);
      const guard = body.indexOf("assertAdmin(session)");
      const lookup = body.indexOf("prisma.");
      assert.ok(guard >= 0, "no assertAdmin");
      assert.ok(lookup > guard, "a database lookup comes before assertAdmin");
    });
  }
});

describe("contactFieldsError", () => {
  it("accepts ordinary and blank contact details", () => {
    assert.equal(contactFieldsError({ name: "Pat Smith", email: "pat@example.com", phone: "(212)555-1234" }), null);
    assert.equal(contactFieldsError({ email: "", phone: "" }), null);
    assert.equal(contactFieldsError({}), null);
    assert.equal(contactFieldsError({ name: "x".repeat(MAX_NAME_LENGTH) }), null);
    assert.equal(contactFieldsError({ phone: "1".repeat(MAX_PHONE_LENGTH) }), null);
  });

  it("refuses over-long names and phones", () => {
    assert.match(contactFieldsError({ name: "x".repeat(MAX_NAME_LENGTH + 1) }) ?? "", /at most 120/);
    assert.match(contactFieldsError({ phone: "1".repeat(MAX_PHONE_LENGTH + 1) }) ?? "", /at most 40/);
  });

  it("refuses an email that isn't one plain address", () => {
    for (const email of ["not-an-email", "a@b.com, c@d.com", "Pat <pat@example.com>", `${"a".repeat(250)}@example.com`]) {
      assert.ok(contactFieldsError({ email }), email);
    }
  });

  it("refuses control characters, which Postgres can't always store", () => {
    assert.ok(contactFieldsError({ name: "Pat\u0000Smith" }));
    assert.ok(contactFieldsError({ phone: "555\n1234" }));
  });
});
