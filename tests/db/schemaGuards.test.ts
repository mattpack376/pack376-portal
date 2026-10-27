import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withTestDatabase } from "../support/db";
import { missingSchemaGuards, reportSchemaGuards } from "../../scripts/schema-guards.mjs";

const db = withTestDatabase("schema_guards");

describe("schema guards after a clean migration", () => {
  it("are all in place", async () => {
    await db.ready;
    assert.deepEqual(await missingSchemaGuards(db.url), []);
  });

  it("are reported by name when one is missing", async () => {
    await db.ready;
    await db.pool.query(`ALTER TABLE "User" DROP CONSTRAINT "User_username_length_check"`);
    const lines: string[] = [];
    const log = { log: (m: string) => lines.push(m), warn: (m: string) => lines.push(m) };
    assert.deepEqual(await reportSchemaGuards(db.url, log), ["User_username_length_check"]);
    assert.match(lines.join("\n"), /WARNING: 1 database check\(s\) were skipped.*User_username_length_check/);
  });
});
