/*
 * Vercel's build command (see vercel.json).
 *
 * `npm run build` only compiles. Applying database migrations is a separate,
 * explicit release step, and on Vercel it runs for PRODUCTION deploys only:
 * a preview deploy (or anything else) compiles without touching a database,
 * so a branch preview can never change the live schema.
 *
 * Production keeps today's release flow: push to main → Vercel applies any
 * pending migrations, then builds. If the migration fails, the build fails and
 * Vercel keeps serving the previous deploy.
 *
 * Migrations connect with MIGRATION_DATABASE_URL when it is set, otherwise
 * DATABASE_URL_UNPOOLED (see prisma.config.ts) — so a separate, more
 * privileged migration login can be added in Vercel's Production environment
 * without the running site ever holding it.
 */
import { spawnSync } from "node:child_process";
import { reportSchemaGuards } from "./schema-guards.mjs";

// Node's October 21, 2026 security release for the 24.x line.
const PATCHED_NODE = [24, 22, 1];

function run(command, args) {
  console.log(`[vercel-build] $ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`[vercel-build] "${command} ${args.join(" ")}" failed (exit ${result.status ?? result.signal}).`);
    process.exit(result.status ?? 1);
  }
}

function olderThan(version, minimum) {
  const parts = version.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < minimum.length; i++) {
    if (parts[i] !== minimum[i]) return parts[i] < minimum[i];
  }
  return false;
}

const vercelEnv = process.env.VERCEL_ENV;
console.log(`[vercel-build] Node ${process.version}; VERCEL_ENV=${vercelEnv ?? "(not set)"}`);
if (olderThan(process.version, PATCHED_NODE)) {
  console.warn(
    `[vercel-build] WARNING: Node ${process.version} predates the ${PATCHED_NODE.join(".")} security release. ` +
      "Check the Node.js version in Vercel → Settings → Build and Deployment.",
  );
}

if (vercelEnv === "production") {
  run("npx", ["--no-install", "prisma", "migrate", "deploy"]);
  await reportSchemaGuards(process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL_UNPOOLED);
} else if (vercelEnv === "preview" || vercelEnv === "development") {
  console.log(
    `[vercel-build] ${vercelEnv} deploy — skipping database migrations. If this release adds migrations, ` +
      "migrate the preview's own database first (docs/security-operations.md §1.1), or sign-in and other pages will fail on it.",
  );
} else {
  // Unable to tell production from preview: refuse rather than guess.
  // Skipping would ship code ahead of its schema; migrating could change the
  // live database from a preview. A failed build is never promoted. (Only
  // vercel.json runs this script; locally, use `npm run build`.) VERCEL_ENV
  // is missing when the project's system environment variables are hidden —
  // and so is VERCEL, so that can't be used to tell this apart from a laptop.
  console.error(
    `[vercel-build] VERCEL_ENV is ${vercelEnv ? `"${vercelEnv}"` : "not set"}, so this build cannot tell whether to migrate. ` +
      'In Vercel → Settings → Environment Variables, turn on "Enable access to System Environment Variables". ' +
      "To build on your own computer, use `npm run build`.",
  );
  process.exit(1);
}

run("npx", ["--no-install", "next", "build"]);
