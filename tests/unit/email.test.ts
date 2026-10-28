/*
 * The email builders and senders in src/lib/email.ts, through a fake Resend
 * client (nothing is sent). Names typed by staff — a username, a scout's first
 * name, a donor — must come out as text in the HTML, never as markup; links
 * must be this site's own; recipients must be one plain mailbox.
 */
import assert from "node:assert/strict";
import { afterEach, before, describe, it, mock } from "node:test";
import { resetTestState, testState } from "../support/context";
import { resetResendControl, installControllableResend } from "../doubles/resend";

const resend = installControllableResend();
let email: typeof import("@/lib/email");

before(async () => {
  // The senders log every refusal and failure; that's expected here.
  mock.method(console, "error", () => {});
  email = await import("@/lib/email");
});

afterEach(() => {
  resetTestState();
  resetResendControl(resend);
});

// A name built to break out of the template every way it could: a live link,
// an image with a handler, both quote kinds and an ampersand.
const HOSTILE = `<a href="https://example.invalid/phish">Click here</a> & "Tom" O'Neil <img src=x onerror=alert(1)>`;
const RESET_URL = "http://portal.localhost:3000/portal/reset/abc123";
const CONSENT_URL = "http://localhost:3000/consent/tok_abcdefghijklmnopqrstuvwxyz0123456789-_AB";

/** Every tag name in the markup, opening or closing. */
function tagNames(html: string) {
  return [...html.matchAll(/<\s*\/?\s*([a-zA-Z][\w-]*)/g)].map((m) => m[1].toLowerCase());
}

/** The attributes of each <a> tag, as [name, value] pairs. */
function anchorAttributes(html: string) {
  return [...html.matchAll(/<a\b([^>]*)>/gi)].map((m) =>
    [...m[1].matchAll(/([^\s=]+)\s*=\s*"([^"]*)"/g)].map((a) => [a[1], a[2]] as const)
  );
}

/** The visible text: tags removed, then entities decoded (&amp; last). */
function visibleText(html: string) {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function assertNoEntities(text: string) {
  assert.doesNotMatch(text, /&(lt|gt|quot|amp|#39);/, "the plain-text part is not HTML-encoded");
}

describe("escapeHtml", () => {
  it("encodes every character that could start markup or end an attribute", () => {
    assert.equal(email.escapeHtml(`<a href="x" title='y'>&</a>`), "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
  });
});

describe("account set-up / reset email", () => {
  for (const isNewAccount of [true, false]) {
    it(`shows a hostile username as text (${isNewAccount ? "new account" : "reset"})`, () => {
      const content = email.accountLinkEmail({ username: HOSTILE, url: RESET_URL, isNewAccount });

      assert.deepEqual(new Set(tagNames(content.html)), new Set(["p", "br", "strong", "a"]));
      const anchors = anchorAttributes(content.html);
      assert.equal(anchors.length, 1, "only the template's own link");
      assert.deepEqual(anchors[0], [["href", RESET_URL]]);
      assert.ok(visibleText(content.html).includes(`Username: ${HOSTILE}`));
      assert.ok(!content.html.includes(HOSTILE), "the raw markup never appears in the HTML");

      assert.ok(content.text.includes(`Username: ${HOSTILE}`), "the text part shows the name exactly as typed");
      assert.ok(content.text.includes(RESET_URL));
      assertNoEntities(content.text);
    });
  }

  it("renders an ordinary name with punctuation correctly", () => {
    const name = "Zoë-Marie O'Brien & Sam";
    const content = email.accountLinkEmail({ username: name, url: RESET_URL, isNewAccount: true });
    assert.ok(visibleText(content.html).includes(name));
    assert.ok(content.text.includes(`Username: ${name}`));
  });

  it("keeps a name with line breaks on one line", () => {
    const content = email.accountLinkEmail({ username: "sam\r\n\r\nClick: https://example.invalid", url: RESET_URL, isNewAccount: true });
    assert.ok(content.text.includes("Username: sam Click: https://example.invalid\n"));
  });
});

describe("photo consent email", () => {
  it("shows a hostile first name as text in the HTML, subject and text part", () => {
    const content = email.photoConsentEmail(HOSTILE, CONSENT_URL);

    assert.deepEqual(new Set(tagNames(content.html)), new Set(["p", "strong", "a"]));
    const anchors = anchorAttributes(content.html);
    assert.equal(anchors.length, 1);
    assert.deepEqual(anchors[0], [["href", CONSENT_URL]]);
    assert.ok(visibleText(content.html).includes(`photos of ${HOSTILE} on`));
    assert.ok(!content.html.includes(HOSTILE));

    assert.equal(content.subject, `Photo consent form for ${HOSTILE} — Pack 376`);
    assert.ok(content.text.includes(`photos of ${HOSTILE} on`));
    assertNoEntities(content.text);
  });

  it("can't gain a header or extra lines from a name", () => {
    const content = email.photoConsentEmail("Sam\r\nBcc: someone@example.invalid", CONSENT_URL);
    assert.doesNotMatch(content.subject, /[\r\n]/);
    assert.equal(content.subject, "Photo consent form for Sam Bcc: someone@example.invalid — Pack 376");
  });
});

describe("receipt email", () => {
  it("shows a hostile donor name as text (unchanged escaping, now tested)", () => {
    const content = email.receiptEmail({ isDonation: true, receivedFrom: HOSTILE, amountLabel: "$90.00" });
    assert.deepEqual(new Set(tagNames(content.html)), new Set(["p"]));
    assert.equal(anchorAttributes(content.html).length, 0);
    assert.ok(visibleText(content.html).startsWith(`Hello ${HOSTILE},`));
    assert.ok(content.text.startsWith(`Hello ${HOSTILE},\n\nThank you for your $90.00 donation`));
    assertNoEntities(content.text);
    assert.equal(content.subject, "Your Pack 376 donation receipt");
    assert.equal(email.receiptEmail({ isDonation: false, receivedFrom: "Pat", amountLabel: "$5.00" }).subject, "Your Pack 376 payment receipt");
  });
});

describe("links", () => {
  it("accepts only this site's own addresses", () => {
    for (const url of [
      "https://example.invalid/portal/reset/abc",
      "javascript:alert(1)",
      "http://portal.localhost:3000@example.invalid/portal/reset/abc",
      "http://user:pw@portal.localhost:3000/portal/reset/abc",
      "//example.invalid/x",
      "not a url",
      "",
    ]) {
      assert.throws(() => email.accountLinkEmail({ username: "sam", url, isNewAccount: true }), email.UntrustedLinkError, url);
      assert.throws(() => email.photoConsentEmail("Sam", url), email.UntrustedLinkError, url);
    }
  });

  it("can't break out of the href attribute", () => {
    const content = email.accountLinkEmail({
      username: "sam",
      url: `${RESET_URL}"onmouseover="alert(1)'x`,
      isNewAccount: true,
    });
    const anchors = anchorAttributes(content.html);
    assert.equal(anchors.length, 1);
    assert.equal(anchors[0].length, 1, "a single href attribute");
    assert.equal(anchors[0][0][0], "href");
    assert.doesNotMatch(content.html, /onmouseover="/);
  });

  it("requires https on the real hosts in production", () => {
    const env = process.env as Record<string, string | undefined>;
    const previous = env.NODE_ENV;
    env.NODE_ENV = "production";
    try {
      assert.throws(() => email.accountLinkEmail({ username: "sam", url: RESET_URL, isNewAccount: true }), email.UntrustedLinkError);
      assert.throws(
        () => email.accountLinkEmail({ username: "sam", url: "http://portal.pack376nyc.org/portal/reset/abc", isNewAccount: true }),
        email.UntrustedLinkError
      );
      const portal = email.accountLinkEmail({ username: "sam", url: "https://portal.pack376nyc.org/portal/reset/abc", isNewAccount: true });
      assert.deepEqual(anchorAttributes(portal.html)[0], [["href", "https://portal.pack376nyc.org/portal/reset/abc"]]);
      const consent = email.photoConsentEmail("Sam", "https://pack376nyc.org/consent/abc");
      assert.deepEqual(anchorAttributes(consent.html)[0], [["href", "https://pack376nyc.org/consent/abc"]]);
    } finally {
      env.NODE_ENV = previous;
    }
  });
});

const BAD_RECIPIENTS = [
  "",
  "not-an-email",
  "a@example.com,b@example.com",
  "a@example.com; b@example.com",
  "Pat Parent <pat@example.com>",
  '"Pat" pat@example.com',
  "pat@example.com\r\nBcc: someone@example.invalid",
  "pat@example.com\n",
  " pat@example.com",
  "pat\u0000@example.com",
  "pat\u0007@example.com",
  `${"a".repeat(250)}@example.com`,
];

describe("isDeliverableAddress", () => {
  it("accepts one plain mailbox and nothing else", () => {
    assert.equal(email.isDeliverableAddress("pat.parent+pack@example.com"), true);
    for (const value of BAD_RECIPIENTS) assert.equal(email.isDeliverableAddress(value), false, JSON.stringify(value));
  });
});

describe("senders", () => {
  it("send the escaped HTML through the client", async () => {
    assert.deepEqual(await email.sendAccountLinkEmail("pat@example.com", { username: HOSTILE, url: RESET_URL, isNewAccount: false }), { sent: true });
    assert.deepEqual(await email.sendPhotoConsentLinkEmail("pat@example.com", { scoutFirstName: HOSTILE, url: CONSENT_URL }), {
      sent: true,
      configured: true,
    });
    assert.equal(testState.emails.length, 2);
    for (const message of testState.emails) {
      assert.equal(message.to, "pat@example.com");
      assert.equal(anchorAttributes(message.html ?? "").length, 1);
      assert.ok(!(message.html ?? "").includes(HOSTILE));
      assert.ok((message.text ?? "").includes(HOSTILE));
    }
  });

  it("refuse a recipient that isn't one plain mailbox, without calling Resend", async () => {
    for (const to of BAD_RECIPIENTS) {
      assert.deepEqual(await email.sendAccountLinkEmail(to, { username: "sam", url: RESET_URL, isNewAccount: true }), { sent: false }, to);
      const consent = await email.sendPhotoConsentLinkEmail(to, { scoutFirstName: "Sam", url: CONSENT_URL });
      assert.equal(consent.sent, false, to);
      assert.equal(consent.configured, true);
      assert.ok(consent.error);
      const receipt = await email.sendReceiptEmail(to, { isDonation: true, receivedFrom: "Pat", amountLabel: "$1.00", filename: "r.pdf", pdf: new Uint8Array([1]) });
      assert.equal(receipt.sent, false, to);
    }
    assert.equal(resend.calls.length, 0);
    assert.equal(testState.emails.length, 0);
  });

  it("refuse a link that isn't this site's, without calling Resend", async () => {
    assert.deepEqual(
      await email.sendAccountLinkEmail("pat@example.com", { username: "sam", url: "https://example.invalid/reset", isNewAccount: true }),
      { sent: false }
    );
    const consent = await email.sendPhotoConsentLinkEmail("pat@example.com", { scoutFirstName: "Sam", url: "https://example.invalid/consent/x" });
    assert.equal(consent.sent, false);
    assert.equal(resend.calls.length, 0);
  });

  it("report Resend's error, shortened, and never throw", async () => {
    resend.queue.push({ error: { name: "validation_error", message: `Invalid \`to\` field. ${"x".repeat(5000)}` } });
    const failed = await email.sendPhotoConsentLinkEmail("pat@example.com", { scoutFirstName: "Sam", url: CONSENT_URL });
    assert.equal(failed.sent, false);
    assert.equal(failed.configured, true);
    assert.ok(failed.error?.startsWith("Invalid `to` field."));
    assert.ok((failed.error?.length ?? 0) <= email.MAX_EMAIL_ERROR_LENGTH);

    resend.queue.push({ throws: new Error("socket hang up") });
    assert.deepEqual(await email.sendAccountLinkEmail("pat@example.com", { username: "sam", url: RESET_URL, isNewAccount: true }), { sent: false });
    assert.equal(testState.emails.length, 0);
  });

  it("say when email isn't configured", async () => {
    const key = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    try {
      assert.equal(email.isEmailConfigured(), false);
      assert.deepEqual(await email.sendPhotoConsentLinkEmail("pat@example.com", { scoutFirstName: "Sam", url: CONSENT_URL }), {
        sent: false,
        configured: false,
      });
      assert.deepEqual(await email.sendPhotoConsentLinkEmails([{ to: "pat@example.com", scoutFirstName: "Sam", url: CONSENT_URL }]), {
        sent: [false],
        unconfirmed: [false],
        listChanged: [false],
        configured: false,
      });
    } finally {
      process.env.RESEND_API_KEY = key;
    }
    assert.equal(resend.calls.length, 0);
  });
});

describe("sendPhotoConsentLinkEmails (Email All)", () => {
  it("leaves out bad addresses and links and maps Resend's refusals back", async () => {
    resend.queue.push({ batchErrors: [{ index: 1, message: "refused" }] });
    const result = await email.sendPhotoConsentLinkEmails([
      { to: "a@example.com", scoutFirstName: HOSTILE, url: CONSENT_URL },
      { to: "Pat <b@example.com>", scoutFirstName: "B", url: CONSENT_URL },
      { to: "c@example.com", scoutFirstName: "C", url: CONSENT_URL },
      { to: "d@example.com", scoutFirstName: "D", url: "https://example.invalid/consent/d" },
      { to: "e@example.com", scoutFirstName: "E", url: CONSENT_URL },
    ]);
    assert.deepEqual(result, {
      sent: [true, false, false, false, true],
      unconfirmed: [false, false, false, false, false],
      listChanged: [false, false, false, false, false],
      configured: true,
    });

    assert.equal(resend.calls.length, 1);
    const batch = resend.calls[0].batch ?? [];
    assert.deepEqual(batch.map((m) => m.to), ["a@example.com", "c@example.com", "e@example.com"]);
    assert.equal(resend.calls[0].options?.batchValidation, "permissive");
    // The hostile name is text in the bulk email too.
    assert.equal(anchorAttributes(batch[0].html ?? "").length, 1);
    assert.ok(visibleText(batch[0].html ?? "").includes(HOSTILE));
    assert.deepEqual(testState.emails.map((m) => m.to), ["a@example.com", "e@example.com"]);
  });

  it("splits more than 100 into batches", async () => {
    const messages = Array.from({ length: 101 }, (_, i) => ({ to: `p${i}@example.com`, scoutFirstName: `S${i}`, url: CONSENT_URL }));
    const result = await email.sendPhotoConsentLinkEmails(messages);
    assert.equal(result.sent.filter(Boolean).length, 101);
    assert.deepEqual(resend.calls.map((c) => c.batch?.length), [100, 1]);
  });

  it("reports a batch whose call threw as unconfirmed, not as not sent, without throwing", async () => {
    resend.queue.push({ throws: new Error("connection reset") });
    const result = await email.sendPhotoConsentLinkEmails([{ to: "a@example.com", scoutFirstName: "A", url: CONSENT_URL }]);
    assert.deepEqual(result, { sent: [false], unconfirmed: [true], listChanged: [false], configured: true });
  });
});

describe("sendPhotoConsentLinkEmails: a batch that fails as a whole", () => {
  // What resend@6's fetchRequest returns when the connection drops: no status.
  const DROPPED = { name: "application_error", statusCode: null, message: "Unable to fetch data. The request could not be resolved." };
  const three = (prefix = "") =>
    ["a", "b", "c"].map((n) => ({ to: `${prefix}${n}@example.com`, scoutFirstName: n.toUpperCase(), url: CONSENT_URL }));

  it("no answer, a server error or an empty answer leaves every email in it unconfirmed", async () => {
    for (const behavior of [
      { error: DROPPED },
      { error: { name: "internal_server_error", statusCode: 500, message: "Internal server error" } },
      { error: { name: "concurrent_idempotent_requests", statusCode: 409, message: "In progress" } },
    ]) {
      resend.queue.push(behavior);
      const result = await email.sendPhotoConsentLinkEmails(three());
      assert.deepEqual(result, { sent: [false, false, false], unconfirmed: [true, true, true], listChanged: [false, false, false], configured: true });
    }
    assert.equal(testState.emails.length, 0);

    // An answer with neither a result nor an error (here, after it did go out).
    resend.queue.push({ delivered: true });
    const empty = await email.sendPhotoConsentLinkEmails(three());
    assert.deepEqual(empty.unconfirmed, [true, true, true]);
    assert.deepEqual(empty.sent, [false, false, false]);
  });

  it("a named refusal means none of it went out", async () => {
    for (const error of [
      { name: "validation_error", statusCode: 422, message: "Invalid `from` field." },
      { name: "rate_limit_exceeded", statusCode: 429, message: "Too many requests" },
    ]) {
      resend.queue.push({ error });
      const result = await email.sendPhotoConsentLinkEmails(three());
      assert.deepEqual(result, { sent: [false, false, false], unconfirmed: [false, false, false], listChanged: [false, false, false], configured: true });
    }
  });

  it("only the failed batch is unconfirmed; the others keep their own results", async () => {
    const messages = Array.from({ length: 150 }, (_, i) => ({ to: `p${i}@example.com`, scoutFirstName: `S${i}`, url: CONSENT_URL }));
    resend.queue.push({}, { error: DROPPED });
    const result = await email.sendPhotoConsentLinkEmails(messages);
    assert.equal(result.sent.filter(Boolean).length, 100);
    assert.deepEqual(result.unconfirmed.map((u, i) => (u ? i : -1)).filter((i) => i >= 0), Array.from({ length: 50 }, (_, i) => 100 + i));
  });

  it("sends each batch under the press's key and the batch's number", async () => {
    const key = "0123456789abcdef0123456789abcdef";
    const messages = Array.from({ length: 101 }, (_, i) => ({ to: `p${i}@example.com`, scoutFirstName: `S${i}`, url: CONSENT_URL }));
    await email.sendPhotoConsentLinkEmails(messages, { requestKey: key });
    assert.deepEqual(
      resend.calls.map((c) => c.options),
      [
        { batchValidation: "permissive", idempotencyKey: `pack376-consent-all/${key}/1` },
        { batchValidation: "permissive", idempotencyKey: `pack376-consent-all/${key}/2` },
      ]
    );
  });

  it("the same press again after Resend's answer was lost: Resend hands back the first result, nobody gets a second copy", async () => {
    const key = "11111111111111111111111111111111";
    resend.queue.push({ delivered: true, error: DROPPED });
    const first = await email.sendPhotoConsentLinkEmails(three(), { requestKey: key });
    assert.deepEqual(first.unconfirmed, [true, true, true]);
    assert.equal(testState.emails.length, 3, "it did go out");

    const again = await email.sendPhotoConsentLinkEmails(three(), { requestKey: key });
    assert.deepEqual(again, { sent: [true, true, true], unconfirmed: [false, false, false], listChanged: [false, false, false], configured: true });
    assert.equal(testState.emails.length, 3, "no second copy");
  });

  it("the same press after the list changed: Resend refuses rather than emailing everyone again, and says so", async () => {
    const key = "22222222222222222222222222222222";
    resend.queue.push({ delivered: true, error: DROPPED });
    await email.sendPhotoConsentLinkEmails(three(), { requestKey: key });
    const changed = await email.sendPhotoConsentLinkEmails(three().slice(1), { requestKey: key });
    assert.deepEqual(changed, { sent: [false, false], unconfirmed: [false, false], listChanged: [true, true], configured: true });
    assert.equal(testState.emails.length, 3, "nothing sent twice");
  });

  it("a family added since the last try is reported as not sent this time, never as 'may have gone out'", async () => {
    const key = "44444444444444444444444444444444";
    resend.queue.push({ delivered: true, error: DROPPED });
    await email.sendPhotoConsentLinkEmails(three(), { requestKey: key });
    const grown = await email.sendPhotoConsentLinkEmails([...three(), { to: "new@example.com", scoutFirstName: "New", url: CONSENT_URL }], {
      requestKey: key,
    });
    assert.deepEqual(grown, {
      sent: [false, false, false, false],
      unconfirmed: [false, false, false, false],
      listChanged: [true, true, true, true],
      configured: true,
    });
    assert.deepEqual(testState.emails.map((m) => m.to), ["a@example.com", "b@example.com", "c@example.com"]);
  });
});

describe("sendPhotoConsentLinkEmail: the press's key", () => {
  const DROPPED = { name: "application_error", statusCode: null, message: "Unable to fetch data. The request could not be resolved." };
  const key = "33333333333333333333333333333333";

  it("passes an Idempotency-Key made from the press's key and the email itself", async () => {
    await email.sendPhotoConsentLinkEmail("pat@example.com", { scoutFirstName: "Sam", url: CONSENT_URL, requestKey: key });
    await email.sendPhotoConsentLinkEmail("pat@example.com", { scoutFirstName: "Sam", url: CONSENT_URL });
    const [withKey, without] = resend.calls.map((c) => c.options);
    assert.match(withKey?.idempotencyKey ?? "", new RegExp(`^pack376-consent-link/${key}/[0-9a-f]{32}$`));
    assert.equal(without, undefined);
  });

  it("reports a lost answer as uncertain, and the same press again doesn't send a second copy", async () => {
    resend.queue.push({ delivered: true, error: DROPPED });
    const first = await email.sendPhotoConsentLinkEmail("pat@example.com", { scoutFirstName: "Sam", url: CONSENT_URL, requestKey: key });
    assert.deepEqual(first, { sent: false, configured: true, error: DROPPED.message, uncertain: true });
    const again = await email.sendPhotoConsentLinkEmail("pat@example.com", { scoutFirstName: "Sam", url: CONSENT_URL, requestKey: key });
    assert.deepEqual(again, { sent: true, configured: true });
    assert.equal(testState.emails.length, 1);
  });

  it("the same press with a changed email (a new link) sends the new one rather than being refused", async () => {
    resend.queue.push({ delivered: true, error: DROPPED });
    await email.sendPhotoConsentLinkEmail("pat@example.com", { scoutFirstName: "Sam", url: CONSENT_URL, requestKey: key });
    const newLink = `${CONSENT_URL.slice(0, -2)}ZZ`;
    const again = await email.sendPhotoConsentLinkEmail("pat@example.com", { scoutFirstName: "Sam", url: newLink, requestKey: key });
    assert.deepEqual(again, { sent: true, configured: true });
    assert.equal(testState.emails.length, 2);
    assert.ok(testState.emails[1].html?.includes(newLink));
  });
});

describe("sendReceiptEmail", () => {
  const base = { isDonation: false, receivedFrom: HOSTILE, amountLabel: "$45.00", filename: "receipt.pdf", pdf: new Uint8Array([37, 80, 68, 70]) };

  it("attaches the PDF, keeps the records BCC, and passes the idempotency key", async () => {
    const result = await email.sendReceiptEmail("pat@example.com", {
      ...base,
      bcc: "records@example.com",
      replyTo: "admin@example.com",
      idempotencyKey: "pack376-receipt/r1/a1",
    });
    assert.deepEqual(result, { sent: true, configured: true });
    const call = resend.calls[0];
    assert.equal(call.message?.bcc, "records@example.com");
    assert.equal(call.message?.replyTo, "admin@example.com");
    assert.deepEqual(call.options, { idempotencyKey: "pack376-receipt/r1/a1" });
    assert.deepEqual([...(call.message?.attachments?.[0].content ?? [])], [37, 80, 68, 70]);
    assert.ok(!(call.message?.html ?? "").includes(HOSTILE));
  });

  it("refuses a bad records address rather than silently dropping the copy", async () => {
    const result = await email.sendReceiptEmail("pat@example.com", { ...base, bcc: "records@example.com, other@example.com" });
    assert.equal(result.sent, false);
    assert.equal(resend.calls.length, 0);
  });

  it("leaves off a reply-to that isn't one plain address", async () => {
    const result = await email.sendReceiptEmail("pat@example.com", { ...base, replyTo: "a@example.com, b@example.com" });
    assert.equal(result.sent, true);
    assert.equal(resend.calls[0].message?.replyTo, undefined);
  });
});

describe("telling a refusal from an unconfirmed send", () => {
  // What resend@6's fetchRequest returns when the connection drops: no status.
  const DROPPED = { name: "application_error", statusCode: null, message: "Unable to fetch data. The request could not be resolved." };

  it("counts no answer, server errors and idempotency clashes as unconfirmed", () => {
    for (const error of [
      DROPPED,
      // A non-JSON error page (a gateway) comes back as application_error with its status.
      { name: "application_error", statusCode: 413, message: "Internal server error." },
      { name: "internal_server_error", statusCode: 500, message: "Internal server error" },
      { name: "something_new", statusCode: 503, message: "Unavailable" },
      { name: "concurrent_idempotent_requests", statusCode: 409, message: "In progress" },
      { name: "invalid_idempotent_request", statusCode: 409, message: "Different payload" },
      { message: "no name at all" },
      { name: "", statusCode: null, message: "empty name" },
      { name: "TypeError", message: "fetch failed" },
      new Error("socket hang up"),
      null,
      "a string",
    ]) {
      assert.equal(email.isUnconfirmedFailure(error), true, JSON.stringify(error));
    }
  });

  it("counts a named refusal as definite: nothing went out", () => {
    for (const error of [
      { name: "validation_error", statusCode: 422, message: "Invalid `to` field." },
      { name: "validation_error", statusCode: 403, message: "The domain is not verified." },
      { name: "rate_limit_exceeded", statusCode: 429, message: "Too many requests" },
      { name: "daily_quota_exceeded", statusCode: 429, message: "Quota" },
      { name: "invalid_api_key", statusCode: 403, message: "API key is invalid" },
      // The SDK's own checks, made before any request: no status, but named.
      { name: "missing_required_field", statusCode: null, message: "Missing `id` field." },
    ]) {
      assert.equal(email.isUnconfirmedFailure(error), false, JSON.stringify(error));
    }
  });

  it("sendReceiptEmail marks each failure the same way, and a refused address as definite", async () => {
    const base = { isDonation: true, receivedFrom: "Pat", amountLabel: "$5.00", filename: "r.pdf", pdf: new Uint8Array([1]) };
    resend.queue.push({ error: DROPPED });
    assert.deepEqual(await email.sendReceiptEmail("pat@example.com", base), {
      sent: false,
      configured: true,
      error: "Unable to fetch data. The request could not be resolved.",
      uncertain: true,
    });
    resend.queue.push({ throws: new Error("socket hang up") });
    assert.deepEqual(await email.sendReceiptEmail("pat@example.com", base), {
      sent: false,
      configured: true,
      error: "socket hang up",
      uncertain: true,
    });
    resend.queue.push({ error: { name: "validation_error", statusCode: 422, message: "Invalid `to` field." } });
    assert.deepEqual(await email.sendReceiptEmail("pat@example.com", base), {
      sent: false,
      configured: true,
      error: "Invalid `to` field.",
      uncertain: false,
    });
    // Refused here, before Resend is called: certainly not sent.
    const local = await email.sendReceiptEmail("pat\u0085@example.com", base);
    assert.equal(local.sent, false);
    assert.equal(local.uncertain, undefined);
    assert.equal(resend.calls.length, 3);
    assert.equal(testState.emails.length, 0);
  });
});
