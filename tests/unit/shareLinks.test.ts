import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shareHrefs } from "@/lib/shareLinks";

describe("shareHrefs", () => {
  const h = shareHrefs("Pack 376's Calendar & Events:", "https://pack376nyc.org/calendar", "Pack 376 Calendar");

  it("puts the message and address in a text message both phones read", () => {
    assert.ok(h.sms.startsWith("sms:?&body="));
    assert.equal(decodeURIComponent(h.sms.slice("sms:?&body=".length)), "Pack 376's Calendar & Events: https://pack376nyc.org/calendar");
  });

  it("opens WhatsApp with the same message", () => {
    const u = new URL(h.whatsapp);
    assert.equal(u.origin, "https://wa.me");
    assert.equal(u.searchParams.get("text"), "Pack 376's Calendar & Events: https://pack376nyc.org/calendar");
  });

  it("fills an email's subject and body, with an & kept inside its field", () => {
    assert.ok(h.email.startsWith("mailto:?subject="));
    const params = new URLSearchParams(h.email.slice("mailto:?".length));
    assert.equal(params.get("subject"), "Pack 376 Calendar");
    assert.equal(params.get("body"), "Pack 376's Calendar & Events:\n\nhttps://pack376nyc.org/calendar");
  });
});
