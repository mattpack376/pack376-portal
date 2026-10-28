/*
 * A Resend stand-in for tests that need a send to fail, throw, or pause in
 * flight — the shared fake in tests/support/mocks/resend.mjs always succeeds.
 * Swapped in for "resend" by installControllableResend() (./resend.ts). Each send
 * takes the next queued behavior, if any; a send that goes out is recorded in
 * the same testState.emails list the shared fake uses, so tests read sent mail
 * the same way.
 *
 * Single and batch sends also keep Resend's idempotency rule: once an email
 * (or a batch) has gone out under an Idempotency-Key, a repeat of that key
 * with the same message(s) returns the first result without sending, and
 * with different ones is refused (409 invalid_idempotent_request). A failed
 * send leaves no key behind, as Resend only matches keys against emails it
 * sent.
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

const KEY_CLASH = {
  data: null,
  error: {
    name: "invalid_idempotent_request",
    statusCode: 409,
    message: "This idempotency key has already been used on a request that had a different payload.",
  },
  headers: null,
};

/** What Resend itself does with a message that reached it. */
function accept(message, key) {
  const remembered = key ? control.sentKeys.get(key) : undefined;
  if (remembered) return remembered.fingerprint === fingerprint(message) ? remembered.response : KEY_CLASH;
  state.emails.push(message);
  const response = { data: { id: `double-${state.emails.length}` }, error: null, headers: null };
  if (key) control.sentKeys.set(key, { fingerprint: fingerprint(message), response });
  return response;
}

/** The same for a batch that reached it; `errors` are the ones permissive validation turned down. */
function acceptBatch(messages, key, errors) {
  const remembered = key ? control.sentKeys.get(key) : undefined;
  if (remembered) return remembered.fingerprint === fingerprint(messages) ? remembered.response : KEY_CLASH;
  const failed = new Set(errors.map((e) => e.index));
  state.emails.push(...messages.filter((_, i) => !failed.has(i)));
  const response = {
    data: { data: messages.map((_, i) => ({ id: `double-batch-${i}` })), errors },
    error: null,
    headers: null,
  };
  if (key) control.sentKeys.set(key, { fingerprint: fingerprint(messages), response });
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
        const errors = behavior?.batchErrors ?? [];
        if (behavior?.delivered) {
          // As for a single send: it went out, then the answer was lost.
          if (behavior.beforeResult) await behavior.beforeResult(messages);
          acceptBatch(messages, options?.idempotencyKey, errors);
          if (behavior.throws) throw behavior.throws;
          return { data: null, error: behavior.error ?? null, headers: null };
        }
        const error = await apply(behavior, messages);
        if (error) return { data: null, error, headers: null };
        return acceptBatch(messages, options?.idempotencyKey, errors);
      },
    };
  }
}
