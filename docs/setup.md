# Setup and deployment runbook

This is a runbook for the checked-in application, not evidence of a deployment.
Start with local development. Hosted staging and production need separate,
owner-authorised configuration and [release gates](release-checklist.md).

## 1. Prerequisites and dependency policy

Run commands from the repository root, in your own worktree.

| Requirement | Source-verified baseline |
| --- | --- |
| Node.js | Use Node 24.16.0 (the environment used for this docs pass). `package.json` has no `engines` pin. Next alone accepts >=20.9, but the locked Supabase JS requires >=22 and some locked test dependencies require ^22.22.2, ^24.15.0 or >=26. Do not assume Node 20 runs this toolchain. |
| pnpm | pnpm only. This pass used 10.30.1; pnpm 11 was not exercised here. There is no `packageManager` pin. Use the team's approved version and the frozen lockfile, not npm/yarn or a dependency upgrade. |
| Docker | Running Docker engine for local Supabase; CLI observed here: 29.9.2. No Docker version is pinned by the repo. |
| Supabase CLI | Installed separately, not a package dependency; observed here: 2.117.0. Its `--workdir`, `start`, `db reset --local`, `status -o json` and `stop` flags were checked. |
| Other tools | Git and a POSIX shell. `psql` is required by lifecycle tests. Playwright's Chromium installation is required for e2e. |

`package.json` and `pnpm-lock.yaml` resolve Next **16.4.2**, React/React DOM
**19.3.1**, TypeScript **5.9.3**, Tailwind **4.3.3**, Supabase JS **2.118.0**,
`@supabase/ssr` **0.12.7**, sharp **0.35.5**, heic-decode **2.1.0**, Vitest
**5.0.5** and Playwright **1.64.1**. Do not replace these with generic framework
setup instructions. Read the installed `node_modules/next/dist/docs/` guides
before changing Next code.

```sh
node --version
pnpm --version
pnpm install --frozen-lockfile
```

`pnpm-workspace.yaml` is dependency policy, not a suggestion:

- `minimumReleaseAge: 1440` is a 1,440-minute (one-day) release-age gate. Keep it.
- `allowBuilds` allows `sharp` and `unrs-resolver`, and denies `msw`.
- This install exited 0 but warned `Ignored build scripts: esbuild@0.28.2`.
  Do not blanket-approve scripts, add a placeholder `allowBuilds` entry, disable
  the age gate, or change policy just to silence a warning. An authorised
  maintainer must review any policy change; verify the actual tests/build.
- Lockfile format is `9.0`; a successful install must not silently rewrite it.

## 2. Local quick start without colliding with another worktree

### Create an owned, temporary stack configuration

**Do not run bare `pnpm db:start` / `pnpm db:reset` on this shared Mac.** They
target the checked-in `project_id = "nabalens"` and its fixed ports. A different
worktree may own that stack. Never stop, reset or reuse its containers.

First inspect running containers and their published ports:

```sh
docker ps --format 'table {{.Names}}\t{{.Ports}}'
```

Choose an unused full port block and app port. The example below uses **614xx**
and **3000**; these are examples, not reserved ports. Check other listeners too.
Keep this shell open so `$W` continues to identify your owned workdir.

```sh
W=$(mktemp -d "${TMPDIR:-/tmp}/nabalens-local.XXXXXX")
APP_PORT=3000
# Last two arguments are an unused 100-port base and app port.
node --input-type=module - "$W" 61400 "$APP_PORT" <<'NODE'
import { cpSync, readFileSync, writeFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"
const [workdir, rawBase, rawApp] = process.argv.slice(2)
const base = Number(rawBase), app = Number(rawApp)
if (!Number.isInteger(base) || base % 100 || base < 1024 || base > 65400 ||
    !Number.isInteger(app) || app < 1024 || app > 65535)
  throw new Error("Choose valid unused ports")
const target = join(resolve(workdir), "supabase")
cpSync("supabase", target, {
  recursive: true,
  filter: p => !/[/\\]\.(temp|branches)([/\\]|$)/.test(p),
})
const file = join(target, "config.toml")
let config = readFileSync(file, "utf8")
  .replace(/^project_id = ".*"$/m, `project_id = "${basename(workdir).toLowerCase()}"`)
  .replace(/^(\s*(?:\w+_)?port = )554(\d\d)$/gm,
    (_, prefix, suffix) => `${prefix}${base + Number(suffix)}`)
  .replace(/^site_url = ".*"$/m, `site_url = "http://127.0.0.1:${app}"`)
  .replace(/^additional_redirect_urls = .*$/m,
    `additional_redirect_urls = ["http://127.0.0.1:${app}/auth/callback"]`)
for (const service of ["studio", "realtime", "analytics", "edge_runtime"])
  config = config.replace(new RegExp(`(\\[${service}\\]\\s*\\n)enabled = \\w+`),
    "$1enabled = false")
if (/= 554\d\d$/m.test(config)) throw new Error("Unmoved default port")
writeFileSync(file, config)
console.log(`Owned stack: ${workdir}; API ${base + 21}; inbox ${base + 24}`)
NODE
```

This copies migrations, seed and templates together, preserving the template
paths. Only the temporary config changes. Keep `supabase/config.toml` unchanged
in Git. `APP_PORT` and `$W` above are shell recipe variables, not application
environment settings.

Ports from `supabase/config.toml` and their mapping in this example:

| Service/key | Checked-in port | Example owned port |
| --- | ---: | ---: |
| `[api] port` | 55421 | 61421 |
| `[db] port` / `shadow_port` | 55422 / 55420 | 61422 / 61420 |
| `[studio] port` (disabled in copy) | 55423 | 61423 |
| `[local_smtp] port` (Mailpit web inbox) | 55424 | 61424 |
| `[analytics] port` (disabled) | 55427 | 61427 |
| `[db.pooler] port` (disabled) | 55429 | 61429 |
| `[edge_runtime] inspector_port` (disabled) | 55483 | 61483 |

Postgres major version is **17**. Auth, API, Storage and local SMTP stay enabled.
No Realtime service is needed by the app.

### Start, seed and configure the app

After checking the chosen ports and copied config:

```sh
supabase --workdir "$W" start
# DESTRUCTIVE: only your disposable local stack, never --linked or a hosted URL.
supabase --workdir "$W" db reset --local
supabase --workdir "$W" status
```

`status` displays credentials. Read them only in a private operator terminal;
never paste its output into tickets, logs or handoffs. The reset applies
`supabase/migrations/` then **DEV FIXTURE** data from `supabase/seed.sql`.
This seed is never for staging or production.

Create your own ignored `.env.local` without overwriting an existing file:

```sh
test -e .env.local || cp .env.example .env.local
chmod 600 .env.local
```

Fill the five variables described below using only your owned stack. The local
site origin must match the copy's `auth.site_url` (here
`http://127.0.0.1:3000`). Then:

```sh
pnpm dev --hostname 127.0.0.1 --port "$APP_PORT"
```

Open `/login` at that origin. Local-only seeded identities are
`dev-admin@nabalens.test`, `dev-staff-a@nabalens.test`,
`dev-staff-b@nabalens.test` and `dev-staff-inactive@nabalens.test`.
A and B share **DEV FIXTURE Venue A**; the last account is inactive. There are no
seeded passwords. Request a sign-in link and open it in your own Mailpit inbox
(here `http://127.0.0.1:61424`). Unknown addresses receive the same neutral UI
response but gain no account.

Stop the app with Ctrl-C. When finished, stop only your stack:

```sh
supabase --workdir "$W" stop
```

Never use `stop --all`, another project's ID, `--no-backup`, or reset someone
else's workdir. Keep the owned workdir if you need its config/data again.

## 3. Complete environment inventory

Verified from `.env.example` and `process.env` references in `lib/`, `app/`,
`scripts/`, test support and Playwright config. Do not commit values.

| Variable | Purpose and exposure |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Required app API origin. Public/browser-visible. Local: your stack's `API_URL`. Used by server and browser clients. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Required public client key, subject to RLS, not a service credential. Local: `PUBLISHABLE_KEY` or `ANON_KEY`. |
| `NEXT_PUBLIC_SITE_URL` | Absolute app origin for email redirects; public, not a secret. Defaults to `http://127.0.0.1:3000` in `lib/supabase/env.ts`; explicitly set it for staging/production. Trailing slashes are removed. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server/operator only**, bypasses RLS. Needed for processing, account management and operator scripts. Local: `SERVICE_ROLE_KEY` (test helpers also accept status `SECRET_KEY`). Never add a public prefix. |
| `CLEANUP_SECRET` | **Server/scheduler only**, at least 32 characters; authenticates POST `/api/internal/cleanup`. Missing/short value returns 503. Not needed by `pnpm cleanup`, which uses the service role. |
| `SUPABASE_URL` | Optional **operator-script** URL alias, not read by web clients. `scripts/lib/service-client.ts` prefers it over `NEXT_PUBLIC_SUPABASE_URL`; unset stale aliases before targeting another environment. Not in `.env.example`. |
| `MAILPIT_URL` | Local test-only inbox URL when using explicit test credentials. Required for email-based e2e paths; otherwise status supplies `MAILPIT_URL` or `INBUCKET_URL`. Never a hosted email credential. |
| `E2E_PORT` | Local Playwright server port, default **3417**; not a runtime app setting. Match the stack Auth Site URL to it when running email e2e. |
| `NABALENS_TEST_DB_URL` | **Test/operator only**, local DB connection (contains credentials) used by lifecycle `psql` timestamp tests. Lifecycle runner obtains `DB_URL` from its workdir. Never point it at a hosted database. |
| `NODE_ENV` | Framework-controlled development/test/production mode; production disables `/ui-preview`. No custom app secret or manual mode override is needed. |

Next loads `.env.local` for development/build/start; public variables are frozen
into client bundles at build time. Build separately with the correct public
configuration for each hosted environment. `tsx` scripts and the test helper
do **not** automatically load that file. Export the intended values in a trusted
shell, or explicitly use Node/tsx `--env-file` with a file you created, for example:

```sh
pnpm exec tsx --env-file=.env.local scripts/bootstrap-admin.ts --email "$ADMIN_EMAIL" --name "$ADMIN_NAME"
pnpm exec tsx --env-file=.env.local scripts/seed-venues.ts --file supabase/seed/venues.json
pnpm exec tsx --env-file=.env.local scripts/cleanup.ts
```

`ADMIN_EMAIL` / `ADMIN_NAME` here are operator-chosen shell arguments, not app
configuration; do not set them to invented identities.

There is no `RESEND_API_KEY`, database URL, media-limit or HEIC-memory environment
setting in the application. SMTP is Supabase Auth configuration. Template-only
`env(...)` placeholders in `supabase/config.toml` (`OPENAI_API_KEY` for disabled
Studio, disabled Twilio/Apple provider keys and experimental `S3_*`) are CLI
scaffolding, not NabaLens prerequisites. Do not provision unused services.

## 4. Checks and isolated test stacks

| Command | What it uses |
| --- | --- |
| `pnpm typecheck` | `tsc --noEmit`. After a clean checkout, `pnpm build` generates route types if needed. |
| `pnpm lint` | ESLint. |
| `pnpm test` | Vitest unit project: unit, UI, media and upload/transport tests. No Supabase stack. |
| `pnpm build` | Production `next build`; not a hosted-processing or device certification. |
| `pnpm test:integration` | Vitest integration project; local Supabase, separate identities, runs files serially. |
| `pnpm test:security "$W"` | `tests/security/run.mjs`; requires an explicit isolated workdir outside 554xx. |
| `pnpm test:lifecycle "$W"` | `tests/lifecycle/run.mjs`; explicit isolated workdir outside 554xx, plus `psql`. |
| `pnpm test:e2e` | Playwright, one worker, **zero retries**, mobile Pixel 7 emulation and 1280×800 desktop Chromium; starts its own `next dev`, default :3417. |
| `node tests/media/benchmark-heic.mjs` | Optional disposable-worker memory regression/measurements; see [media pipeline](media-pipeline.md). |

The prepare scripts are useful copy helpers, **not per-worktree isolation**:

| Helper | Default directory under `os.tmpdir()` | Fixed project ID / block |
| --- | --- | --- |
| `node tests/security/prepare-stack.mjs [workdir]` | `nabalens-security-stack` | `nabalens-security` / 564xx |
| `node tests/lifecycle/prepare-stack.mjs [workdir]` | `nabalens-lifecycle-stack` | `nabalens-lifecycle` / 594xx |

Passing a unique directory to those scripts does not change their fixed ID/ports
or disable extra services. Prefer the complete temporary-copy recipe above;
both runners accept its absolute `$W`. Never overwrite/reprepare an active stack.
Run one owned stack/suite at a time and stop it when finished.

Integration/e2e normally fall back to **bare `supabase status`**, which targets
the default project, not `$W`. Supply all three explicit Supabase variables
instead. This helper forwards your owned stack's status privately to the runner:

```sh
local_test() {
  node --input-type=module - "$W" "$@" <<'NODE'
import { execFileSync, spawnSync } from "node:child_process"
const [workdir, script, ...args] = process.argv.slice(2)
const raw = execFileSync("supabase", ["--workdir", workdir, "status", "-o", "json"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
const s = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1))
const result = spawnSync("pnpm", ["run", script, ...args], {
  stdio: "inherit",
  env: {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: s.API_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: s.PUBLISHABLE_KEY ?? s.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: s.SERVICE_ROLE_KEY ?? s.SECRET_KEY,
    MAILPIT_URL: s.MAILPIT_URL ?? s.INBUCKET_URL ?? "",
  },
})
if (result.error) throw result.error
process.exit(result.status ?? 1)
NODE
}
local_test test:integration
pnpm test:security "$W"
pnpm test:lifecycle "$W"
```

These tests write local TEST identities/data. They are not a read-only smoke test.
Their localhost checks do not prove you own a stack; workdir/port checks still
matter. Restore a disposable stack with its **own** reset if needed.

For e2e, create/configure the owned copy with `APP_PORT=3417` (or your chosen
`E2E_PORT`) **before starting it**: email templates use Supabase's Site URL,
not just the Playwright env. Do not leave a separate dev server on that port.

```sh
pnpm exec playwright install chromium
# With the helper above and the matching Auth configuration:
local_test test:e2e
```

For a different port, export `E2E_PORT` in this shell and use that same port in the
copy recipe. Browser emulation does not establish real iPhone/Android support.
See [security tests](security-tests.md), [cleanup](cleanup.md) and the
[release checklist](release-checklist.md).

Other scripts exist but are not setup shortcuts: `pnpm start --port "$APP_PORT"`
serves an existing production build; `pnpm format` rewrites TS/TSX, not Markdown.
`pnpm db:types` overwrites `lib/db/types.ts` and uses bare `--local`; schema
owners must explicitly target their owned workdir before generating types. Do
not run that shorthand against another worktree's stack.

## 5. First admin and owner-confirmed venues

These commands are privileged writes. Verify the target URL, authorised person
and environment first. Local DEV FIXTURE admin needs no bootstrap.

1. An authorised operator creates/invites the real admin in the intended Supabase
   project's **Authentication > Users**. An Auth user must already exist.
2. In a trusted operator shell with the intended URL and service role exported:

   ```sh
   pnpm bootstrap:admin --email "$ADMIN_EMAIL" --name "$ADMIN_NAME"
   ```

3. The script looks up the existing Auth user by email. If no profile exists,
   `--name` is required and it creates an active admin profile. Otherwise it
   promotes/reactivates that profile; an active admin returns `already_admin`.
   It never creates Auth users and never promotes the first sign-up.
4. Sign in and verify `/admin`. Additional admins use this same controlled
   procedure, not the staff invitation UI. Protect service credentials.

`supabase/seed/venues.json` currently contains **`[]`**, not ten real venues.
Get the owner's confirmed list before staging or production. Each entry needs
`name` and a unique lowercase, hyphenated `slug`; `active` is optional. See
`supabase/seed/README.md`. Then, with the intended privileged environment:

```sh
pnpm seed:venues --file supabase/seed/venues.json
```

This upserts by slug, does not delete missing venues, and can update `active`
when supplied. An empty file reports that it is empty and writes nothing; that
is not a successful production venue setup. There is no venue-management UI.
Never substitute development venue names or apply `supabase/seed.sql` to a host.

## 6. Hosted staging and production, owner-authorisation checklist

Repeat and record each step **separately for staging and production**. Every
item starts **NOT DONE, requires owner authorisation**. Nothing here grants
permission to create projects, link/push databases, deploy, change DNS/secrets,
send real invitations or schedule a job.

1. **NOT DONE, requires owner authorisation: project and budget.** Owner selects
   Supabase project, region, Postgres version compatible with the migrations,
   paid-plan limits, spending alerts and responsible operators. Separate staging
   data/keys from production. Record storage, egress and compute allowances;
   product limits are not a claim about a purchased plan.
2. **NOT DONE, requires owner authorisation: migrations.** Review/apply all files
   in `supabase/migrations/` in filename order through the approved deployment
   procedure: `20261029120000_nabalens_schema.sql`,
   `20261029120100_nabalens_access.sql`,
   `20261029120200_nabalens_storage.sql`,
   `20261029150000_nabalens_media_cleanup.sql`,
   `20261029160000_media_client_upload_key.sql`.
   Verify schema, RLS/grants, triggers, reservation idempotency and cleanup RPCs
   afterward. Never use local fixture reset for a hosted environment.
3. **NOT DONE, requires owner authorisation: private buckets and size caps.**
   Migration creates private `media` (209,715,200 bytes = 200 MiB, MIME unrestricted
   at the bucket layer) and private `avatars` (5,242,880 bytes = 5 MiB,
   `image/webp` only). Server converts avatar inputs to WebP. Photos still have
   the server's 20 MiB cap; a 200 MiB bucket cap does not permit oversized photos.
   Confirm the project's global upload cap and plan actually permit these sizes.
   Local `[storage] file_size_limit = "200MiB"` does not configure hosted limits.
   Keep RLS and non-public buckets intact.
4. **NOT DONE, requires owner authorisation: Auth settings.** Enable Email
   passwordless sign-in; disable public sign-ups and anonymous sign-in.
   Login calls `shouldCreateUser: false`. Local `[auth] enable_signup = false`
   blocks creation, while `[auth.email] enable_signup = true` keeps the email
   provider available. Set/review OTP expiry explicitly (local
   `[auth.email] otp_expiry = 3600`, one hour), resend/rate limits and token
   settings. Verify unknown addresses gain no access and inactive/missing
   profiles cannot use protected routes.
5. **NOT DONE, requires owner authorisation: origins and email templates.**
   Set Supabase Auth Site URL to the final HTTPS origin and allow the exact
   `<origin>/auth/callback` redirect. Set `NEXT_PUBLIC_SITE_URL` to the same
   origin. Install `supabase/templates/magic_link.html` and `invite.html` in the
   corresponding Auth template slots. Preserve their links:
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`
   and `...&type=invite`. `/auth/confirm` verifies token hashes across browsers;
   `/auth/callback?code=...` is the PKCE fallback requiring the requesting
   browser. Test invitations, one-use/expired links and recovery on the target
   domain. Do not replace the templates with an unverified default link.
6. **NOT DONE, requires owner authorisation: SMTP.** Configure approved SMTP in
   **Supabase Auth**, for example Resend, with the provider's approved host, port,
   username/password, sender address/name and verified sender domain. These map
   to local `[auth.email.smtp]` keys `enabled`, `host`, `port`, `user`, `pass`,
   `admin_email`, `sender_name`; do not copy the commented SendGrid example as
   working Resend credentials. No app Resend env var exists. Send a real
   authorised staging invitation and sign-in link; check delivery, spam,
   rate-limiting and sender authentication without logging tokens.
7. **NOT DONE, requires owner authorisation: app environment and build.**
   Provision the five `.env.example` variables securely for the target.
   `SUPABASE_SERVICE_ROLE_KEY` and `CLEANUP_SECRET` stay server-only. Set public
   variables at build time, then `pnpm install --frozen-lockfile`,
   `pnpm build` and run `pnpm start` on the approved Node host. Do not use a
   static-only or Edge-only deployment for this app. Verify HTTPS, private
   responses, auth routing and no shared CDN caching of private content.
8. **NOT DONE, requires owner authorisation: Node media runtime.** Start staging
   sizing at **2 GiB** per Node process/function, then measure real uploads/load;
   this is a starting point from [media pipeline](media-pipeline.md), not a
   certified minimum. HEIC deadline is 15,000 ms; sharp's is 10 seconds.
   HEIC V8 worker limits are 128 MiB old / 16 MiB young / 4 MiB stack, with one
   worker per module instance; they do **not** cap WASM/native memory. Host
   timeout must exceed decoding plus storage/network work and existing bounded
   contention retries; a 15-second function is insufficient. Finalise has no
   configured `maxDuration`. Cleanup alone exports `maxDuration = 60`.
   Verify the actual platform timeout/memory/request/stream limits, full 5 MiB
   avatars and 200 MiB resumable videos. Include `lib/media/heic-worker.mjs`,
   sharp and heic-decode in Linux deployment output and test through the actual
   production route. `next.config.ts` is currently empty: no explicit worker
   tracing/memory/timeout configuration is in place. A green build alone does
   not resolve worker packaging or target-runtime support.
9. **NOT DONE, requires owner authorisation: resumable expiry.** Verify on the
   target Storage service that TUS upload URLs/unfinished-transfer retention
   expire in **no more than 24 hours**. No application/config env var controls
   that provider setting. Cleanup relies on this bound because partial TUS data
   is invisible to `storage.objects`; see [cleanup](cleanup.md). Confirm provider
   expiry/lifecycle settings and record evidence before enabling abandonment
   cleanup. Small signed upload URLs use the SDK's separate two-hour lifetime;
   signed **read** URLs use the app's 60-second lifetime.
10. **NOT DONE, requires owner authorisation: admin and venues.** Execute §5
    using approved identities and owner-confirmed venues. Verify no DEV FIXTURE
    data exists in either hosted environment. Invite staff only after this.
11. **NOT DONE, requires owner authorisation: cleanup and scheduler.** Generate
    a server-only secret of at least 32 characters (for example
    `openssl rand -hex 32`, kept out of logs). Schedule authenticated
    **POST `/api/internal/cleanup`** hourly, or run trusted `pnpm cleanup` with
    service credentials. Options: an external scheduler capable of POST, an
    approved service-side script job, or Supabase `pg_cron` + `pg_net` with
    protected secrets (details in [cleanup](cleanup.md)). **Vercel Cron sends
    GET and `CRON_SECRET`; this POST-only route accepts `CLEANUP_SECRET`.**
    It cannot work unchanged; a reviewed route/config change would be needed.
    No scheduler is currently configured. Verify JSON `failed`, `more` and
    lease-skipped reports, not merely HTTP 200; configure failure escalation.
12. **NOT DONE, requires owner authorisation: retention and backups.** Approve
    ready-media, inactive-account, exported-copy and backup retention plus
    recovery objectives and access controls. Back up DB/Auth and private
    objects separately; a database backup does not contain object bytes.
    Record schedules, ownership, encryption and retention. Verify restore
    capability with the rehearsal below before claiming recoverability.
13. **NOT DONE, requires owner authorisation: staging, pilot and release.**
    Run [release gates](release-checklist.md), including real-phone evidence,
    target-runtime HEIC, cross-account denial, cleanup and byte-identical
    download. Obtain owner approval for two confirmed venues before any pilot,
    then a separate production decision. No automated result grants release.

### Restore rehearsal: UNTESTED

No restore has been performed or validated by this docs track. There is no
repository restore script. This is a proposed, owner-approved rehearsal, **not a
tested recovery command sequence**:

1. Select an approved backup point; inventory DB/Auth, all private objects,
   deployment version, environment references and encryption access. Keep secrets
   outside the report. Record expected recovery time/data loss.
2. Provision an isolated recovery project/host with no live staff traffic,
   outgoing invitations, cleanup scheduler or public access.
3. Use the provider's version-compatible DB/Auth restore procedure and separate
   Storage object restore procedure. Reconcile object keys and metadata against
   `media_assets` and avatars. Do not restore bytes into public buckets.
4. Compare restored migration state with the chosen app version before applying
   later migrations. Verify private policies, active/inactive profiles,
   tombstones and deleted-object handling so an old backup cannot resurrect
   removed media for users.
5. Use authorised test identities to verify sign-in, cross-staff denial,
   original-byte hashes, previews, retained venue attribution and cleanup in
   the recovery environment. Record missing objects and actual timing.
6. Obtain a separate owner-approved cutover/rollback plan. Only then consider
   traffic/DNS changes. Destroy recovery copies only under their approved
   retention procedure. Until this rehearsal passes, restoration remains
   **UNTESTED** and blocks production.
