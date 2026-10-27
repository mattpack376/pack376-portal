/*
 * Every database check a migration adds only when existing rows allow it
 * (it RAISEs a NOTICE instead of failing) must be listed in
 * scripts/schema-guards.mjs, so the release build reports it if skipped.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { GUARDED_CONSTRAINTS, GUARDED_INDEXES } from "../../scripts/schema-guards.mjs";

const migrations = path.join(process.cwd(), "prisma", "migrations");

function guardedNamesIn(sql: string) {
  if (!/RAISE NOTICE/i.test(sql)) return [];
  const names = new Set<string>();
  for (const m of sql.matchAll(/ADD CONSTRAINT\s+"([^"]+)"/g)) names.add(m[1]);
  for (const m of sql.matchAll(/CREATE UNIQUE INDEX\s+(?:IF NOT EXISTS\s+)?"([^"]+)"/g)) names.add(m[1]);
  return [...names];
}

describe("guarded schema checks", () => {
  it("lists every check a migration may skip", () => {
    const listed = new Set([...GUARDED_CONSTRAINTS, ...GUARDED_INDEXES]);
    const unlisted: string[] = [];
    for (const dir of readdirSync(migrations)) {
      if (dir < "20261027000000") continue; // guards started with the Oct 27 fixes
      let sql: string;
      try {
        sql = readFileSync(path.join(migrations, dir, "migration.sql"), "utf8");
      } catch {
        continue;
      }
      // Only guarded objects: those created inside a DO block that can skip them.
      if (!/DO\s+\$\$/i.test(sql)) continue;
      for (const name of guardedNamesIn(sql)) if (!listed.has(name)) unlisted.push(`${dir}: ${name}`);
    }
    // EventGuestGroup_submissionKey_key is a plain unique index on a new,
    // all-NULL column — it can't be skipped, so it isn't listed.
    assert.deepEqual(unlisted.filter((n) => !n.endsWith("EventGuestGroup_submissionKey_key")), []);
  });
});
