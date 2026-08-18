import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

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

type ProxyRole = "ADMIN" | "DEN" | "ATTENDANCE_ADMIN" | "JUNIOR_ADMIN" | "PHOTOGRAPHER" | "PARENT";

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
  if (role === "ATTENDANCE_ADMIN") return "/portal/admin/attendance";
  if (role === "PHOTOGRAPHER") return "/portal/admin/albums";
  if (role === "PARENT") return "/portal/parent";
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
  { test: (p) => p.startsWith("/portal/roster"), roles: ["ADMIN", "JUNIOR_ADMIN", "DEN", "ATTENDANCE_ADMIN", "PHOTOGRAPHER"] },
  { test: (p) => p.startsWith("/portal/admin/attendance"), roles: ["ADMIN", "JUNIOR_ADMIN", "ATTENDANCE_ADMIN"] },
  { test: (p) => p.startsWith("/portal/admin/albums"), roles: ["ADMIN", "JUNIOR_ADMIN", "PHOTOGRAPHER"] },
  { test: (p) => p.startsWith("/portal/admin/users"), roles: ["ADMIN"] },
  { test: (p) => p.startsWith("/portal/admin/parent-portal"), roles: ["ADMIN"] },
  // CSV exports (per-event and pack-wide) are an admin-only bookkeeping
  // tool — checked before the DEN-inclusive rules below since "export" would
  // otherwise satisfy their generic segment-count patterns.
  { test: (p) => /^\/portal\/admin\/events(\/[^/]+)?\/guests\/export$/.test(p), roles: ["ADMIN"] },
  // The pack-wide "All Guests" view (grouped across every event) is
  // admin-only, same as the events list/detail pages below.
  { test: (p) => p === "/portal/admin/events/guests", roles: ["ADMIN"] },
  // A den leader records payments on a single guest group's page, same as
  // on a single scout registration's page below.
  { test: (p) => /^\/portal\/admin\/events\/[^/]+\/guests\/[^/]+$/.test(p), roles: ["ADMIN", "DEN"] },
  // A den leader records payments on a single registration's page (checked
  // den-by-den in the page/action itself); the event list and event detail
  // pages stay admin-only.
  { test: (p) => /^\/portal\/admin\/events\/[^/]+\/[^/]+$/.test(p), roles: ["ADMIN", "DEN"] },
  { test: (p) => p.startsWith("/portal/admin/events"), roles: ["ADMIN"] },
  { test: (p) => p.endsWith("/promote"), roles: ["ADMIN"] },
  { test: (p) => p.startsWith("/portal/admin/dens/new"), roles: ["ADMIN"] },
  { test: (p) => p.startsWith("/portal/admin/dens"), roles: ["ADMIN", "JUNIOR_ADMIN"] },
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
