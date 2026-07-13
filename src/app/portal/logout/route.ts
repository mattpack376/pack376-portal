import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";

/**
 * Clears the session cookie and sends the user to the login page. This exists
 * as a GET route (not just the logout Server Action) so that requireSession()
 * can redirect a *revoked* session here: the token's signature is still valid,
 * so it must be physically cleared before landing on /portal/login, otherwise
 * the edge proxy would treat the user as logged in and bounce them back.
 */
export async function GET(request: NextRequest) {
  const res = NextResponse.redirect(new URL("/portal/login", request.url));
  // Host-only delete, matching how createSessionCookie now sets it (no domain).
  res.cookies.delete({ name: SESSION_COOKIE, path: "/" });
  return res;
}
