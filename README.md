# Pack 376

The Pack 376 website and its login-gated portal, in one Next.js app:

- **Public site**: home, activities, gallery, rank requirements, parent resources, and more, at www.pack376nyc.org.
- **Portal** (`src/app/portal`): advancement, attendance, rosters, dues, events, photo consent and the admin tools. It is served at portal.pack376nyc.org.
- **Camp Conron trip page** (`src/app/camp-conron`): served at conron.pack376nyc.org.

`src/proxy.ts` maps both subdomains onto their route prefixes. It also does a first, cookie-only check on portal routes by role. The real permission checks are in `src/lib/authorize.ts`.

Data is in Postgres (Neon in production) through Prisma (`prisma/schema.prisma`). Uploaded images and flyers go to Vercel Blob.

## Local development

```bash
npx prisma dev        # local Postgres; leave it running
npm run dev           # http://localhost:3000, portal at /portal
```

Settings come from `.env` and `.env.local`. To make a local login, run `prisma/createDevAdmin.ts`; the header comment in that file explains how. To load the adventure list, run `npm run db:seed`.

## Checks and tests

```bash
npm run lint
npm run typecheck     # next typegen + tsc
npm test              # unit tests (tests/unit), no database
npm run test:db       # real-Postgres tests (tests/db), see below
npm run build         # compile only; never touches a database's schema
node scripts/check-schema-guards.mjs   # with MIGRATION_DATABASE_URL set: any skipped guarded checks
```

`npm run test:db` needs a **local, throwaway** Postgres. Set `TEST_DATABASE_URL` to an admin login on it (e.g. `postgresql://postgres:password@127.0.0.1:5432/postgres`); anything that isn't localhost is refused. The script migrates a template database and gives each test file its own copy, dropped afterwards. The local `npx prisma dev` database can't be used for these: it serves one connection at a time, and the tests open several at once to check locking.

GitHub Actions (`.github/workflows/ci.yml`) runs all of the above on every push and pull request, against a Postgres container with placeholder secrets.

Node.js: 24.x (`engines` in package.json; `.nvmrc` pins the patched 24.22.1 for local and CI).

## Deploying

Pushing to `main` deploys to production on Vercel. Vercel runs `npm run vercel-build` (`vercel.json`, `scripts/vercel-build.mjs`): for a **production** deploy it applies new migrations in `prisma/migrations` (`prisma migrate deploy`), reports any guarded database checks a migration had to skip (`scripts/schema-guards.mjs`), and then builds. Preview deploys only build and never touch a database, so a preview of a release with new migrations needs its own database migrated first (see `docs/security-operations.md` §1). If `VERCEL_ENV` isn't available the build stops rather than guess. If a migration fails, the build fails and the previous deploy keeps serving.

Migrations connect with `MIGRATION_DATABASE_URL` if it is set, otherwise `DATABASE_URL_UNPOOLED` (`prisma.config.ts`). The running site only uses `DATABASE_URL`. To run migrations by hand against a database: `npm run db:migrate:deploy`.
