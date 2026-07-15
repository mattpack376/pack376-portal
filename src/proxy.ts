import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const SESSION_COOKIE = "pack376_session";

const PORTAL_HOSTS = ["portal.pack376nyc.org", "portal.localhost:3000"];

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
const ADMIN_ROUTE_RULES: { test: (pathname: string) => boolean; roles: ProxyRole[] }[] = [
  { test: (p) => p.startsWith("/portal/admin/attendance"), roles: ["ADMIN", "JUNIOR_ADMIN", "ATTENDANCE_ADMIN"] },
  { test: (p) => p.startsWith("/portal/admin/albums"), roles: ["ADMIN", "JUNIOR_ADMIN", "PHOTOGRAPHER"] },
  { test: (p) => p.startsWith("/portal/admin/users"), roles: ["ADMIN"] },
  { test: (p) => p.startsWith("/portal/admin/parent-portal"), roles: ["ADMIN"] },
  { test: (p) => p.endsWith("/promote"), roles: ["ADMIN"] },
  { test: (p) => p.startsWith("/portal/admin/dens/new"), roles: ["ADMIN"] },
  { test: (p) => p.startsWith("/portal/admin/dens"), roles: ["ADMIN", "JUNIOR_ADMIN"] },
  { test: (p) => p.startsWith("/portal/admin"), roles: ["ADMIN", "JUNIOR_ADMIN"] },
];

/**
 * portal.pack376nyc.org is served by this same deployment, masked onto
 * /portal via rewrite so visitors never see the /portal prefix in the URL
 * bar. `internalPath` is what the rest of this function (and the app's
 * router) sees; `toPublic` translates a /portal/* path back to what the
 * visitor should see in a redirect — prefix-free on that subdomain.
 */
function resolvePaths(request: NextRequest) {
  const host = request.headers.get("host") || "";
  const isPortalSubdomain = PORTAL_HOSTS.includes(host);
  const publicPath = request.nextUrl.pathname;
  const isAsset = publicPath.startsWith("/api") || publicPath.startsWith("/_next") || publicPath.includes(".");

  const internalPath =
    isPortalSubdomain && !isAsset && !publicPath.startsWith("/portal")
      ? publicPath === "/"
        ? "/portal"
        : `/portal${publicPath}`
      : publicPath;

  const toPublic = (path: string) => (isPortalSubdomain ? path.replace(/^\/portal/, "") || "/" : path);

  return { publicPath, internalPath, toPublic };
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

    const rule = ADMIN_ROUTE_RULES.find((r) => r.test(internalPath));
    if (rule && !rule.roles.includes(session.role)) {
      return NextResponse.redirect(new URL(toPublic(homeForRole(session.role)), request.url));
    }
  }

  return internalPath === publicPath ? NextResponse.next() : rewriteTo(request, internalPath);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
