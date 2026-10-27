/*
 * Lets a test file control the Resend client: queue a failure, a thrown
 * network error, or a pause for the next send. Call installControllableResend()
 * at the top level of the test file, before any app module is imported (app
 * modules are imported dynamically after `db.ready`, so top level is early
 * enough). It routes "resend" to ./controllable-resend.mjs for this test
 * process only; tests/support is untouched.
 */
import { registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { SentEmail } from "../support/context";

export type ResendError = { message: string; name?: string; statusCode?: number | null };

export type ResendBehavior = {
  /** Resend answers with this error instead of sending. */
  error?: ResendError;
  /** The SDK call throws this (e.g. a dropped connection). */
  throws?: unknown;
  /** Runs before the send resolves — hold a send "in flight" or inspect the database mid-send. */
  beforeResult?: (payload: unknown) => Promise<void>;
  /** For a batch send: these indexes are reported as refused (permissive validation). */
  batchErrors?: { index: number; message: string }[];
};

export type ResendCall = {
  message?: SentEmail & { attachments?: { filename: string; content: Buffer }[]; replyTo?: string };
  batch?: SentEmail[];
  options?: { idempotencyKey?: string; batchValidation?: string };
};

export type ResendControl = { queue: ResendBehavior[]; calls: ResendCall[] };

const DOUBLE_URL = pathToFileURL(path.join(__dirname, "controllable-resend.mjs")).href;

export function installControllableResend(): ResendControl {
  registerHooks({
    resolve(specifier, context, next) {
      if (specifier === "resend" && context.parentURL !== DOUBLE_URL) {
        return { url: DOUBLE_URL, format: "module", shortCircuit: true };
      }
      return next(specifier, context);
    },
  });
  const holder = globalThis as unknown as { __pack376ResendControl?: ResendControl };
  holder.__pack376ResendControl ??= { queue: [], calls: [] };
  return holder.__pack376ResendControl;
}

/** Empties the queue and the call log; pair with resetTestState() between tests. */
export function resetResendControl(control: ResendControl) {
  control.queue.length = 0;
  control.calls.length = 0;
}
