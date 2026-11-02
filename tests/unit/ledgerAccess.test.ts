/*
 * The Ledger is for two named accounts, not a role, so the general page-guard
 * tests can't tell its guard from a plain requireAdminSession(). This checks
 * the parts that make it two people:
 *
 * - every ledger name is lowercase (usernames are stored that way) and
 *   protected, so it can't be deleted and then recreated by someone else;
 * - only a master admin may change a ledger account;
 * - every page and route under admin/ledger opens with exactly
 *   `await requireLedgerSession()`, before anything else.
 *
 * tests/db/ledger.test.ts checks every exported action refuses everyone else.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, it } from "node:test";
import {
  LEDGER_USERNAMES,
  MASTER_ADMIN_USERNAMES,
  PROTECTED_USERNAMES,
  isLedgerUsername,
  isMasterOnlyMutableUsername,
} from "@/lib/masterAdmins";

// npm test runs from the repository root.
const ROOT = process.cwd();
const LEDGER_DIR = join(ROOT, "src", "app", "portal", "(authed)", "admin", "ledger");

describe("ledger accounts", () => {
  it("are lowercase and protected", () => {
    assert.ok(LEDGER_USERNAMES.length > 0);
    for (const username of LEDGER_USERNAMES) {
      assert.equal(username, username.trim().toLowerCase(), `${username} isn't stored lowercase`);
      assert.ok(PROTECTED_USERNAMES.includes(username), `${username} isn't in PROTECTED_USERNAMES`);
    }
  });

  it("are recognized however the name is typed", () => {
    for (const username of LEDGER_USERNAMES) {
      assert.ok(isLedgerUsername(` ${username.toUpperCase()} `));
    }
    assert.ok(!isLedgerUsername("howell"));
    assert.ok(!isLedgerUsername("someone-else"));
  });

  it("can only be changed by a master admin, like the master admins themselves", () => {
    for (const username of [...LEDGER_USERNAMES, ...MASTER_ADMIN_USERNAMES]) {
      assert.ok(isMasterOnlyMutableUsername(username), username);
    }
    // A protected but ordinary Admin stays editable by any Admin.
    assert.ok(!isMasterOnlyMutableUsername("howell"));
    assert.ok(!isMasterOnlyMutableUsername("someone-else"));
  });
});

function ledgerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return ledgerFiles(path);
    return /^(page\.tsx|route\.ts)$/.test(name) ? [path] : [];
  });
}

function withoutComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("ledger pages and routes", () => {
  const files = ledgerFiles(LEDGER_DIR).map((path) => ({
    file: relative(ROOT, path).split(sep).join("/"),
    source: withoutComments(readFileSync(path, "utf8")),
  }));

  it("finds them (so a moved folder can't make this test vacuous)", () => {
    const names = files.map((f) => f.file);
    for (const known of [
      "src/app/portal/(authed)/admin/ledger/page.tsx",
      "src/app/portal/(authed)/admin/ledger/categories/page.tsx",
      "src/app/portal/(authed)/admin/ledger/import/page.tsx",
      "src/app/portal/(authed)/admin/ledger/export/route.ts",
    ]) {
      assert.ok(names.includes(known), `${known} missing`);
    }
  });

  for (const { file, source } of files) {
    it(`${file} opens with await requireLedgerSession()`, () => {
      assert.doesNotMatch(source, /^\s*["']use client["']/, "a ledger page must render on the server");
      const start = /export (default )?async function \w+\(/.exec(source);
      assert.ok(start, "no async page component or route handler");
      // The body starts at the first ") {" that ends a line: the end of the signature.
      const rest = source.slice(start.index + start[0].length);
      const signatureEnd = /\)(\s*:\s*[^{\n]+)?\s*\{[ \t]*\n/.exec(rest);
      assert.ok(signatureEnd, "can't find where the function body starts");
      const body = rest.slice(signatureEnd.index + signatureEnd[0].length);
      assert.match(body, /^\s*await requireLedgerSession\(\);/, "the first statement isn't await requireLedgerSession()");
      // No other guard stands in for it anywhere in the file.
      assert.doesNotMatch(source, /\brequire(?!Ledger)[A-Za-z]*Session\(/, "uses a different require…Session guard");
      assert.match(source, /export const maxDuration = 60;/, "no maxDuration");
    });
  }
});
