/*
 * The set-your-password form as markup, for each state its action can return:
 * one heading that matches the state, errors announced (role="alert") and tied
 * to the field they're about, and no password ever written back into the page.
 * (Rendered on the server, so focus moving to the message isn't covered here.)
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DeadLinkNotice, SetPasswordView } from "@/components/SetPasswordForm";
import { DEAD_LINK_TEXT, MAX_PASSWORD_INPUT_LENGTH } from "@/lib/credentialInput";
import type { CompleteResetState } from "@/lib/actions/passwordReset";

const TOKEN = "A".repeat(43);

function render(state: CompleteResetState, pending = false) {
  return renderToStaticMarkup(createElement(SetPasswordView, { token: TOKEN, state, formAction: () => {}, pending }));
}

function headings(html: string) {
  return [...html.matchAll(/<h1[^>]*>(.*?)<\/h1>/g)].map((m) => m[1]);
}

/** The opening tag of the input with this id. */
function inputTag(html: string, id: string) {
  const tag = html.match(new RegExp(`<input id="${id}"[^>]*>`))?.[0];
  assert.ok(tag, `no #${id} input`);
  return tag;
}

describe("SetPasswordView", () => {
  it("starts with the form, its heading, and no alert", () => {
    const html = render({});
    assert.deepEqual(headings(html), ["Set Your Password"]);
    assert.doesNotMatch(html, /role="alert"|aria-invalid/);
    assert.match(html, /<input type="hidden" name="token" value="A{43}"\/>/);
    // The browser stops at the same cap the action checks first.
    for (const id of ["password", "confirmPassword"]) {
      assert.match(inputTag(html, id), new RegExp(`maxLength="${MAX_PASSWORD_INPUT_LENGTH}"`));
    }
  });

  it("ties an error about one field to that field only", () => {
    const html = render({ error: "Passwords don't match.", field: "confirmPassword" });
    assert.deepEqual(headings(html), ["Set Your Password"]);
    assert.match(html, /<div id="set-password-error" tabindex="-1" class="form-error" role="alert">Passwords don&#x27;t match.<\/div>/);
    const confirm = inputTag(html, "confirmPassword");
    assert.match(confirm, /aria-invalid="true"/);
    assert.match(confirm, /aria-describedby="set-password-error"/);
    assert.doesNotMatch(inputTag(html, "password"), /aria-invalid|aria-describedby/);
  });

  it("announces an error about neither field without marking either", () => {
    const html = render({ error: "Your new password couldn't be saved. Please try again in a moment." });
    assert.match(html, /role="alert"/);
    assert.doesNotMatch(html, /aria-invalid/);
  });

  it("never writes a password back into the page", () => {
    for (const state of [{}, { error: "Password must be at least 8 characters.", field: "password" as const }]) {
      const html = render(state);
      for (const id of ["password", "confirmPassword"]) {
        const tag = inputTag(html, id);
        assert.match(tag, /type="password"/);
        assert.doesNotMatch(tag, /value=/);
      }
    }
  });

  it("replaces the form, heading included, once the link is dead", () => {
    for (const reason of ["invalid", "inactive"] as const) {
      const html = render({ error: DEAD_LINK_TEXT[reason].message, linkDead: reason });
      assert.deepEqual(headings(html), [DEAD_LINK_TEXT[reason].heading], reason);
      assert.doesNotMatch(html, /Set Your Password|Choose a password|<form|<input/, reason);
      assert.match(html, /role="alert"/);
      assert.match(html, /<a href="\/portal\/login">Go to the sign-in page<\/a>/);
      // The same view the page renders for a dead link on first load.
      assert.equal(html, renderToStaticMarkup(createElement(DeadLinkNotice, { reason })), reason);
    }
  });

  it("shows the busy label while saving", () => {
    const html = render({}, true);
    assert.match(html, /<button[^>]*disabled=""[^>]*>Saving…<\/button>/);
  });
});
