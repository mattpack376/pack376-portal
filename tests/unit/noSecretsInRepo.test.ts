/*
 * The repository is public. This reads every tracked text file and fails on
 * anything that looks like a Google service-account key, a service-account
 * email, or a link to a Google spreadsheet (the ledger Sheet holds family
 * names and amounts). Those belong in Vercel's environment variables only;
 * docs use placeholders. Tests make their keys at run time.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

// npm test runs from the repository root.
const ROOT = process.cwd();
/** This file names the patterns (split up, but allow-listed anyway). */
const ALLOWED = new Set(["tests/unit/noSecretsInRepo.test.ts"]);
/** Built in pieces so no file, this one included, holds them whole. */
const PATTERNS = [
  ["-----BEGIN", " PRIVATE KEY-----"].join(""),
  ["iam.gservice", "account.com"].join(""),
  ["docs.google.com", "/spreadsheets/d/"].join(""),
];
const MAX_BYTES = 5_000_000;

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8", maxBuffer: 50_000_000 })
    .split("\0")
    .filter(Boolean);
}

describe("no secrets in tracked files", () => {
  const files = trackedFiles();

  it("finds the tracked files (so this can't pass vacuously)", () => {
    assert.ok(files.length > 100, `only ${files.length} tracked files`);
    assert.ok(files.includes("package.json"));
  });

  it("no tracked text file holds a private key, a service-account email or a spreadsheet link", () => {
    const hits: string[] = [];
    for (const file of files) {
      if (ALLOWED.has(file)) continue;
      const path = join(ROOT, file);
      let size: number;
      try {
        const stat = statSync(path);
        if (!stat.isFile()) continue;
        size = stat.size;
      } catch {
        continue; // deleted in the working tree
      }
      if (size > MAX_BYTES) continue;
      const buffer = readFileSync(path);
      if (buffer.subarray(0, 8000).includes(0)) continue; // binary
      const text = buffer.toString("utf8");
      for (const pattern of PATTERNS) if (text.includes(pattern)) hits.push(`${file}: ${pattern}`);
    }
    assert.deepEqual(hits, []);
  });
});
