/*
 * Pages reached by a private link — a one-time consent or password link, an
 * album of scout photos shared with families — ask search engines not to
 * index or follow them. Checked in the source, since the pages need a
 * database to render.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = process.cwd();
const NOINDEX = /robots:\s*(?:\{\s*index:\s*false,\s*follow:\s*false\s*\}|NOINDEX)/;

describe("noindex on private-link pages", () => {
  for (const file of [
    "src/app/consent/[token]/page.tsx",
    "src/app/portal/reset/[token]/page.tsx",
    "src/app/gallery/[albumId]/page.tsx",
  ]) {
    it(file, () => {
      const source = readFileSync(join(ROOT, file), "utf8");
      assert.match(source, NOINDEX);
      if (source.includes("NOINDEX")) assert.match(source, /const NOINDEX = \{ index: false, follow: false \}/);
    });
  }

  it("every album answer carries it, found or not", () => {
    const source = readFileSync(join(ROOT, "src/app/gallery/[albumId]/page.tsx"), "utf8");
    const body = source.slice(source.indexOf("export async function generateMetadata"), source.indexOf("export default"));
    const returns = body.match(/return \{[\s\S]*?\};/g) ?? [];
    assert.ok(returns.length >= 2);
    for (const r of returns) assert.match(r, /robots: NOINDEX/);
  });
});
