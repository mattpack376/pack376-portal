/*
 * A Resend stand-in for tests that need a send to fail, throw, or pause in
 * flight — the shared fake in tests/support/mocks/resend.mjs always succeeds.
 * Swapped in for "resend" by installControllableResend() (./resend.ts). Each send
 * takes the next queued behavior, if any; a send that goes out is recorded in
 * the same testState.emails list the shared fake uses, so tests read sent mail
 * the same way.
 */
const state = globalThis.__pack376Test;
const control = (globalThis.__pack376ResendControl ??= { queue: [], calls: [] });

async function apply(behavior, payload) {
  if (behavior?.beforeResult) await behavior.beforeResult(payload);
  if (behavior?.throws) throw behavior.throws;
  return behavior?.error ?? null;
}

export class Resend {
  constructor() {
    this.emails = {
      send: async (message, options) => {
        control.calls.push({ message, options });
        const error = await apply(control.queue.shift(), message);
        if (error) return { data: null, error, headers: null };
        state.emails.push(message);
        return { data: { id: `double-${state.emails.length}` }, error: null, headers: null };
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
