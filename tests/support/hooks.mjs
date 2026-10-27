/*
 * Loaded with `node --import tsx --import ./tests/support/hooks.mjs --test`.
 *
 * Swaps only the modules that need a live Next.js request or an external
 * service for local stand-ins (see ./mocks). Everything else — Prisma, the
 * Server Action files, auth/session signing, email HTML builders — is the real
 * code. registerHooks (synchronous) also covers require(), which is how tsx
 * loads the app's TypeScript.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { registerHooks } from "node:module";

// Shared state the stand-ins read and tests inspect (typed in ./context.ts).
globalThis.__pack376Test ??= {
  als: new AsyncLocalStorage(),
  emails: [],
  blobPuts: [],
  blobDeletes: [],
  revalidated: [],
  rateLimited: false,
  failBlobPut: false,
  failBlobDel: false,
  blobHost: "test.public.blob.vercel-storage.com",
  resendQueue: [],
  pauses: {},
};

// Signing test sessions needs a secret; never the real one.
process.env.AUTH_SECRET ??= "test-only-auth-secret-not-used-anywhere-else-0123456789";
// Emails go to the fake Resend client below; this only makes email.ts try.
process.env.RESEND_API_KEY ??= "re_test_only";

const here = new URL("./mocks/", import.meta.url);
const MOCKS = {
  "server-only": "server-only.mjs",
  "next/cache": "next-cache.mjs",
  "next/navigation": "next-navigation.mjs",
  "next/headers": "next-headers.mjs",
  "@vercel/firewall": "firewall.mjs",
  "@vercel/blob": "blob.mjs",
  resend: "resend.mjs",
  bcryptjs: "bcryptjs.mjs",
};

registerHooks({
  resolve(specifier, context, next) {
    // A stand-in that wraps the real package (bcryptjs.mjs) imports it by the
    // same name; let those imports through to the real module.
    if (context.parentURL?.startsWith(here.href)) return next(specifier, context);
    if (Object.hasOwn(MOCKS, specifier)) {
      return { url: new URL(MOCKS[specifier], here).href, format: "module", shortCircuit: true };
    }
    return next(specifier, context);
  },
});
