/*
 * GET /portal/logout clears the session cookie and redirects to sign-in. A
 * response that clears a session is never one to keep: no-store, so no cache
 * between here and the browser can replay it.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NextRequest } from "next/server";
import { GET } from "@/app/portal/logout/route";
import { SESSION_COOKIE } from "@/lib/session";

describe("GET /portal/logout", () => {
  it("clears the cookie, redirects to sign-in, and is private, no-store", async () => {
    const response = await GET(
      new NextRequest("https://portal.example.test/portal/logout", { headers: { cookie: `${SESSION_COOKIE}=abc` } }),
    );
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), "https://portal.example.test/portal/login");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.match(response.headers.get("set-cookie") ?? "", new RegExp(`^${SESSION_COOKIE}=;.*Expires=Thu, 01 Jan 1970`));
  });
});
