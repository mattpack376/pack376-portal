import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import type { Role } from "@/generated/prisma/enums";

const SESSION_COOKIE = "pack376_session";

const PORTAL_HOSTS = ["portal.pack376nyc.org", "portal.localhost:3000"];
// Standalone public micro-site for the Camp Conron trip — no login involved,
// masked onto /camp-conron the same way PORTAL_HOSTS masks /portal below.
const CONRON_HOSTS = ["conron.pack376nyc.org", "conron.localhost:3000"];

function secretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return new TextEncoder().encode(secret);
}

type ProxyRole = Role;

async function readSession(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    return payload as { userId: string; role: ProxyRole; denId: string | null };
  } catch {
    return null;
  }
}

/** Mirrors src/lib/authorize.ts homeForRole — kept in sync manually since
 * proxy runs in a separate bundle from the rest of the app. */
function homeForRole(role: ProxyRole) {
  if (role === "ADMIN") return "/portal/admin";
  if (role === "JUNIOR_ADMIN") return "/portal/admin";
  if (role === "COMMITTEE") return "/portal/admin";
  if (role === "ATTENDANCE_ADMIN") return "/portal/admin/attendance";
  if (role === "PHOTOGRAPHER") return "/portal/admin/albums";
  if (role === "PARENT") return "/portal/parent";
  if (role === "TRIP_VIEWER") return "/portal/admin/camp-conron";
  return "/portal/den";
}

/**
 * Coarse route -> allowed-roles rules, checked in order (most specific
 * first). Mirrors the requireXSession() guards in src/lib/authorize.ts —
 * kept in sync manually since proxy runs in a separate bundle.
 */
const ROUTE_RULES: { test: (pathname: string) => boolean; roles: ProxyRole[] }[] = [
  // Pack-wide roster (every den, leader, and scout name) — every staff role
  // but never a PARENT account. Mirrors requireRosterSession() in authorize.ts.
  // Parent contacts and Family View under it are narrowed further by
  // requireParentContactsSession() on the page (a Committee Member only with
  // a den assigned), which this cookie-only layer can't see.
  {
    test: (p) => p.startsWith("/portal/roster"),
    roles: ["ADMIN", "JUNIOR_ADMIN", "COMMITTEE", "DEN", "ATTENDANCE_ADMIN", "PHOTOGRAPHER"],
  },
  // Editing who's on the leader & committee attendance list — checked before
  // the attendance rule below, which would otherwise let every attendance
  // role in. Mirrors requireAdminSession() on the Manage List page.
  { test: (p) => p.startsWith("/portal/admin/attendance/leaders/manage"), roles: ["ADMIN"] },
  { test: (p) => p.startsWith("/portal/admin/attendance"), roles: ["ADMIN", "JUNIOR_ADMIN", "COMMITTEE", "ATTENDANCE_ADMIN"] },
  { test: (p) => p.startsWith("/portal/admin/albums"), roles: ["ADMIN", "PHOTOGRAPHER"] },
  { test: (p) => p.startsWith("/portal/admin/users"), roles: ["ADMIN"] },
  { test: (p) => p.startsWith("/portal/admin/parent-portal"), roles: ["ADMIN"] },
  // The audit log is master-admin-only, which this layer can't check — master
  // admin is a username list (src/lib/masterAdmins.ts) and proxy has no DB
  // access. ADMIN is the tightest coarse rule available; the real gate is
  // requireMasterAdminSession() on the page, which bounces everyone else.
  { test: (p) => p.startsWith("/portal/admin/audit"), roles: ["ADMIN"] },
  { test: (p) => p.startsWith("/portal/admin/reset"), roles: ["ADMIN"] },
  // Dues: Admin edits, Junior Admin and Committee Member read. Mirrors
  // requireDuesViewSession().
  { test: (p) => p.startsWith("/portal/admin/dues"), roles: ["ADMIN", "JUNIOR_ADMIN", "COMMITTEE"] },
  // CSV exports (per-event and pack-wide) are an admin-only bookkeeping
  // tool — checked before the events rule below, which would otherwise
  // let Junior Admin through.
  { test: (p) => /^\/portal\/admin\/events(\/[^/]+)?\/guests\/export$/.test(p), roles: ["ADMIN"] },
  // Events, registrations and guest groups: Admin edits, Junior Admin reads.
  // Den leaders see no money. Mirrors requireEventsViewSession().
  { test: (p) => p.startsWith("/portal/admin/events"), roles: ["ADMIN", "JUNIOR_ADMIN"] },
  { test: (p) => p.endsWith("/promote"), roles: ["ADMIN"] },
  { test: (p) => p.startsWith("/portal/admin/dens/new"), roles: ["ADMIN"] },
  { test: (p) => p.startsWith("/portal/admin/dens"), roles: ["ADMIN", "JUNIOR_ADMIN", "COMMITTEE"] },
  // TRIP_VIEWER (e.g. a shared Troop376 login) only reaches this exact page,
  // read-only — checked before the generic "/portal/admin" rule below, which
  // would otherwise also match this path but for ADMIN/JUNIOR_ADMIN only.
  // Deliberately an exact match, not a prefix: the CSV export route
  // (/portal/admin/camp-conron/export) stays admin-only via the rule below.
  { test: (p) => p === "/portal/admin/camp-conron", roles: ["ADMIN", "JUNIOR_ADMIN", "TRIP_VIEWER"] },
  { test: (p) => p.startsWith("/portal/admin/camp-conron"), roles: ["ADMIN"] },
  // The dashboard (den tiles, which lead to advancement) — every role that
  // edits advancement pack-wide. Exact match: everything else under
  // /portal/admin falls to the rule after it.
  { test: (p) => p === "/portal/admin", roles: ["ADMIN", "JUNIOR_ADMIN", "COMMITTEE"] },
  { test: (p) => p.startsWith("/portal/admin"), roles: ["ADMIN", "JUNIOR_ADMIN"] },
];

/**
 * portal.pack376nyc.org and conron.pack376nyc.org are both served by this
 * same deployment, each masked onto an internal prefix (/portal, /camp-conron)
 * via rewrite so visitors never see that prefix in the URL bar. `internalPath`
 * is what the rest of this function (and the app's router) sees; `toPublic`
 * translates an internal path back to what the visitor should see in a
 * redirect — prefix-free on that subdomain.
 */
function resolvePaths(request: NextRequest) {
  const host = request.headers.get("host") || "";
  const isPortalSubdomain = PORTAL_HOSTS.includes(host);
  const isConronSubdomain = CONRON_HOSTS.includes(host);
  const publicPath = request.nextUrl.pathname;
  const isAsset = publicPath.startsWith("/api") || publicPath.startsWith("/_next") || publicPath.includes(".");

  if (isPortalSubdomain && !isAsset && !publicPath.startsWith("/portal")) {
    const internalPath = publicPath === "/" ? "/portal" : `/portal${publicPath}`;
    return { publicPath, internalPath, toPublic: (path: string) => path.replace(/^\/portal/, "") || "/" };
  }

  // conron.pack376nyc.org serves exactly one page (the Camp Conron trip
  // micro-site) at its root — unlike the portal subdomain above, which hosts
  // many nested routes, this only rewrites "/" itself. Every other path here
  // (nav links like /activities, /contact, /gallery, etc., all of which the
  // shared site Header renders as root-relative links) falls through to the
  // final return below and resolves normally against the same route tree
  // every other host uses — rewriting them under /camp-conron would 404
  // since no such nested routes exist.
  if (isConronSubdomain && !isAsset && publicPath === "/") {
    return { publicPath, internalPath: "/camp-conron", toPublic: (path: string) => (path === "/camp-conron" ? "/" : path) };
  }

  return { publicPath, internalPath: publicPath, toPublic: (path: string) => path };
}

function rewriteTo(request: NextRequest, pathname: string) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  return NextResponse.rewrite(url);
}

/**
 * Optimistic route gating only — reads the session cookie, no DB access.
 * Every Server Action independently re-verifies via requireSession()/assertAdmin()/
 * assertAttendanceDenAccess() in src/lib/authorize.ts; this is just a fast redirect
 * layer so unauthenticated users never see portal HTML at all.
 */
export async function proxy(request: NextRequest) {
  const { publicPath, internalPath, toPublic } = resolvePaths(request);

  if (internalPath === "/portal/login") {
    const session = await readSession(request);
    if (session) {
      return NextResponse.redirect(new URL(toPublic("/portal"), request.url));
    }
    return internalPath === publicPath ? NextResponse.next() : rewriteTo(request, internalPath);
  }

  // Password-reset/invite links must work for a visitor with no session at
  // all (a brand-new account, or someone whose old session was just
  // revoked) — the token itself is what authorizes the request, not a
  // cookie. Skip the generic "/portal requires a session" gate below.
  if (internalPath.startsWith("/portal/reset/")) {
    return internalPath === publicPath ? NextResponse.next() : rewriteTo(request, internalPath);
  }

  if (internalPath.startsWith("/portal")) {
    const session = await readSession(request);
    if (!session) {
      return NextResponse.redirect(new URL(toPublic("/portal/login"), request.url));
    }

    const rule = ROUTE_RULES.find((r) => r.test(internalPath));
    if (rule && !rule.roles.includes(session.role)) {
      return NextResponse.redirect(new URL(toPublic(homeForRole(session.role)), request.url));
    }
  }

  return internalPath === publicPath ? NextResponse.next() : rewriteTo(request, internalPath);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
