# Production infrastructure decision

Decided 30 October 2026 from a read-only audit of head `aff8994`: runtime build
inspection, security review, stack-free checks, official pricing pages, and an
adversarial architecture review. No provider resources have been created yet.
Every hosted step below still needs owner authorisation
([setup §6](setup.md#6-hosted-staging-and-production-owner-authorisation-checklist)).

## Decision: Vercel + Supabase, Cloudflare for DNS (Option C)

| Layer                | Choice                                                                                      | Why                                                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App (Next 16.4 Node) | **Vercel Pro**, region `lhr1` (`vercel.json`)                                               | Runs the app unchanged. Pro because the app is commercial (Hobby is non-commercial only), hourly cleanup cron (Hobby: daily only) and 2–4 GB functions.                    |
| DB, Auth, media      | **Supabase Pro**, `eu-west-2`, separate staging and production projects                     | The existing RLS, storage policies, magic-link auth and TUS uploads depend on it. Free caps uploads at 50 MB (videos are 200 MiB), pauses after a week and has no backups. |
| DNS                  | **Cloudflare Free**, records **DNS-only** (grey cloud)                                      | Proxying in front of Vercel would mean two CDNs and certificate conflicts. Vercel Firewall covers app traffic.                                                             |
| Bot protection       | **Turnstile** via Supabase Auth CAPTCHA (free)                                              | Closes the magic-link abuse gap (`app/login/actions.ts` has no rate limiting of its own). Needs a small code change: pass `captchaToken`.                                  |
| Auth email           | **Resend Free** as Supabase custom SMTP                                                     | 3,000 emails/month and 100/day are enough for ≤100 staff. Supabase's built-in SMTP is not for production.                                                                  |
| Media backup         | **Cloudflare R2** (free tier)                                                               | Supabase backups hold object _metadata_ only ([backup-restore](backup-restore.md)). A scheduled export to R2 is the one place Cloudflare adds real value.                  |
| CI/CD                | GitHub `lapeninns/nabalens` (private), Actions `CI result` required, Vercel Git integration | Previews come from PRs and use staging keys only; production deploys from `main`.                                                                                          |

### Why not Cloudflare-first (Options A/B)

- `sharp` is a native libvips addon (`lib/media/index.ts`). The HEIC decoder runs in a
  `node:worker_threads` worker (`lib/media/heic.ts`), which is a non-functional stub
  in workerd. Each decode needs about 300 MiB, far above a Worker isolate's memory.
  Workers would mean rewriting the media pipeline.
- Moving primary media to R2 would replace the Postgres-enforced storage policies with
  app code, and TUS with S3 multipart. At MVP volume it saves nothing ($45.00 vs
  $45.60). Revisit when egress nears the 250 GB Pro quota (see costs).
- Cloudflare Containers could host the Node app, but that means building and running
  your own preview and deploy pipeline. The credits expire after about a year.

### Cloudflare startup benefits

The Wrangler OAuth token on this Mac has `account (read)` and `zone (read)` but no
billing scope, so **the plan, credit balance and expiry could not be read**. Check
them in the dashboard under Billing. Cloudflare for Startups credits apply only to
Cloudflare products (Workers, R2 and so on), not to Vercel or Supabase. Under this
architecture they would cover R2 at most, which costs under $1/month at MVP volume.
The design does not depend on the credits, so nothing breaks when they expire.

## Monthly cost (USD, before tax, checked 30 Oct 2026)

The base is Vercel Pro $20 (1 seat, includes $20 of usage) + Supabase Pro $25
(includes $10 of compute) + Cloudflare Free + Resend Free = **$45**. Staging Supabase
Pro adds about **$10** of Micro compute. Media bytes never pass through Vercel, because
uploads and downloads use signed URLs.

| Scenario | Media stored / egress | Media in Supabase                | Media in R2 |
| -------- | --------------------- | -------------------------------- | ----------- |
| MVP      | 50 GB / 100 GB        | **$55**                          | $55.60      |
| Growth   | 250 GB / 500 GB       | $80.70 (cached egress: $65.70)   | $58.60      |
| High     | 1 TB / 2 TB           | $231.67 (cached egress: $126.67) | $69.85      |

Each figure includes about $10 for staging. Supabase overage is $0.0213/GB-month
storage and $0.09/GB uncached egress. R2 is $0.015/GB-month with free egress.

**Spending controls:**

- Keep the Supabase spend cap **on**. Over quota, the project is restricted rather
  than billed.
- Set the Vercel on-demand budget to $50–100 with a hard pause.
- Move media to R2 before egress reaches about 250 GB/month.

**Unverified:** actual Vercel function usage against the $20 credit, and R2 operation
counts.

## Code changes made for this target (`feat/nl-golive-prep`)

- `maxAvatarBytes` lowered from 5 MiB to **4 MiB**. Avatars are the one upload that
  passes through a function, and Vercel rejects request bodies over 4.5 MB with its
  own 413.
- `export const maxDuration = 120` added on `app/staff/page.tsx` (finalise) and both
  avatar handlers.
- `vercel.json`: region `lhr1`, plus an hourly cron on `/api/internal/cleanup`. Set
  `CLEANUP_SECRET` equal to Vercel's `CRON_SECRET`, in Production only.
- The cleanup route now returns 500 when any removal failed, and logs counts only.

Turbopack already traces the HEIC worker, libheif WASM and sharp binaries into the
function output (checked in `.nft.json` and by an isolated decode test). No
`outputFileTracingIncludes` is needed unless the build switches to webpack.

## Open items before go-live

| Item                                                                                                                            | Owner input needed        |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Create `lapeninns/nabalens` (private), push, and land `feat/nabalens-menus` (280 commits, not on `main`) and this branch via PR | yes (repo creation)       |
| Supabase Pro: staging and production projects, migrations, Auth, SMTP, CAPTCHA                                                  | yes (billing, org choice) |
| Vercel project on the `lapen-inns-projects` team (confirm it is on Pro), env vars                                               | yes (billing, secrets)    |
| Production domain and DNS record in Cloudflare                                                                                  | yes (which hostname)      |
| Ten confirmed venues (`supabase/seed/venues.json` is `[]`) and the first admin's email                                          | yes (data)                |
| Verify on staging that `security_hardening.sql`'s `storage.objects` trigger applies (table owned by `supabase_storage_admin`)   | no                        |
| Turnstile `captchaToken` wiring; R2 media export job                                                                            | no (code)                 |
| Real-phone HEIC and video evidence; restore rehearsal ([release checklist](release-checklist.md))                               | tester                    |

## Staging environment (created 30 Oct 2026)

| Piece      | Value                                                                                                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App        | Vercel project `nabalens-staging` (team `lapen-inns-projects`), <https://nabalens-staging-lapen-inns-projects.vercel.app>, functions in `lhr1`, behind Vercel Authentication (Deployment Protection)                |
| Supabase   | `nabalens-staging`, ref `kpdzufznpaaqxoahyrsw`, eu-west-2, Micro, in "lapeninns's Org". DB password is in the operator's macOS Keychain (`supabase-db-password-nabalens-staging`)                                   |
| Migrations | All 8 applied with `supabase db push` (no seed). RLS on all 14 public tables. Buckets private (`media` 200 MiB, `avatars` 5 MiB WebP)                                                                               |
| Auth       | Sign-ups off, anonymous/phone off, NabaLens templates, site URL and `/auth/callback` allowlist for both staging aliases. **Still on Supabase's built-in SMTP**: email only reaches org team members, a few per hour |
| Env        | The five `.env.example` variables plus `CRON_SECRET` (= `CLEANUP_SECRET`), Production target only                                                                                                                   |
| Deploys    | `vercel deploy --prod` from a clean `git archive HEAD` copy, so local `.env.local` and `.next` are never uploaded. There is no Git integration yet                                                                  |

`supabase config push` applies without waiting for confirmation when stdin is not a
TTY. To review the diff, use `supabase config diff` and do not pipe answers into
push. Push Auth settings from a scratch copy of `supabase/` with staging URLs, never
the local `127.0.0.1` values.
