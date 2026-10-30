# Setup

This guide describes the checked-in implementation, not a deployed service. See [release checklist](release-checklist.md).

## Local development

Use Node 24, pnpm, Docker and Supabase CLI. Run `pnpm install --frozen-lockfile`. If pnpm reports ignored esbuild builds, resolve the build approval through the repository dependency policy before calling installation successful; do not commit pnpm's placeholder approval entry.

On a shared Mac, inspect `docker ps` before starting anything. Never start this worktree with the default `nabalens` project or reset another stack. Copy `supabase/` into a temporary workdir, assign a unique `project_id` and unused port block in that copy's `supabase/config.toml`, and disable studio, realtime, analytics and edge_runtime there. Preserve template paths. Then run `supabase --workdir <temporary-directory> start` and `supabase --workdir <temporary-directory> db reset` only against that owned stack. Reset destroys its local data. Stop only this stack with `supabase --workdir <temporary-directory> stop` when finished. The security prepare script uses fixed ports too; it is not automatically collision-free.

Create your own ignored `.env.local` with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `NEXT_PUBLIC_SITE_URL`. Obtain keys from your owned stack; never commit or print them in reports. Match the site URL and callback allowlist in the temporary config to your chosen unused app port. Run `pnpm dev --port <port>`. Local emails appear in that stack's Mailpit. The local seed contains explicitly labelled DEV FIXTURE identities; never apply it to production.

Required local checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`. Integration/browser suites require an appropriately isolated stack; see README and the security/lifecycle guides.

## Production checklist

Every item below is **NOT DONE — requires owner authorisation**. These are operator instructions, not permission to execute provider writes.

- **Supabase project:** create the approved production project and select region/plan; verify storage, request and compute allowances.
- **Auth redirects:** set Site URL to the final HTTPS origin, allow its exact `/auth/callback` URL, and verify `/auth/confirm` token-hash links. Match `NEXT_PUBLIC_SITE_URL` to that origin.
- **Disable sign-ups:** turn off public account creation and anonymous sign-in; keep the Email provider enabled. Local `[auth] enable_signup = false` differs from `[auth.email] enable_signup = true`, which enables that provider. The login action uses `shouldCreateUser: false`.
- **Email templates:** install `supabase/templates/magic_link.html` and `invite.html` in their corresponding template slots. Preserve the `/auth/confirm?token_hash={{ .TokenHash }}` link and each template's type value; test delivery and expired-link recovery.
- **SMTP:** configure an approved sender/provider such as Resend in Supabase Auth, verify its sender domain and delivery. No Resend application environment variable exists; SMTP belongs to Auth configuration.
- **Migrations:** apply reviewed files in `supabase/migrations/` in order using an approved production migration procedure. Never run the local fixture reset in production.
- **Private buckets:** verify migrated `media` and `avatars` are private, with RLS intact. Product input limits in `lib/config/media.ts` are 20 MiB photos, 200 MiB videos and 5 MiB avatars. Confirm project/plan and bucket caps permit these values; an application setting cannot override a provider cap.
- **Server secrets:** configure `SUPABASE_SERVICE_ROLE_KEY` and a server-only `CLEANUP_SECRET` of at least 32 characters. Configure the two public Supabase variables and public site URL above. Never expose the service role or cleanup secret under a `NEXT_PUBLIC_` name. Scripts accept `SUPABASE_URL` as an alternative URL; the web app uses `NEXT_PUBLIC_SUPABASE_URL`.
- **First admin:** invite the approved person through Supabase Auth first. With the target URL and service role in a trusted operator shell, run `pnpm bootstrap:admin --email <approved-email> --name "Approved Name"`. The script refuses a missing auth user; it creates a profile or promotes/reactivates an existing one. Confirm the intended identity and admin access. Additional admins use this same controlled procedure.
- **Venues:** obtain the owner's ten confirmed venues in `supabase/seed/venues.json`, with name and unique lowercase hyphenated slug (optional active boolean). Run `pnpm seed:venues --file <approved-file>` with the authorised environment. This upserts by slug without deleting; an empty file seeds nothing.
- **Cleanup scheduling:** schedule an authenticated POST to `/api/internal/cleanup` or trusted `pnpm cleanup` hourly; verify the report and alerting. See [cleanup](cleanup.md). Vercel Cron's GET does not match the current POST-only endpoint.
- **Hosting:** validate Node runtime, native sharp binaries, HEIC worker trace, memory, timeouts and real 200 MiB transfers on the deployment platform.
- **Backups:** approve database and private-object backup schedules, retention, access and restore procedures. A database backup alone does not establish object recovery. Rehearse restoration in an isolated environment and record evidence.
