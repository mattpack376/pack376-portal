/*
 * Request keys for a button whose press sends email. The page makes one per
 * press and sends it with the request, and the server hands it to Resend as
 * (part of) the Idempotency-Key. A press that repeats an earlier one whose
 * outcome isn't known sends the same key again, so if the first did go out
 * Resend returns that result instead of sending a second copy. The receipts
 * use these too (see receipts.ts), tied to the receipt on screen.
 */
const REQUEST_KEY_PATTERN = /^[0-9a-f]{32}$/;

/** 128 random bits as hex. getRandomValues rather than randomUUID, which some browsers only offer on https. */
export function newRequestKey() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function isRequestKey(value: unknown): value is string {
  return typeof value === "string" && REQUEST_KEY_PATTERN.test(value);
}

/**
 * How long a page keeps offering to repeat a press under its key. Resend
 * remembers an Idempotency-Key for 24 hours; an hour short of that, a repeat
 * is no longer trusted to be recognized, so the next press is a new request.
 */
export const REPEAT_WINDOW_MS = 23 * 60 * 60 * 1000;

/** A press of a send button: its key, and when it was first used. */
export type Press = { key: string; at: number };

/**
 * The key for this press. `repeat` says the last press's outcome isn't known
 * (Resend didn't confirm it, or no answer came back at all): then this press
 * is that same request again, under the same key — as long as Resend still
 * remembers it. Any other press is a new request with a new key.
 */
export function keyForPress(last: Press | null, repeat: boolean, now = Date.now()): Press {
  if (repeat && last && now - last.at < REPEAT_WINDOW_MS) return last;
  return { key: newRequestKey(), at: now };
}

/**
 * A form action for useActionState that never rejects. A Server Action call
 * that gets no answer at all — a dropped connection, a timeout, an error page
 * instead of a result — rejects, and React shows that as the page's error
 * screen, taking the button and its last request key with it. Wrapped in
 * this, it comes back as `{ unreachable: true }` instead, so the page can say
 * the outcome isn't known and the next press can repeat the same request.
 */
export function orUnreachable<S extends { unreachable?: boolean }>(action: (state: S, formData: FormData) => Promise<S>) {
  return async (state: S, formData: FormData): Promise<S> => {
    try {
      return await action(state, formData);
    } catch {
      return { unreachable: true } as S;
    }
  };
}
