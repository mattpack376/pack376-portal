/*
 * Every signed-in portal page turns away, by itself, everyone the proxy
 * turns away. Each real page module under src/app/portal/(authed) (plus the
 * /portal landing page) is imported and called the way Next calls it, as each
 * role and as an anonymous visitor; whoever src/proxy.ts would redirect must
 * get a redirect from the page too, before it renders anything.
 *
 * tests/db/authorize.test.ts proves the guard functions are never looser than
 * the proxy; this proves each page actually calls one. Deleting a page's
 * guard, or going back to a bare getSession(), makes the page render (or
 * fail some other way) for a refused role, and this test fails.
 * tests/unit/pageGuards.test.ts checks the guard runs before any data loads.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { before, describe, it } from "node:test";
import { withTestDatabase } from "../support/db";
import { asAnonymous, runAs, settle, type SessionUser } from "../support/context";

const db = withTestDatabase("page_guards");

let proxyModule: typeof import("@/proxy");
let session: typeof import("@/lib/session");
let nextServer: typeof import("next/server");

type Role = SessionUser["role"];
const ALL_ROLES: Role[] = [
  "ADMIN",
  "JUNIOR_ADMIN",
  "COMMITTEE",
  "DEN",
  "ATTENDANCE_ADMIN",
  "PHOTOGRAPHER",
  "PARENT",
  "TRIP_VIEWER",
];

const users: Record<string, SessionUser> = {};

// npm run test:db runs from the repository root.
const ROOT = process.cwd();
const PORTAL = join(ROOT, "src", "app", "portal");

function pageFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pageFiles(path);
    return name === "page.tsx" ? [path] : [];
  });
}

type Page = {
  file: string;
  /** The URL path the page is served at, with a sample value for each [param]. */
  path: string;
  params: Record<string, string>;
  load: () => Promise<{ default: (props: unknown) => unknown }>;
};

/** Every server-rendered page behind sign-in: the (authed) group and /portal itself. */
const PAGES: Page[] = [...pageFiles(join(PORTAL, "(authed)")), join(PORTAL, "page.tsx")]
  .filter((path) => !/^\s*["']use client["']/.test(readFileSync(path, "utf8")))
  .map((path) => {
    const file = relative(ROOT, path).split(sep).join("/");
    const params: Record<string, string> = {};
    const segments = relative(join(ROOT, "src", "app"), path)
      .split(sep)
      .slice(0, -1)
      .filter((segment) => !/^\(.*\)$/.test(segment))
      .map((segment) => {
        const param = /^\[([A-Za-z]+)\]$/.exec(segment);
        if (!param) return segment;
        params[param[1]] = `sample-${param[1].toLowerCase()}`;
        return params[param[1]];
      });
    const specifier = `@/${relative(join(ROOT, "src"), path).split(sep).join("/").replace(/\.tsx$/, "")}`;
    return { file, path: `/${segments.join("/")}`, params, load: () => import(specifier) };
  });

before(async () => {
  await db.ready;
  proxyModule = await import("@/proxy");
  session = await import("@/lib/session");
  nextServer = await import("next/server");

  const den = await db.prisma.den.create({ data: { rank: "WOLF", scoutingYear: "2026-2027" } });

  async function make(key: string, role: Role, extra: { username?: string; denIds?: string[] } = {}) {
    const user = await db.prisma.user.create({
      data: { username: extra.username ?? `pages-${key.toLowerCase()}`, passwordHash: "x", role, displayName: key },
    });
    for (const id of extra.denIds ?? []) {
      await db.prisma.denAssignment.create({ data: { userId: user.id, denId: id } });
    }
    users[key] = { id: user.id, role, sessionVersion: 0, denIds: extra.denIds ?? [] };
  }

  for (const role of ALL_ROLES) await make(role, role, role === "DEN" ? { denIds: [den.id] } : {});
  await make("DEN_WITHOUT_DEN", "DEN");
  await make("COMMITTEE_WITH_DEN", "COMMITTEE", { denIds: [den.id] });
  await make("MASTER", "ADMIN", { username: "mattrosen" });
});

/** Whether src/proxy.ts lets this visitor (null = no cookie) through to `path`. */
async function proxyAllows(user: SessionUser | null, path: string): Promise<boolean> {
  const headers: Record<string, string> = {};
  if (user) {
    const { token } = await session.signSession({
      userId: user.id,
      role: user.role,
      denIds: user.denIds ?? [],
      scoutIds: [],
      displayName: "Proxy test",
      sv: user.sessionVersion,
    });
    headers.cookie = `${session.SESSION_COOKIE}=${token}`;
  }
  const response = await proxyModule.proxy(new nextServer.NextRequest(`https://pack376nyc.org${path}`, { headers }));
  return !response.headers.get("location");
}

/** Calls the page as Next would and reports where it redirected, or why it didn't. */
async function render(page: Page, user: SessionUser | null): Promise<{ redirect: string } | { other: string }> {
  const { default: Page } = await page.load();
  const props = { params: Promise.resolve(page.params), searchParams: Promise.resolve({}) };
  const call = async () => Page(props);
  const result = await settle(user ? runAs(user, call) : asAnonymous(call).then((r) => r.result));
  if (result.ok) return { other: "rendered" };
  const target = (result.error as Error & { redirect?: string }).redirect;
  return target ? { redirect: target } : { other: `threw ${result.error.message}` };
}

describe("signed-in pages guard themselves", () => {
  it("finds the pages (so a moved folder can't make this test vacuous)", () => {
    assert.ok(PAGES.length >= 45, `only ${PAGES.length} pages found`);
    for (const known of [
      "/portal/roster",
      "/portal/admin/albums/sample-albumid",
      "/portal/admin/attendance/leaders/sample-meetingdateid",
      "/portal/admin/dens/sample-denid/promote",
      "/portal/den",
      "/portal",
    ]) {
      assert.ok(PAGES.some((page) => page.path === known), `${known} missing`);
    }
  });

  for (const page of PAGES) {
    it(`${page.file} refuses everyone the proxy refuses`, async () => {
      const visitors: [string, SessionUser | null][] = [["anonymous", null], ...Object.entries(users)];
      let refusedByProxy = 0;
      for (const [key, user] of visitors) {
        if (await proxyAllows(user, page.path)) continue;
        refusedByProxy += 1;
        const outcome = await render(page, user);
        assert.ok("redirect" in outcome, `${key} is sent away by the proxy, but the page ${"other" in outcome ? outcome.other : ""}`);
        if (!user) assert.equal(outcome.redirect, "/portal/login", "anonymous visitors go to sign-in");
      }
      // At least the anonymous visitor is always refused.
      assert.ok(refusedByProxy >= 1);
    });
  }
});
