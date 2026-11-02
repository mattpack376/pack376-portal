/*
 * Page and route guards against the real session checks (runAs signs a real
 * token; getSession reads the user row). Two things are checked:
 *
 * 1. requireRosterSession is an explicit list of staff roles: the PARENT and
 *    shared TRIP_VIEWER logins are turned away on the page itself, not only
 *    by the proxy.
 * 2. For every guarded page and admin export, the page's own guard is never
 *    looser than the proxy's rule for that path: whatever src/proxy.ts sends
 *    away, the guard sends away too, so a change to rewrites or rules can't
 *    quietly make the proxy the only boundary. The proxy is run for real
 *    (NextRequest with a signed cookie) rather than re-stating its rules.
 *
 * Also runs the /api export routes as each role: refusals for roles without
 * access, and a private, no-store file for those with it.
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { withTestDatabase } from "../support/db";
import { runAs, settle, type SessionUser } from "../support/context";

const db = withTestDatabase("authorize");

let authz: typeof import("@/lib/authorize");
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

/** One login per role, plus the variants guards treat differently. */
const users: Record<string, SessionUser & { username: string }> = {};
let denId = "";

before(async () => {
  await db.ready;
  authz = await import("@/lib/authorize");
  proxyModule = await import("@/proxy");
  session = await import("@/lib/session");
  nextServer = await import("next/server");

  const den = await db.prisma.den.create({ data: { rank: "WOLF", scoutingYear: "2026-2027" } });
  denId = den.id;

  async function make(key: string, role: Role, extra: { username?: string; denIds?: string[] } = {}) {
    const username = extra.username ?? `authz-${key.toLowerCase()}`;
    const user = await db.prisma.user.create({
      data: { username, passwordHash: "x", role, displayName: key },
    });
    for (const id of extra.denIds ?? []) {
      await db.prisma.denAssignment.create({ data: { userId: user.id, denId: id } });
    }
    users[key] = { id: user.id, role, sessionVersion: 0, denIds: extra.denIds ?? [], username };
  }

  for (const role of ALL_ROLES) await make(role, role, role === "DEN" ? { denIds: [denId] } : {});
  await make("COMMITTEE_WITH_DEN", "COMMITTEE", { denIds: [denId] });
  await make("MASTER", "ADMIN", { username: "mattrosen" });
  // The other ledger account (LEDGER_USERNAMES): an ordinary Admin otherwise.
  await make("LEDGER", "ADMIN", { username: "dianaliz" });
});

/** What the guard did: null when it let the user through, else where it redirected. */
async function guardOutcome(user: SessionUser, guard: () => Promise<unknown>): Promise<string | null> {
  const result = await settle(runAs(user, guard));
  if (result.ok) return null;
  const target = (result.error as Error & { redirect?: string }).redirect;
  if (!target) throw result.error;
  return target;
}

/** Whether src/proxy.ts lets this user's cookie through to `path`. */
async function proxyAllows(user: SessionUser, path: string): Promise<boolean> {
  const { token } = await session.signSession({
    userId: user.id,
    role: user.role,
    denIds: user.denIds ?? [],
    scoutIds: [],
    displayName: "Proxy test",
    sv: user.sessionVersion,
  });
  const request = new nextServer.NextRequest(`https://pack376nyc.org${path}`, {
    headers: { cookie: `${session.SESSION_COOKIE}=${token}` },
  });
  const response = await proxyModule.proxy(request);
  return !response.headers.get("location");
}

describe("requireRosterSession", () => {
  it("lets every staff level in", async () => {
    for (const key of ["ADMIN", "JUNIOR_ADMIN", "COMMITTEE", "DEN", "ATTENDANCE_ADMIN", "PHOTOGRAPHER", "MASTER"]) {
      assert.equal(await guardOutcome(users[key], () => authz.requireRosterSession()), null, key);
    }
  });

  it("turns away the shared Trip Viewer login and parent accounts", async () => {
    assert.equal(
      await guardOutcome(users.TRIP_VIEWER, () => authz.requireRosterSession()),
      session.homeForRole("TRIP_VIEWER"),
    );
    assert.equal(await guardOutcome(users.PARENT, () => authz.requireRosterSession()), session.homeForRole("PARENT"));
  });

  it("lists exactly the roles the proxy's /portal/roster rule allows", async () => {
    for (const role of ALL_ROLES) {
      assert.equal(authz.ROSTER_ROLES.includes(role), await proxyAllows(users[role], "/portal/roster"), role);
    }
  });
});

describe("page guards are never looser than the proxy", () => {
  // Each guarded page (and admin export route), with the guard it uses — for
  // the client page dens/new, the guard its Server Action relies on. This
  // checks the guard functions; tests/db/pageGuards.test.ts and
  // tests/unit/pageGuards.test.ts check that each page really calls its guard,
  // first.
  const PAGES: { path: string; guard: () => Promise<unknown> }[] = [
    { path: "/portal/roster", guard: () => authz.requireRosterSession() },
    { path: "/portal/roster/leaders", guard: () => authz.requireLeaderContactsSession() },
    { path: "/portal/roster/parents", guard: () => authz.requireParentContactsSession() },
    { path: "/portal/roster/family-view", guard: () => authz.requireParentContactsSession() },
    { path: "/portal/roster/photo-consent", guard: () => authz.requirePhotoConsentSession() },
    { path: "/portal/admin", guard: () => authz.requireAdvancementSession() },
    { path: "/portal/admin/dens/some-den", guard: () => authz.requireAdvancementSession() },
    { path: "/portal/admin/dens/some-den/promote", guard: () => authz.requireAdminSession() },
    { path: "/portal/admin/dens/new", guard: () => authz.requireAdminSession() },
    { path: "/portal/admin/attendance", guard: () => authz.requireAttendanceSession() },
    { path: "/portal/admin/attendance/some-date", guard: () => authz.requireAttendanceSession() },
    { path: "/portal/admin/attendance/leaders", guard: () => authz.requireLeaderAttendanceSession() },
    { path: "/portal/admin/attendance/leaders/some-date", guard: () => authz.requireLeaderAttendanceSession() },
    { path: "/portal/admin/attendance/leaders/manage", guard: () => authz.requireAdminSession() },
    { path: "/portal/admin/albums", guard: () => authz.requireAlbumSession() },
    { path: "/portal/admin/albums/some-album", guard: () => authz.requireAlbumSession() },
    { path: "/portal/admin/users", guard: () => authz.requireAdminSession() },
    { path: "/portal/admin/parent-portal", guard: () => authz.requireAdminSession() },
    { path: "/portal/admin/receipts", guard: () => authz.requireAdminSession() },
    { path: "/portal/admin/audit", guard: () => authz.requireMasterAdminSession() },
    { path: "/portal/admin/reset", guard: () => authz.requireMasterAdminSession() },
    { path: "/portal/admin/ledger", guard: () => authz.requireLedgerSession() },
    { path: "/portal/admin/ledger/categories", guard: () => authz.requireLedgerSession() },
    { path: "/portal/admin/ledger/import", guard: () => authz.requireLedgerSession() },
    { path: "/portal/admin/ledger/export", guard: () => authz.requireLedgerSession() },
    { path: "/portal/admin/dues", guard: () => authz.requireDuesViewSession() },
    { path: "/portal/admin/events", guard: () => authz.requireEventsViewSession() },
    { path: "/portal/admin/events/guests/export", guard: () => authz.requireAdminSession() },
    { path: "/portal/admin/events/some-event/guests/export", guard: () => authz.requireAdminSession() },
    { path: "/portal/admin/raffles", guard: () => authz.requireRaffleAccess() },
    { path: "/portal/admin/raffles/some-raffle/export", guard: () => authz.requireAdminSession() },
    { path: "/portal/admin/camp-conron", guard: () => authz.requireTripPageSession() },
    { path: "/portal/admin/cyclones", guard: () => authz.requireTripPageSession() },
    { path: "/portal/admin/camp-conron/export", guard: () => authz.requireAdminSession() },
    { path: "/portal/admin/cyclones/export/expenses/pdf", guard: () => authz.requireAdminSession() },
    { path: "/portal/admin/calendar", guard: () => authz.requireCalendarViewSession() },
    { path: "/portal/admin/calendar/new", guard: () => authz.requireAdminSession() },
    { path: "/portal/admin/homepage-events", guard: () => authz.requireHomepageContentSession() },
    { path: "/portal/parent", guard: () => authz.requireParentSession() },
  ];

  for (const page of PAGES) {
    it(page.path, async () => {
      for (const key of Object.keys(users)) {
        const user = users[key];
        if (await proxyAllows(user, page.path)) continue;
        const outcome = await guardOutcome(user, page.guard);
        assert.notEqual(outcome, null, `${key} is sent away by the proxy but let in by the page guard`);
      }
    });
  }

  it("still lets the intended roles reach their pages", async () => {
    assert.equal(await guardOutcome(users.TRIP_VIEWER, () => authz.requireTripPageSession()), null);
    assert.equal(await guardOutcome(users.PHOTOGRAPHER, () => authz.requireAlbumSession()), null);
    assert.equal(await guardOutcome(users.ATTENDANCE_ADMIN, () => authz.requireAttendanceSession()), null);
    assert.equal(await guardOutcome(users.ATTENDANCE_ADMIN, () => authz.requireLeaderAttendanceSession()), null);
    assert.equal(await guardOutcome(users.COMMITTEE_WITH_DEN, () => authz.requireParentContactsSession()), null);
    assert.notEqual(await guardOutcome(users.COMMITTEE, () => authz.requireParentContactsSession()), null);
    assert.equal(await guardOutcome(users.MASTER, () => authz.requireMasterAdminSession()), null);
    assert.equal(await guardOutcome(users.PARENT, () => authz.requireParentSession()), null);
  });
});

describe("the Ledger is for the two ledger accounts only", () => {
  /** The session payload getSession() would hand an action for this user. */
  const payload = (user: SessionUser) => ({
    userId: user.id,
    role: user.role,
    denIds: user.denIds ?? [],
    scoutIds: [],
    displayName: "Ledger test",
    sv: user.sessionVersion,
  });

  it("requireLedgerSession lets in mattrosen and dianaliz and sends everyone else away", async () => {
    assert.equal(await guardOutcome(users.MASTER, () => authz.requireLedgerSession()), null);
    assert.equal(await guardOutcome(users.LEDGER, () => authz.requireLedgerSession()), null);
    // Any other Admin goes back to the dashboard; every other level to its own home.
    assert.equal(await guardOutcome(users.ADMIN, () => authz.requireLedgerSession()), "/portal/admin");
    for (const role of ALL_ROLES.filter((r) => r !== "ADMIN")) {
      assert.equal(await guardOutcome(users[role], () => authz.requireLedgerSession()), session.homeForRole(role), role);
    }
  });

  it("assertLedgerAccess throws for everyone but the ledger accounts", async () => {
    for (const key of Object.keys(users)) {
      const outcome = await settle(runAs(users[key], () => authz.assertLedgerAccess(payload(users[key]))));
      if (key === "MASTER" || key === "LEDGER") assert.ok(outcome.ok, key);
      else assert.ok(!outcome.ok && /ledger access only/.test(outcome.error.message), key);
    }
  });

  it("isLedgerSession only answers true for an ADMIN with a ledger username", async () => {
    assert.equal(await authz.isLedgerSession(payload(users.LEDGER)), true);
    assert.equal(await authz.isLedgerSession(payload(users.ADMIN)), false);
    // A ledger username on a non-Admin session doesn't count.
    assert.equal(await authz.isLedgerSession({ ...payload(users.LEDGER), role: "JUNIOR_ADMIN" }), false);
  });

  it("only a master admin can change a ledger account", async () => {
    const target = { username: "dianaliz" };
    const plain = await settle(authz.assertCanMutateUser(payload(users.ADMIN), target));
    assert.ok(!plain.ok && plain.error.message === authz.MASTER_ONLY_ACCOUNT_MESSAGE);
    // Not even the other ledger account, which isn't a master admin.
    assert.ok(!(await settle(authz.assertCanMutateUser(payload(users.LEDGER), { username: "mattrosen" }))).ok);
    assert.ok((await settle(authz.assertCanMutateUser(payload(users.MASTER), target))).ok);
  });

  it("a plain Admin can't reset dianaliz's password; mattrosen can", async () => {
    const actions = await import("@/lib/actions/users");
    const before = await db.prisma.user.findUniqueOrThrow({ where: { id: users.LEDGER.id } });

    const refused = await runAs(users.ADMIN, () => actions.resetPasswordAction(users.LEDGER.id));
    assert.deepEqual(refused, { ok: false, error: authz.MASTER_ONLY_ACCOUNT_MESSAGE });
    const unchanged = await db.prisma.user.findUniqueOrThrow({ where: { id: users.LEDGER.id } });
    assert.equal(unchanged.passwordHash, before.passwordHash);
    assert.equal(unchanged.sessionVersion, before.sessionVersion);
    assert.equal(await db.prisma.passwordResetToken.count({ where: { userId: users.LEDGER.id } }), 0);

    // A plain Admin can't change her email either.
    const email = await settle(
      runAs(users.ADMIN, () => {
        const data = new FormData();
        data.set("userId", users.LEDGER.id);
        data.set("email", "taken-over@example.com");
        return actions.updateUserEmailAction(data);
      }),
    );
    assert.ok(!email.ok);
    assert.equal((await db.prisma.user.findUniqueOrThrow({ where: { id: users.LEDGER.id } })).email, before.email);

    const allowed = await runAs(users.MASTER, () => actions.resetPasswordAction(users.LEDGER.id));
    assert.equal(allowed.ok, true);
    // Her old sessions stop working; keep the fixture's session usable for later tests.
    const after = await db.prisma.user.findUniqueOrThrow({ where: { id: users.LEDGER.id } });
    users.LEDGER.sessionVersion = after.sessionVersion;
  });
});

describe("/api export routes", () => {
  type Handler = (request: never, context: never) => Promise<Response>;
  const request = (path: string) => new nextServer.NextRequest(`https://pack376nyc.org${path}?scoutingYear=2026-2027`);

  async function call(user: SessionUser, load: () => Promise<{ GET: Handler }>, path: string, params?: object) {
    const { GET } = await load();
    return runAs(user, () => GET(request(path) as never, { params: Promise.resolve(params ?? {}) } as never));
  }

  const ROUTES: { path: string; load: () => Promise<{ GET: Handler }>; params?: () => object; allowed: string[] }[] = [
    { path: "/api/parents/export", load: () => import("@/app/api/parents/export/route"), allowed: ["ADMIN", "JUNIOR_ADMIN", "MASTER"] },
    { path: "/api/parents/export/pdf", load: () => import("@/app/api/parents/export/pdf/route"), allowed: ["ADMIN", "JUNIOR_ADMIN", "MASTER"] },
    {
      path: "/api/parents/export/den/x",
      load: () => import("@/app/api/parents/export/den/[denId]/route"),
      params: () => ({ denId }),
      allowed: ["ADMIN", "JUNIOR_ADMIN", "MASTER", "DEN", "COMMITTEE_WITH_DEN"],
    },
    { path: "/api/leaders/export", load: () => import("@/app/api/leaders/export/route"), allowed: ["ADMIN", "JUNIOR_ADMIN", "MASTER"] },
    { path: "/api/leaders/export/pdf", load: () => import("@/app/api/leaders/export/pdf/route"), allowed: ["ADMIN", "JUNIOR_ADMIN", "MASTER"] },
    {
      path: "/api/attendance/export/pack",
      load: () => import("@/app/api/attendance/export/pack/route"),
      allowed: ["ADMIN", "JUNIOR_ADMIN", "MASTER", "COMMITTEE", "COMMITTEE_WITH_DEN", "ATTENDANCE_ADMIN"],
    },
    {
      path: "/api/attendance/export/leaders",
      load: () => import("@/app/api/attendance/export/leaders/route"),
      allowed: ["ADMIN", "JUNIOR_ADMIN", "MASTER", "ATTENDANCE_ADMIN"],
    },
    {
      path: "/api/photo-consent/export",
      load: () => import("@/app/api/photo-consent/export/route"),
      allowed: ["ADMIN", "JUNIOR_ADMIN", "MASTER", "COMMITTEE", "COMMITTEE_WITH_DEN", "DEN", "PHOTOGRAPHER"],
    },
  ];

  for (const route of ROUTES) {
    it(`${route.path}: refuses other roles; a private, no-store file for the rest`, async () => {
      for (const key of Object.keys(users)) {
        const response = await call(users[key], route.load, route.path, route.params?.());
        // The ledger account is an ordinary Admin everywhere else.
        if (route.allowed.includes(key === "LEDGER" ? "ADMIN" : key)) {
          assert.equal(response.status, 200, `${key} should get the file`);
          assert.equal(response.headers.get("Cache-Control"), "private, no-store", key);
          assert.match(response.headers.get("Content-Disposition") ?? "", /^attachment; filename="/, key);
        } else {
          assert.ok([401, 403].includes(response.status), `${key} got ${response.status}`);
        }
      }
    });
  }
});
