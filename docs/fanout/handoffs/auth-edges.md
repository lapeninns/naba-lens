# Handoff: auth-edges (`feat/nl-authedge`)

## Goal
Prompt §7 privilege, account lifecycle and invitations: prove the auth edge cases
with integration tests as real users (separate signed-in identities, real
Route Handlers / Server Functions / pages / proxy), and fix root causes.

## How the tests work
`tests/integration/auth-support.ts` (harness, not a test file): a `Browser` is a
cookie jar; `browser.run(fn)` makes the mocked `next/headers` `cookies()` read and
write it, so app code runs exactly as for one browser's request. Sessions come
from `/auth/confirm` with a real token hash. Time travel uses `psql` on the local
DB (`SUPABASE_DB_URL`, refused unless localhost). Expired access tokens are
re-signed with the local legacy HS256 secret (`SUPABASE_JWT_SECRET`), with a
control that the same token with a future `exp` is accepted.

Only one test sends a real `/otp` email: the stack allows 2 per hour
(`[auth.rate_limit] email_sent = 2`) plus 1 s per user. All other links come from
`auth.admin.generateLink` (same token_hash as the email template).

## How to run my stack
```sh
W=/tmp/nabalens-authedge-stack   # copy of supabase/ with project_id nabalens-authedge,
                                 # ports 586xx, studio + realtime disabled (uncommitted)
supabase --workdir $W start
source /tmp/nabalens-authedge-env.sh   # NEXT_PUBLIC_SUPABASE_URL, keys, MAILPIT_URL,
                                       # SUPABASE_DB_URL, SUPABASE_JWT_SECRET for 586xx
pnpm test:integration
supabase --workdir $W stop
```
Recreate the workdir: copy `supabase/` there, set `project_id = "nabalens-authedge"`,
replace `= 554xx` ports with `586xx`, set `[studio]`/`[realtime]` `enabled = false`.

## Done
- `tests/integration/auth-links.test.ts` (10 tests, green): real-email login,
  expired link, reused link (same/other browser, raw API), superseded link,
  malformed links/PKCE callback, uninvited email neutral, session expiry through
  proxy/pages/Server Functions/routes/PostgREST/Storage/Auth, per-browser logout.
- `tests/integration/auth-internal.test.ts`: cleanup endpoint POST + new GET
  (Vercel Cron), secret only; an admin session is not enough. Lifecycle never
  added GET, so it was added here; `tests/lifecycle/lifecycle.test.ts` had a
  `"GET" in route === false` assertion, replaced by a pointer (out-of-track edit).
- `tests/integration/auth-bootstrap.test.ts`: the real CLI. **Bug fixed** in
  `scripts/bootstrap-admin.ts` (foundation-owned): promoting an account that was
  deactivated in the app left its Auth ban, so the "active admin" could never sign
  in. It now lifts the ban before writing the profile.
- `tests/integration/auth-access.test.ts`: inactive admin with a live session;
  no-profile account; staff venue states; inactive venue; profile reads
  (PostgREST, GraphQL, Auth admin API, routes, Storage).
- `tests/integration/auth-invites.test.ts`: duplicate, resend, email/auth/DB
  provider failures then recovery (one auth user), admin emails refused, staff
  only; admin self-/peer-lockout.

## In progress / next
- Get green runs of access/invites/bootstrap: they were blocked by machine load
  (load avg ~30-39, 15 local stacks; GoTrue 504 "context deadline exceeded",
  Docker DNS timeouts, Postgres checkpoints taking 25 s). Not assertion failures.
- Then full `pnpm test:integration`, `pnpm test`, `pnpm build`; stop the stack.

## Notes for the integrator
- Account lookup by email (`findAuthUserByEmail` in invite, bootstrap) pages
  through GoTrue's admin list; with 62 users that took 0.5-4.5 s under load and
  sometimes hit GoTrue's 10 s deadline. Fine for one organisation, but an invite
  can fail with "Could not list auth users" on an overloaded host. Tests count
  auth users via SQL instead.
- `reserve_media_asset` returns an existing reservation for a repeated client key
  even after the venue was deactivated (slice's documented decision: the snapshot
  belongs to the first reservation). New reservations are refused. Left as is.
- A staff profile without a venue cannot exist (`profiles_staff_requires_venue`);
  the "no venue" setup message is therefore only reachable as "venue inactive".

## Open questions
- None blocking.
