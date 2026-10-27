/*
 * A Resend stand-in for tests that need a send to fail, throw, or pause in
 * flight — the shared fake in tests/support/mocks/resend.mjs always succeeds.
 * Swapped in for "resend" by installControllableResend() (./resend.ts). Each send
 * takes the next queued behavior, if any; a send that goes out is recorded in
 * the same testState.emails list the shared fake uses, so tests read sent mail
 * the same way.
 *
 * Single sends also keep Resend's idempotency rule: once an email has gone
 * out under an Idempotency-Key, a repeat of that key with the same message
 * returns the first result without sending, and with a different message is
 * refused (409 invalid_idempotent_request). A failed send leaves no key
 * behind, as Resend only matches keys against emails it sent.
 */
import { createHash } from "node:crypto";

const state = globalThis.__pack376Test;
const control = (globalThis.__pack376ResendControl ??= { queue: [], calls: [], sentKeys: new Map() });
control.sentKeys ??= new Map();

const fingerprint = (message) => createHash("sha256").update(JSON.stringify(message)).digest("hex");

async function apply(behavior, payload) {
  if (behavior?.beforeResult) await behavior.beforeResult(payload);
  if (behavior?.throws) throw behavior.throws;
  return behavior?.error ?? null;
}

/** What Resend itself does with a message that reached it. */
function accept(message, key) {
  const remembered = key ? control.sentKeys.get(key) : undefined;
  if (remembered) {
    if (remembered.fingerprint === fingerprint(message)) return remembered.response;
    return {
      data: null,
      error: {
        name: "invalid_idempotent_request",
        statusCode: 409,
        message: "This idempotency key has already been used on a request that had a different payload.",
      },
      headers: null,
    };
  }
  state.emails.push(message);
  const response = { data: { id: `double-${state.emails.length}` }, error: null, headers: null };
  if (key) control.sentKeys.set(key, { fingerprint: fingerprint(message), response });
  return response;
}

export class Resend {
  constructor() {
    this.emails = {
      send: async (message, options) => {
        control.calls.push({ message, options });
        const behavior = control.queue.shift();
        if (behavior?.delivered) {
          // It reached Resend and went out, but the answer was lost on the
          // way back: the caller sees the queued error or throw instead.
          if (behavior.beforeResult) await behavior.beforeResult(message);
          accept(message, options?.idempotencyKey);
          if (behavior.throws) throw behavior.throws;
          return { data: null, error: behavior.error ?? null, headers: null };
        }
        const error = await apply(behavior, message);
        if (error) return { data: null, error, headers: null };
        return accept(message, options?.idempotencyKey);
      },
    };
    this.batch = {
      send: async (messages, options) => {
        control.calls.push({ batch: messages, options });
        const behavior = control.queue.shift();
        const error = await apply(behavior, messages);
        if (error) return { data: null, error, headers: null };
        const errors = behavior?.batchErrors ?? [];
        const failed = new Set(errors.map((e) => e.index));
        state.emails.push(...messages.filter((_, i) => !failed.has(i)));
        return {
          data: { data: messages.map((_, i) => ({ id: `double-batch-${i}` })), errors },
          error: null,
          headers: null,
        };
      },
    };
  }
}
