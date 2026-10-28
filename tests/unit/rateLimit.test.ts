/*
 * The three public forms share one Vercel Firewall rule (the Hobby plan
 * allows only one) but must each count separately per IP address.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { RATE_LIMIT_RULE_ID, isRateLimited } from "@/lib/rateLimit";
import { resetTestState, testState } from "../support/context";

const fromIp = (ip: string | null) => new Headers(ip ? { "x-real-ip": ip } : {});

describe("isRateLimited", () => {
  let errors: string[];
  beforeEach(() => {
    resetTestState();
    errors = [];
    mock.method(console, "error", (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
  });
  afterEach(() => mock.restoreAll());

  it("checks the one existing rule, portal-login", () => {
    assert.equal(RATE_LIMIT_RULE_ID, "portal-login");
  });

  it("keeps sign-in on the rule's default per-IP count", async () => {
    await isRateLimited("login", fromIp("203.0.113.9"));
    assert.deepEqual(testState.rateLimitCalls, [{ rateLimitId: "portal-login", rateLimitKey: undefined }]);
  });

  it("gives the reset form and trip registration their own per-IP counts", async () => {
    await isRateLimited("reset", fromIp("203.0.113.9"));
    await isRateLimited("trip-registration", fromIp("203.0.113.9"));
    await isRateLimited("reset", fromIp("198.51.100.4"));
    assert.deepEqual(testState.rateLimitCalls, [
      { rateLimitId: "portal-login", rateLimitKey: "reset:203.0.113.9" },
      { rateLimitId: "portal-login", rateLimitKey: "trip-registration:203.0.113.9" },
      { rateLimitId: "portal-login", rateLimitKey: "reset:198.51.100.4" },
    ]);
  });

  it("passes the firewall's answer through", async () => {
    testState.rateLimited = true;
    assert.equal(await isRateLimited("login", fromIp("203.0.113.9")), true);
    assert.equal(await isRateLimited("reset", fromIp("203.0.113.9")), true);
    testState.rateLimited = false;
    assert.equal(await isRateLimited("trip-registration", fromIp("203.0.113.9")), false);
  });

  it("fails open, with a log line naming the rule, when the rule is missing", async () => {
    testState.rateLimitError = "not-found";
    assert.equal(await isRateLimited("reset", fromIp("203.0.113.9")), false);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /\[rate limit\] no "portal-login" rule in the Vercel Firewall \(checked by reset\)/);
  });

  it("fails open, with a log line, when a keyed form has no client address", async () => {
    testState.rateLimited = true;
    assert.equal(await isRateLimited("trip-registration", fromIp(null)), false);
    assert.equal(testState.rateLimitCalls.length, 0);
    assert.match(errors[0], /no client address on a trip-registration request/);
  });
});
