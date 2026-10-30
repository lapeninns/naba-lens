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

## In progress / next
- auth-access: inactive admin with valid session; no profile; staff without
  usable venue; inactive venue; profile reads (PostgREST, GraphQL, routes).
- auth-invites: duplicate, resend, provider failure → recovery, admin email
  refused; admin self-lockout.
- auth-bootstrap: CLI end to end.
- cleanup GET (lifecycle never added one).

## Open questions
- None yet.
