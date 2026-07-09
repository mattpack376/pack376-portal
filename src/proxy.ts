import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const SESSION_COOKIE = "pack376_session";

function secretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return new TextEncoder().encode(secret);
}

async function readSession(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    return payload as { userId: string; role: "ADMIN" | "DEN"; denId: string | null };
  } catch {
    return null;
  }
}

/**
 * Optimistic route gating only — reads the session cookie, no DB access.
 * Every Server Action independently re-verifies via requireSession()/assertAdmin()/
 * assertDenAccess() in src/lib/authorize.ts; this is just a fast redirect layer
 * so unauthenticated users never see portal HTML at all.
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

  if (pathname.startsWith("/portal/admin") && session.role !== "ADMIN") {
    return NextResponse.redirect(new URL("/portal/den", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/portal/:path*"],
};
