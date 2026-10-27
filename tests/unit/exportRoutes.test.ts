/*
 * Every route handler in src/app is a file download of private records (CSV
 * or PDF) except the few listed in NOT_DOWNLOADS. This reads their source and
 * checks each one (a) asks who is calling before building anything and (b)
 * answers with "Cache-Control: private, no-store", either spelled out or
 * through one of the shared helpers whose headers tests/unit/csv.test.ts
 * checks at run time. A new export route that forgets either fails here.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, it } from "node:test";

// npm test runs from the repository root.
const ROOT = process.cwd();
const APP = join(ROOT, "src", "app");

/** Route handlers that send no private file, with why. */
const NOT_DOWNLOADS: Record<string, string> = {
  "src/app/portal/logout/route.ts": "clears the session cookie and redirects; no data",
};

/** Helpers that build the whole download response with the private, no-store header. */
const NO_STORE_HELPERS = [
  "csvResponse",
  "parentsPdfResponse",
  "registrationsCsvResponse",
  "expensesCsvResponse",
  "expensesPdfResponse",
];

/** Ways a route establishes who is asking (each then checks the role or den). */
const AUTH_CHECKS = [/\bgetSession\(\)/, /\brequire[A-Za-z]*Session\(\)/, /\bloadPhotoConsentExport\(/];

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return /^route\.(ts|tsx|js|mjs)$/.test(name) ? [path] : [];
  });
}

function posix(path: string) {
  return relative(ROOT, path).split(sep).join("/");
}

const routes = routeFiles(APP).map((path) => ({ file: posix(path), source: readFileSync(path, "utf8") }));
const downloads = routes.filter((route) => !(route.file in NOT_DOWNLOADS));

describe("export and download routes", () => {
  it("finds the known exports (so a moved folder can't make this test vacuous)", () => {
    assert.ok(downloads.length >= 20, `only ${downloads.length} download routes found`);
    for (const known of [
      "src/app/api/parents/export/route.ts",
      "src/app/portal/(authed)/admin/raffles/[raffleId]/export/route.ts",
      "src/app/portal/(authed)/admin/events/guests/export/route.ts",
      "src/app/portal/(authed)/admin/cyclones/export/route.ts",
      "src/app/api/photo-consent/export/pdf/route.ts",
    ]) {
      assert.ok(downloads.some((route) => route.file === known), `${known} missing`);
    }
  });

  for (const route of downloads) {
    it(`${route.file} checks the session and sends private, no-store`, () => {
      assert.ok(
        AUTH_CHECKS.some((pattern) => pattern.test(route.source)),
        "no session/authorization check found",
      );

      const helperCalls = NO_STORE_HELPERS.filter((helper) => new RegExp(`\\b${helper}\\(`).test(route.source));
      const inlineHeaders = (route.source.match(/"Cache-Control":\s*"private, no-store"/g) ?? []).length;
      const dispositions = (route.source.match(/"Content-Disposition"/g) ?? []).length;
      assert.ok(helperCalls.length > 0 || inlineHeaders > 0, "neither a no-store helper nor an inline header");
      // Every response this file builds by hand carries the header next to its filename.
      assert.ok(inlineHeaders >= dispositions, "a hand-built download is missing private, no-store");
    });
  }

  it("the trip export helpers only answer through the no-store helpers", () => {
    const source = readFileSync(join(ROOT, "src", "lib", "tripExports.ts"), "utf8");
    assert.doesNotMatch(source, /new (Next)?Response\(/);
    assert.match(source, /\bcsvResponse\(/);
    assert.match(source, /\bparentsPdfResponse\(/);
  });

  it("the photo consent exports check the session in their loader", () => {
    const source = readFileSync(join(ROOT, "src", "lib", "photoConsentExport.ts"), "utf8");
    assert.match(source, /\bgetSession\(\)/);
  });
});
