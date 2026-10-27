/*
 * The sign-in form as markup, for each kind of state its action returns:
 * every message announced (role="alert"), only the fields a message is about
 * marked invalid and tied to it, the username kept, the password never
 * written back. (Rendered on the server, so focus moving to the message
 * isn't covered here.)
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import LoginView from "@/app/portal/login/LoginView";
import type { LoginState } from "@/app/portal/login/actions";
import { MAX_PASSWORD_INPUT_LENGTH, MAX_USERNAME_LENGTH } from "@/lib/credentialInput";

function render(state: LoginState, pending = false) {
  return renderToStaticMarkup(createElement(LoginView, { state, formAction: () => {}, pending }));
}

/** The opening tag of the input with this id. */
function inputTag(html: string, id: string) {
  const tag = html.match(new RegExp(`<input id="${id}"[^>]*>`))?.[0];
  assert.ok(tag, `no #${id} input`);
  return tag;
}

function marked(html: string, id: string) {
  const tag = inputTag(html, id);
  const invalid = /aria-invalid="true"/.test(tag);
  assert.equal(/aria-describedby="login-error"/.test(tag), invalid, `#${id}: marked and described together`);
  return invalid;
}

describe("LoginView", () => {
  it("starts with no message and nothing marked", () => {
    const html = render({});
    assert.doesNotMatch(html, /role="alert"|aria-invalid|aria-describedby/);
    assert.match(inputTag(html, "username"), new RegExp(`maxLength="${MAX_USERNAME_LENGTH}"`));
    assert.match(inputTag(html, "password"), new RegExp(`maxLength="${MAX_PASSWORD_INPUT_LENGTH}"`));
  });

  it("marks both fields for a wrong username or password", () => {
    const html = render({ error: "Invalid username or password.", fields: ["username", "password"], username: "someone" });
    assert.match(html, /<div id="login-error" tabindex="-1" class="form-error" role="alert">Invalid username or password.<\/div>/);
    assert.equal(marked(html, "username"), true);
    assert.equal(marked(html, "password"), true);
  });

  it("marks only the blank field", () => {
    const html = render({ error: "Enter a username and password.", fields: ["password"], username: "someone" });
    assert.equal(marked(html, "username"), false);
    assert.equal(marked(html, "password"), true);
  });

  it("announces a refusal about neither field without marking either", () => {
    for (const error of [
      "Too many login attempts. Try again in a few minutes.",
      "Too many failed attempts. Try again in about 15 minutes.",
      "This account is inactive. Ask an admin to make it active again.",
    ]) {
      const html = render({ error, username: "someone" });
      assert.match(html, /role="alert"/, error);
      assert.equal(marked(html, "username"), false, error);
      assert.equal(marked(html, "password"), false, error);
    }
  });

  it("keeps the username and never writes the password back", () => {
    const html = render({ error: "Invalid username or password.", fields: ["username", "password"], username: "keeps-name" });
    assert.match(inputTag(html, "username"), /value="keeps-name"/);
    const password = inputTag(html, "password");
    assert.match(password, /type="password"/);
    assert.doesNotMatch(password, /value=/);
  });

  it("shows the busy label while signing in", () => {
    assert.match(render({}, true), /<button[^>]*disabled=""[^>]*>Signing in…<\/button>/);
  });
});
