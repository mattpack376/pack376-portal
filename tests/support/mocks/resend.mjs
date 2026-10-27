// A fake Resend client: captures every message, sends nothing.
//
// testState.resendQueue lets a test script the next sends, one entry per call
// (single or batch): { error: { name, message } } makes the call return that
// error, { throws: "message" } makes it throw, { pause: async () => {} } holds
// it until the promise resolves. An empty queue means success.
const state = globalThis.__pack376Test;

async function nextBehavior() {
  const behavior = state.resendQueue.shift();
  if (!behavior) return null;
  if (behavior.pause) await behavior.pause();
  if (behavior.throws) throw new Error(behavior.throws);
  return behavior.error ? { data: null, error: behavior.error } : null;
}

export class Resend {
  constructor() {
    this.emails = {
      send: async (message, options) => {
        const failed = await nextBehavior();
        if (failed) return failed;
        state.emails.push(options ? { ...message, sendOptions: options } : message);
        return { data: { id: `test-${state.emails.length}` }, error: null };
      },
    };
    this.batch = {
      send: async (messages, options) => {
        const failed = await nextBehavior();
        if (failed) return failed;
        state.emails.push(...messages.map((m) => (options ? { ...m, sendOptions: options } : m)));
        return { data: { data: messages.map((_, i) => ({ id: `test-batch-${i}` })), errors: [] }, error: null };
      },
    };
  }
}
