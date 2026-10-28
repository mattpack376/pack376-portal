# Security operations — Pack 376 portal

For whoever runs the site (pack376nyc.org, portal.pack376nyc.org and the trip
sites). The code can't check any of this by itself: it lives in Vercel, the
database provider, GitHub and the photo library. Work through section 1 after
every release, section 2 once now and then each scouting year, and keep the
decisions in sections 4–6 up to date.

Last reviewed: October 27, 2026 (security review of the same date).

---

## 1. After every release

Try a release on a preview deployment first when it touches sign-in, money,
uploads or the database. Previews never migrate a database by themselves, so
for a release that adds migrations (new folders under `prisma/migrations`),
first bring the **preview's own** database up to date from your computer:

```bash
MIGRATION_DATABASE_URL='<the preview database URL>' npm run db:migrate:deploy
```

Never point that at the production database. A preview whose database is
behind the code fails at sign-in and on other pages ("column … does not
exist"); that says nothing about production, which migrates as it deploys.
Then, on production:

### 1.1 The right code on the right runtime

- [ ] Vercel → Deployments → the current production deployment shows the
      commit you meant to ship (same short SHA as the top of `main`).
- [ ] Its build log has a line like `[vercel-build] Node v24.22.1; VERCEL_ENV=production`.
      The Node version must be **24.22.1 or newer** (October 21, 2026 security
      release). Vercel picks only the major version (24.x, set by `engines` in
      package.json) and rolls out patch releases itself. A
      `WARNING: Node … predates …` line means its rollout hasn't reached this
      project yet: redeploy a day later, and if it persists, check Vercel's
      status page or ask Vercel support.
- [ ] The build log shows `prisma migrate deploy` ran and finished (production
      only; previews never migrate).
- [ ] The build log says `[schema guards] all … guarded database checks are in
      place.` A few migrations add a database check only if no existing row
      breaks it, and otherwise skip it quietly (the app still enforces the
      same rule). A `[schema guards] WARNING` line names the skipped ones: find
      the rows that break the rule (the migration file of that name explains
      it), fix them, then re-run that migration's `DO $$ … $$` block in the
      database console and confirm with
      `MIGRATION_DATABASE_URL='…' node scripts/check-schema-guards.mjs`.
- [ ] Versions on that commit (`npm ls next react react-dom sharp undici @vercel/blob prisma`):
      next 16.4.3, react / react-dom 19.2.9, sharp 0.35.5, undici 6.29.1
      (under @vercel/blob 2.7.0), prisma / @prisma/client 7.10.0 — or newer
      patch releases. Never "fix" a version with `npm audit fix --force`.
- [ ] Photo processing works in production: upload a cover to a test album
      (then delete it). Audit log → the "Created the photo album" entry should
      say **Uploaded (photo details removed)**, and Vercel → Logs should have
      no `[upload] the image library (sharp) couldn't be loaded` line. If it
      does, JPEG and PNG covers are still cleaned by a fallback, but WEBP/GIF
      covers are refused until it's fixed.

### 1.2 Rate limiting (Vercel Firewall)

The sign-in form, the set-your-password (reset/invite link) form and the
public trip registration form each ask the Vercel Firewall whether the visitor
is over a limit, by rule name:

| Rule name (exact)   | Used by                                   | Suggested limit                         |
| ------------------- | ----------------------------------------- | --------------------------------------- |
| `portal-login`      | portal sign-in                            | 10 requests per minute per IP address   |
| `portal-reset`      | finishing a reset or invite link          | 10 requests per 10 minutes per IP address |
| `trip-registration` | public sign-up on conron./cyclones. sites | 20 requests per 10 minutes per IP address |

The trip limit is looser on purpose: at a pack meeting many families sign up
from the same school Wi-Fi, which is one IP address.

- [ ] Vercel → Firewall → all three rules exist, are enabled, and their IDs
      match the names above exactly. (`portal-reset` is new with the October 27
      fixes; until it exists, finishing a link fails open and logs
      `[rate limit] no "portal-reset" rule in the Vercel Firewall`.)
- [ ] Vercel → Logs, search for `[rate limit] no "` — there should be no hits.

**The app fails open on purpose.** If a rule is missing or misnamed, the SDK
reports "not found", the app logs `[rate limit] no "portal-login" rule in the
Vercel Firewall` (or `trip-registration`) and carries on without a limit — a
Firewall mistake must not lock every leader out. What still protects the site
then:

- **Sign-in:** account lockout — 5 wrong passwords lock that account for 15
  minutes. It stops guessing one account's password; it does not stop someone
  trying many usernames, and it is not a limit on server load.
- **Reset/invite links:** a link is a 43-character random token, checked
  cheaply before any password hashing, so guessing links costs the server
  almost nothing; there is no per-account lockout here.
- **Trip registration:** at most 10 registrations per email address per trip,
  plus the duplicate-submission check. A bot that changes email address each
  time is not slowed down.

So a missing rule is worth knowing about quickly:

- [ ] Set up an alert on the log text `[rate limit] no "` (Vercel → Observability
      → Alerts, or a log drain to a service that emails you). If your plan has
      no alerts, search the logs weekly.
- [ ] After creating or changing a rule, test it on a preview: sign in wrongly
      ~15 times in a minute from one device and confirm "Too many login
      attempts. Try again in a few minutes." appears. (Use a test account — the
      lockout counts those attempts too.)

### 1.3 Rolling back

Vercel's Instant Rollback switches the code but never the database. Since the
October 27 fixes, reset and invite links carry a credential version: if you
roll back past that release and then forward again, any reset or invite link
issued while the older code was live shows as invalid. Re-send those with
**Reset Password** (the audit log's `user.resetPassword` / `user.create`
entries show who got one). Every migration in that release only adds optional
columns, tables and checks, so the older code still runs on the newer
database; the new checks only refuse values that code shouldn't write anyway
(an over-long username, a negative amount).

### 1.4 Response headers to spot-check

From any computer: `curl -sI https://pack376nyc.org/` and
`curl -sI https://portal.pack376nyc.org/login`. Expect:

- `strict-transport-security: max-age=63072000; includeSubDomains; preload`
- `x-content-type-options: nosniff`
- `x-frame-options: DENY`
- `referrer-policy: strict-origin-when-cross-origin` — and `no-referrer` on a
  `/reset/…` or `/consent/…` link
- `content-security-policy:` with `img-src 'self' https://jyclzu7uphezevn7.public.blob.vercel-storage.com data:`
  and `frame-ancestors 'none'`

Signed in as an Admin, download one CSV and one PDF export with the browser's
developer tools open (Network tab). Both should show
`cache-control: private, no-store` and `content-disposition: attachment`.

### 1.5 Private exports

Every CSV and PDF export (parents, leaders, attendance, photo consent, event
guests, raffles, trip registrations and expenses) is sent `private, no-store`
so no browser or shared cache keeps a copy, and each export checks who is
asking. A test (`tests/unit/exportRoutes.test.ts`) fails if a new export forgets
either. That can't recall a file someone has saved: keep exports in a shared
drive with restricted sharing, delete them from family or library computers,
and don't email whole-pack contact lists around.

---

## 2. Environments, database and access (check now, then each scouting year)

### 2.1 Keep preview and production apart

In Vercel → Settings → Environment Variables, compare the Production and
Preview values:

- [ ] `DATABASE_URL` / `DATABASE_URL_UNPOOLED` for **Preview** point at a
      separate database or a database branch, never the production one. A
      preview with production's database lets anyone with the preview URL act
      on real families' records.
- [ ] `AUTH_SECRET` is different in Production and Preview (so a preview
      session can't be used on production).
- [ ] `BLOB_READ_WRITE_TOKEN` for Preview belongs to a separate Blob store if
      possible. A preview holding production's token can delete production
      photos and flyers.
- [ ] `RESEND_API_KEY` for Preview is a test key, or unset, so previews can't
      email families.
- [ ] Vercel → Settings → Deployment Protection: previews require Vercel
      Authentication (not public).

### 2.2 Least-privilege database logins

The running site only needs to read and write rows; only a migration needs to
change tables. `MIGRATION_DATABASE_URL` exists for that split
(`prisma.config.ts`, `scripts/vercel-build.mjs`):

1. In the database provider, create a login for the site (e.g. `pack376_app`)
   with `SELECT, INSERT, UPDATE, DELETE` on all tables in `public` (and
   `USAGE` on the schema). The app's row locks and advisory locks need nothing
   more.
2. Set Production `DATABASE_URL` / `DATABASE_URL_UNPOOLED` to that login.
3. Set Production `MIGRATION_DATABASE_URL` to the owner login. Don't set it in
   Preview.
4. After each migration that adds a table, grant the site login access to it
   (or set default privileges once, as the owner:
   `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pack376_app;`).

### 2.3 Encrypted database connections

- [ ] Every database URL in Vercel ends with `sslmode=require` (or
      `sslmode=verify-full`). Neon and Vercel Postgres URLs include it by
      default; check it wasn't dropped when a URL was pasted.

### 2.4 Backups — prove you can restore

Twice a year (e.g. September and February):

1. In the provider, restore production to a new branch/database as of
   yesterday (point-in-time restore).
2. Point a local checkout at the restored copy (never at production) and open
   the portal, or count rows: scouts, dues payments, event and trip payments,
   raffle payments.
3. Compare with production; then delete the restored copy.
4. Note the date and anything that went wrong here: _____________________

### 2.5 Who can deploy or change things

Pushing to `main` deploys to production **and runs database migrations**.

- [ ] GitHub → repository → Settings → Collaborators: only people who should
      deploy. Branch protection on `main` (require the CI check to pass).
- [ ] Vercel team members and their roles; database provider, Resend and
      domain registrar accounts. Remove anyone who has stepped down.
- [ ] Two-factor authentication on every one of those accounts, and on the
      email accounts that receive Admin password-reset links.

### 2.6 Secrets

`AUTH_SECRET` signs every session: changing it signs everyone out (a quick way
to end all sessions after a suspected compromise). Rotate the Resend key and
Blob token if a laptop or account that held them is lost.

---

## 3. Photos, flyers and external sharing

### 3.1 What uploads are accepted

Flyers (events, trips) may be JPEG, PNG, WEBP, GIF or PDF; album covers JPEG,
PNG, WEBP or GIF. Up to 8 MB by the app's own check — but on Vercel a request
body over 4.5 MB is turned away before it reaches the app (Vercel's own
"payload too large" error, not this page's message), so in practice tell
people to keep files under about 4 MB. 12,000 pixels on a side and 50
megapixels. An
animation may have 16 megapixels a frame (about twice a 4K frame), up to 300
frames, and 200 megapixels across all of them: 171 frames at 1080 × 1080, 96
at 1920 × 1080. Its frames have the lower limit because re-saving an animated
WEBP holds several whole frames in memory: a file of a few hundred bytes with
four 49-megapixel frames took the upload past a Vercel function's default
2 GB. The file's own bytes decide what it is, not its name or the type
the browser reports: a file that really is an accepted kind is taken under any
name and stored as what it is (a PNG saved as .jpg is stored as a PNG; a PDF
flyer named like an image as a PDF). SVG drawings, web pages, iPhone HEIC and
AVIF photos, anything else, and a PDF chosen as an album cover are refused
with a message saying what to do. Images are re-saved, which removes EXIF
(including GPS position), comments and anything hidden in the file; covers
are also scaled to 3,000 pixels. A long animated GIF can take several seconds
to re-save. PDFs are stored as uploaded after a check for scripts, launch
actions and attachments; that check can't see inside compressed parts of a
PDF, so it is a filter, not a guarantee. Uploaded files are served from the
Blob storage domain, never from the portal's own domain.

When the image library fails on a file, the admin is told it "couldn't be
read — the file may be damaged", and Vercel → Logs gets an
`[upload] the image library couldn't re-save …` line with the kind of file,
its size and the library's error (never the file's contents). The odd line is
a damaged file; many in a row, for files that open fine, mean the library is
failing on the server — redeploy, and check the versions in §1.1.

### 3.2 What Show, Hide and Delete do to an album

| Action                     | Public gallery          | Cover photo's direct link                         | External photo album link |
| -------------------------- | ----------------------- | ------------------------------------------------- | ------------------------- |
| Show                       | listed                  | works                                             | works                     |
| Hide                       | not listed (in seconds) | **still works** for anyone who has it             | **still works**           |
| Replace the cover          | listed with new cover   | old photo deleted from storage                    | unchanged                 |
| Delete album (Admin only)  | gone                    | deleted from storage; caches may show it a while  | **unchanged**             |

- Hiding is not taking down. The cover is a public, unlisted file, not a
  private one.
- A deletion that fails because storage is down is retried automatically (see
  3.4). Browser, CDN and image caches can keep serving a deleted photo for
  minutes to hours.
- The portal never touches the photo library itself.

### 3.3 Taking a child's photo down

1. Portal: delete the album, or upload a different cover.
2. Photo library (photos.pack376nyc.org): remove the photo, or revoke the
   album's share link.
3. If the photo must disappear from caches quickly: purge the project's CDN
   cache in Vercel (Project → Settings → Caches, where your plan offers it).
   The gallery's resized copies are cached too, and go with it.
4. Check the family's photo consent answer in the portal, so the photo isn't
   used again.

### 3.4 The deletion retry queue

Failed deletions wait in the `PendingBlobDeletion` table and are retried a
few at a time whenever someone uploads or deletes a photo or flyer, waiting
longer after each failure (2 minutes up to a day). An object any album, event
or trip still uses is never deleted. To see what's waiting:

```sql
SELECT url, reason, attempts, "lastError", "nextAttemptAt" FROM "PendingBlobDeletion" ORDER BY "createdAt";
```

A row that keeps failing for days: delete the file by hand (Vercel → Storage
→ Blob → find the path), then delete the row.

### 3.5 External photo-album sharing (review each season)

Each album's link is a share link into the photo library: anyone with it can
see the whole album, whatever the portal shows.

- [ ] List the active share links in the photo library; expire last season's.
- [ ] Shared albums don't offer download of originals (originals carry GPS).
- [ ] Scouts whose families answered **No** to photo consent aren't in shared
      albums.
- [ ] The photo library's admin login has a strong password and 2FA, and you
      know who holds it.

---

## 4. Plan: MFA and recent sign-in for Admins

Today: password sign-in with account lockout; sessions end after 2 days idle
and 45 days at most; changing a password, role or dens signs that account out
everywhere. There is no second factor. Phased plan (nothing below is built
yet):

**Phase 0 — now, no code.** Admins use long, unique passwords from a password
manager. 2FA on the email accounts that receive reset links (email is the
recovery path) and on GitHub, Vercel, the database provider and Resend.

**Phase 1 — confirm the password again for the riskiest actions.** Ask for the
password if the last sign-in was more than ~10 minutes ago before: creating,
promoting or demoting an Admin; resetting someone else's password; deleting a
user; Start a Fresh Year; deleting anything with money attached (payments,
events or trip registrations with payments, scouts with dues or event
payments, raffles, receipts); whole-pack contact exports. Build it as one
server-side check every such Server Action calls (a short-lived "confirmed at"
stamp in the session), not as a dialog alone.

**Phase 2 — second factor for Admin, Junior Admin and the master account.**
Prefer passkeys (they can't be phished); offer an authenticator app (TOTP) as
the alternative. One-time recovery codes, stored hashed. Required for the
master account first, then all Admins. Only the master can reset another
Admin's second factor, and that is audit-logged.

**Phase 3 — tighten staff sessions.** Consider a shorter idle limit for Admin
sessions (e.g. 12 hours) and an email to the Admin when their account signs in
from a new device.

Each phase: test on a preview with a test Admin; keep a documented way back in
if the master loses their second factor.

---

## 5. The all-den test login

`src/lib/denTestAccounts.ts` lists Den Leader logins (currently `denmatt`)
that see **every den** — advancement, attendance, parent names, emails and
phone numbers, Family View and photo consent — without being assigned to any
den. Because it has no den assignments it never appears as a leader anywhere,
so it is easy to forget it exists.

Check each season:

- [ ] Is it still needed in production? If not: Users → mark it inactive (it
      can't sign in), then remove the name from `ALL_DENS_TEST_USERNAMES` in a
      later release.
- [ ] Who knows its password? It should be one person, with a unique password.
- [ ] Audit log → Sign-ins, filter for it: any sign-in you can't explain?
- [ ] It only applies while the account's level is Den Leader. Note: deleting
      the account doesn't retire the name — an account created later with the
      same username gets all-den access again. Remove the name from the list
      when you delete the account.

Long term, replace it with an explicit, audit-logged per-person permission
(like Raffle Helper) or with test data that lives only on preview/local
databases.

---

## 6. Policy records

### 6.1 Calendar "No Meeting" does not close attendance (decided; F9)

**The rule today.** Only the attendance page's **No Meeting** toggle cancels a
meeting for attendance (dens can't record it). A calendar event marked "No
Meeting" only takes the regular Friday meeting off the public calendar and the
Parent Dashboard; attendance for that date stays open. The other direction is
linked: a meeting cancelled on the attendance page also disappears from the
public calendar.

**Why.** On the Camp Conron weekend the calendar says No Meeting — there's no
regular Friday meeting — but leaders still take attendance for the trip.
Scout Sundays and special events work the same way. Making the calendar close
attendance would lose those records.

**What to do.** To cancel a meeting outright (weather, holiday), set both: the
calendar event with No Meeting (for families) and the attendance No Meeting
toggle (for dens).

**Revisit if** a cancelled meeting gets attendance recorded by mistake more
than once a season, or the calendar gains a separate "cancelled" vs "replaced
by an event" choice — then plain cancellations could close attendance
automatically while trips and events don't.

### 6.2 Deleting records with money attached (needs a decision)

Today, deleting one of these also deletes its payment history (the audit log
keeps a one-line summary, not the payments):

- **Start a Fresh Year** (master only) → every scout in that season, each
  with everything in the next item. One action removes a whole season's dues
  and event payment history. Its audit entry mentions advancement,
  attendance, dues and parent contacts, but not the event registrations and
  payments that go with them.
- a scout (den roster **Remove**, or Users → Scouts **Delete**) → their dues
  payments, their event registrations and those registrations' payments, plus
  advancement, attendance, photo consent and parent contacts. Guest groups
  attending with that scout are kept, unlinked from the scout.
- an event → its registrations, guest groups and all their payments
- a guest group → its payments
- a trip registration → its payments
- a raffle → its buyers, boxes and payments (raffle payments are otherwise
  voided, never deleted)

Single payments can also be deleted outright (dues, event, guest-group and
trip payments; trip expenses), with an audit entry but no void-and-keep step.

Saved receipts are not linked to payments and are kept. Nothing about this was
changed in this round. Questions for the pack's leadership and treasurer:

1. Should anything with a payment be deletable at all, or only archived
   (hidden, totals kept)? Inactive scouts already work this way.
2. If deletable, must payments be voided first, with a reason, the way raffle
   payments are?
3. Who may do it — any Admin, or only the master, after confirming the
   password (section 4, Phase 1)?
4. How long must payment history be kept (council or treasurer rules are often
   several years)?
5. Start a Fresh Year: should it keep the season's payment history — archive
   the scouts instead of deleting them, or at least offer a dues and
   event-payment ledger to download first — rather than erase it with the
   roster? There is no dues or scout event-payment download today, so until
   this is decided, have the database backed up (section 2.4) and save or
   print the Dues and Events pages before using it.

A likely answer: archive instead of delete for anything with payments, and
change the payment tables' links to "restrict" so a delete with payments
attached is refused until they are voided. That needs a migration and changes
to the delete buttons; do it as its own piece of work once the answers are in.
