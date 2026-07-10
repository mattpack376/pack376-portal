import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const SESSION_COOKIE = "pack376_session";

function secretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return new TextEncoder().encode(secret);
}

type ProxyRole = "ADMIN" | "DEN" | "ATTENDANCE_ADMIN" | "JUNIOR_ADMIN" | "PHOTOGRAPHER";

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
 * middleware runs in a separate bundle from the rest of the app. */
function homeForRole(role: ProxyRole) {
  if (role === "ADMIN") return "/portal/admin";
  if (role === "JUNIOR_ADMIN") return "/portal/admin";
  if (role === "ATTENDANCE_ADMIN") return "/portal/admin/attendance";
  if (role === "PHOTOGRAPHER") return "/portal/admin/albums";
  return "/portal/den";
}

/**
 * Coarse route -> allowed-roles rules, checked in order (most specific
 * first). Mirrors the requireXSession() guards in src/lib/authorize.ts —
 * kept in sync manually since middleware runs in a separate bundle.
 */
const ADMIN_ROUTE_RULES: { test: (pathname: string) => boolean; roles: ProxyRole[] }[] = [
  { test: (p) => p.startsWith("/portal/admin/attendance"), roles: ["ADMIN", "JUNIOR_ADMIN", "ATTENDANCE_ADMIN"] },
  { test: (p) => p.startsWith("/portal/admin/albums"), roles: ["ADMIN", "JUNIOR_ADMIN", "PHOTOGRAPHER"] },
  { test: (p) => p.startsWith("/portal/admin/users"), roles: ["ADMIN"] },
  { test: (p) => p.endsWith("/promote"), roles: ["ADMIN"] },
  { test: (p) => p.startsWith("/portal/admin/dens/new"), roles: ["ADMIN"] },
  { test: (p) => p.startsWith("/portal/admin/dens"), roles: ["ADMIN", "JUNIOR_ADMIN"] },
  { test: (p) => p.startsWith("/portal/admin"), roles: ["ADMIN", "JUNIOR_ADMIN"] },
];

/**
 * Optimistic route gating only — reads the session cookie, no DB access.
 * Every Server Action independently re-verifies via requireSession()/assertAdmin()/
 * assertAttendanceDenAccess() in src/lib/authorize.ts; this is just a fast redirect
 * layer so unauthenticated users never see portal HTML at all.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/portal/login") {
    const session = await readSession(request);
    if (session) {
      return NextResponse.redirect(new URL("/portal", request.url));
    }
    return NextResponse.next();
  }

  const session = await readSession(request);
  if (!session) {
    return NextResponse.redirect(new URL("/portal/login", request.url));
  }

  const rule = ADMIN_ROUTE_RULES.find((r) => r.test(pathname));
  if (rule && !rule.roles.includes(session.role)) {
    return NextResponse.redirect(new URL(homeForRole(session.role), request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/portal/:path*"],
};
