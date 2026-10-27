// A fake Resend client: captures every message, sends nothing.
const state = globalThis.__pack376Test;
export class Resend {
  constructor() {
    this.emails = {
      send: async (message) => {
        state.emails.push(message);
        return { data: { id: `test-${state.emails.length}` }, error: null };
      },
    };
    this.batch = {
      send: async (messages) => {
        state.emails.push(...messages);
        return { data: { data: messages.map((_, i) => ({ id: `test-batch-${i}` })), errors: [] }, error: null };
      },
    };
  }
}
