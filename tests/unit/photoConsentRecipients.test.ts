/*
 * Who a scout's photo-consent link is emailed to, and what the Photo Consent
 * page says when nobody can be: "no email on file" and "an email on file that
 * can't be used" need different fixes, so they read differently.
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

let recipients: typeof import("@/lib/photoConsentRecipients");

before(async () => {
  recipients = await import("@/lib/photoConsentRecipients");
});

const NONE = "No parent email on file — copy the link above instead.";

describe("consentLinkRecipient", () => {
  it("takes the first parent whose stored email is one plain address", () => {
    assert.equal(
      recipients.consentLinkRecipient([
        { email: null },
        { email: "a@example.com, b@example.com" },
        { email: "  Pat@Example.com " },
        { email: "second@example.com" },
      ]),
      "Pat@Example.com"
    );
  });

  it("finds nobody when no stored email is usable", () => {
    assert.equal(recipients.consentLinkRecipient([]), null);
    assert.equal(recipients.consentLinkRecipient([{ email: "Pat <pat@example.com>" }, { email: "pat\u0000@example.com" }]), null);
  });
});

describe("noConsentRecipientNote", () => {
  it("says there's no email on file only when there isn't one", () => {
    assert.equal(recipients.noConsentRecipientNote([]), NONE);
    assert.equal(recipients.noConsentRecipientNote([{ email: null }, { email: "   " }]), NONE);
  });

  it("says an email on file can't be used, and where to fix it", () => {
    for (const email of ["a@example.com, b@example.com", "Pat <pat@example.com>", "not-an-address"]) {
      const note = recipients.noConsentRecipientNote([{ email: null }, { email }]);
      assert.notEqual(note, NONE, email);
      assert.match(note, /^The parent email on file isn't a single valid address, so the link can't be emailed\./);
      assert.match(note, /Parent Contacts/);
    }
  });
});
