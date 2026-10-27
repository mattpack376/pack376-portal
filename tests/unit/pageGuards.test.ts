/*
 * Every signed-in portal page checks who is asking before it loads anything.
 * This reads each page.tsx under src/app/portal/(authed) (and /portal itself)
 * and checks that its component's first step — after reading the URL's
 * params/searchParams — is awaiting one of the authorize.ts guards, with no
 * database query or data loader started before it. (A data loader is an
 * async function and starts running as soon as it's called, awaited or not.)
 *
 * tests/db/pageGuards.test.ts runs the same pages as every role to prove the
 * guard turns away everyone the proxy does; this covers the order.
 *
 * Client pages ("use client") run in the browser and can't call a guard;
 * they must not load data at all — their Server Actions check the role.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, it } from "node:test";

// npm test runs from the repository root.
const ROOT = process.cwd();
const PORTAL = join(ROOT, "src", "app", "portal");

/** Client pages behind sign-in, with what keeps them safe. */
const CLIENT_PAGES: Record<string, string> = {
  "src/app/portal/(authed)/admin/albums/new/page.tsx": "a blank form; createAlbumAction checks assertAlbumEditAccess",
  "src/app/portal/(authed)/admin/dens/new/page.tsx": "a blank form; createDenAction checks assertAdmin",
};

/** The guards in src/lib/authorize.ts a page may open with. */
const GUARD = /\bawait\s+(require[A-Za-z]*Session|requireRaffleAccess)\(\)/;

function pageFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pageFiles(path);
    return name === "page.tsx" ? [path] : [];
  });
}

function withoutComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const pages = [...pageFiles(join(PORTAL, "(authed)")), join(PORTAL, "page.tsx")].map((path) => ({
  file: relative(ROOT, path).split(sep).join("/"),
  source: readFileSync(path, "utf8"),
}));
const isClient = (source: string) => /^\s*["']use client["']/.test(source);

describe("signed-in pages check the session before loading data", () => {
  it("finds the pages (so a moved folder can't make this test vacuous)", () => {
    assert.ok(pages.length >= 47, `only ${pages.length} pages found`);
    assert.ok(pages.some((page) => page.file === "src/app/portal/(authed)/admin/albums/[albumId]/page.tsx"));
  });

  for (const page of pages.filter((p) => !isClient(p.source))) {
    it(`${page.file} awaits its guard first`, () => {
      const start = page.source.indexOf("export default async function ");
      assert.ok(start >= 0, "no async default export");
      const component = withoutComments(page.source.slice(start));
      const guard = GUARD.exec(component);
      assert.ok(guard, "the page never awaits a require…Session() guard");

      // Everything before the guard: the signature, and at most reading params/searchParams.
      const beforeGuard = component.slice(0, guard.index).replace(/^export default async function \w+\(/, "");
      assert.doesNotMatch(beforeGuard, /\bprisma\b/, "a database query comes before the guard");
      for (const awaited of beforeGuard.matchAll(/\bawait\s+([\w.$]+)/g)) {
        assert.ok(["params", "searchParams"].includes(awaited[1]), `awaits ${awaited[1]} before the guard`);
      }
      const calls = [...beforeGuard.matchAll(/([A-Za-z_$][\w$.]*)\s*\(/g)].map((m) => m[1]);
      assert.deepEqual(calls, [], `calls ${calls.join(", ")} before the guard`);
    });
  }

  it("client pages are the known blank forms and load no data", () => {
    const clients = pages.filter((p) => isClient(p.source));
    assert.deepEqual(clients.map((p) => p.file).sort(), Object.keys(CLIENT_PAGES).sort());
    for (const page of clients) {
      assert.doesNotMatch(page.source, /from "@\/lib\/(prisma|auth|[A-Za-z]*Data)"/, `${page.file} imports a data module`);
    }
  });
});
