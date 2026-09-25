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

## Deploying

Pushing to `main` deploys to production on Vercel. The build (`npm run build`) runs `prisma migrate deploy` first, so new migrations in `prisma/migrations` apply to the live database automatically.
