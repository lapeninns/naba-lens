# NabaLens

A private staff portfolio and marketing media library for one group of venues.
Staff upload photos and videos to their own portfolio; admins see every ready
asset in one library and download originals. Two roles only: `staff` and `admin`.

- Product spec: `docs/spec/NabaLens-MVP-Execution-v0.2.md`
- Architecture, paths, security model: `docs/architecture.md`
- Parallel-build contract: `docs/fanout/CONTRACT.md`

Stack: Next.js 16.4 (App Router, `proxy.ts`), React 19, Tailwind 4 + shadcn/Base UI,
Supabase Auth/Postgres/Storage via `@supabase/ssr`. Package manager: pnpm.

## Local setup

Requirements: Node 24, pnpm 10, Docker, Supabase CLI 2.x.

```bash
pnpm install --frozen-lockfile
pnpm db:start          # supabase start: local stack on ports 554xx
pnpm db:reset          # apply migrations + DEV FIXTURE seed (supabase/seed.sql)
supabase status        # shows API URL, publishable/anon key, service role key
```

Create `.env.local` (git-ignored) with the variable names from `.env.example`, filled
with the values `supabase status` prints:

| Variable                               | Local value                                    |
| -------------------------------------- | ---------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | `API_URL` (http://127.0.0.1:55421)             |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `PUBLISHABLE_KEY` (or `ANON_KEY`)              |
| `SUPABASE_SERVICE_ROLE_KEY`            | `SERVICE_ROLE_KEY`; server only, never shipped |
| `NEXT_PUBLIC_SITE_URL`                 | `http://127.0.0.1:3000`                        |

Then `pnpm dev` and open http://127.0.0.1:3000 (use `127.0.0.1`, which matches the
auth Site URL in `supabase/config.toml`).

### Signing in locally

Accounts are invite-only and sign-in is by magic link. The DEV FIXTURE seed creates
these local-only accounts (no passwords):

| Email                              | Role / state               |
| ---------------------------------- | -------------------------- |
| `dev-admin@nabalens.test`          | admin                      |
| `dev-staff-a@nabalens.test`        | staff, DEV FIXTURE Venue A |
| `dev-staff-b@nabalens.test`        | staff, DEV FIXTURE Venue A |
| `dev-staff-inactive@nabalens.test` | staff, deactivated         |

Enter one on `/login` and open the link from the local inbox (Mailpit) at
http://127.0.0.1:55424. Unknown emails get the same "Check your email" response and
no account is created.

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm test               # unit tests, no services needed
pnpm test:integration   # RLS/storage/auth tests against the LOCAL stack (separate identities)
pnpm test:e2e           # Playwright, starts next dev on :3417 (override with E2E_PORT); needs the local stack
pnpm build
```

Integration and e2e tests read connection details from `supabase status`, so they
don't need `.env.local`, and they refuse to run against a non-localhost Supabase URL.
They leave `TEST …` users and venues behind; `pnpm db:reset` clears them. After
changing migrations, run `pnpm db:reset` and then `pnpm db:types`.

## Venues

Real venue names must be confirmed by the owner. Put them in
`supabase/seed/venues.json` (see `supabase/seed/README.md`) and load them with
`pnpm seed:venues`, which upserts by slug and never deletes. The `DEV FIXTURE` venues
in `supabase/seed.sql` are for local development only.

## First admin

No one becomes an admin by signing up. To create the first admin (and later admins in
this MVP):

1. In the Supabase dashboard for the target environment, invite the person
   (Authentication → Users → Invite user), so an auth user exists. Locally, a seeded
   user or any existing auth user works.
2. With that environment's URL and service role key in your shell environment, run:

   ```bash
   pnpm bootstrap:admin --email owner@example.com --name "Their Name"
   # or, reading a local env file:
   pnpm exec tsx --env-file=.env.local scripts/bootstrap-admin.ts --email owner@example.com --name "Their Name"
   ```

   It looks the user up by email. If they have no profile it creates an active admin
   profile (`--name` required); otherwise it promotes and activates the existing
   profile. Running it again changes nothing. It never creates auth users. Run it
   only from a trusted operator machine: the service role key bypasses RLS.

## Hosted environments (not configured yet)

There is no hosted project. Before staging, set up the following: run the migrations,
use the same email templates (`supabase/templates/*.html`) and Site URL/redirect URLs,
configure SMTP, keep sign-ups disabled, confirm bucket limits for your plan, load the
confirmed venues, and bootstrap the first admin. See `docs/architecture.md` §6–7 for
the cleanup job and the auth details.
