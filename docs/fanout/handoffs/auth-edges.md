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

## Review finding #8 (wave 3): `/auth/confirm` used the token on GET (fixed)
- `app/auth/confirm/route.ts` is replaced by `app/auth/confirm/page.tsx`: GET only
  renders "Sign in to NabaLens" / "Accept your invitation" with a Continue form
  (no token use, `noindex`, `Referrer-Policy: same-origin`). Bad params redirect
  to `/login?error=link_invalid`.
- `app/auth/confirm/verify/route.ts` (POST only) verifies the token. It refuses
  cross-site posts via `Sec-Fetch-Site`, falling back to Origin vs Host
  (`Origin: null` refused). Expired, used and malformed links go to the login
  recovery state.
- Parser shared in `lib/auth/email-link.ts`. Email template URLs are unchanged.
- A first version used `referrer: "no-referrer"`. Real browsers then send
  `Origin: null` on the form POST, so the check refused real sign-ins; only e2e
  caught it. The policy is now `same-origin`.
- Tests: `auth-links` "email link scanners" (repeated GETs by a scanner leave
  the link usable, invite variant, four cross-site header cases, metadata);
  `tests/integration/auth-confirm.ts` makes every suite open links the way a
  person does (GET page, submit its form).
- Out-of-track edits: e2e helpers click Continue (`tests/e2e/auth.spec.ts`,
  `slice.spec.ts`, `staff-accounts.spec.ts`); `docs/architecture.md` and
  `docs/accounts.md` describe the Continue step.

## Privacy audit R3 (staff got 200 on admin pages), fixed
- **Cause:** `app/admin/loading.tsx` and `app/staff/loading.tsx` put each page in
  a Suspense boundary, so Next flushed the shell with 200 before the page's
  `requireActiveAdmin()`/`requireActiveStaff()` redirect; that redirect then
  became a client-side meta redirect (Next 16 `redirect()` docs, streaming).
- **Fix:** `app/admin/layout.tsx` and `app/staff/layout.tsx` run the same check
  outside that boundary, so the response is a real 307 before any HTML. Pages,
  Server Functions and routes keep their own checks (layouts do not re-render on
  client navigation). `proxy.ts` stays optimistic (session only), as Next advises.
- **Tests:** `tests/e2e/auth-guards.spec.ts` (raw HTTP, no redirect following):
  staff → every admin page 307 `/staff`; admin → `/staff` 307 `/admin`;
  no-profile and deactivated → 307 `/auth/blocked`; signed out → 307 `/login`;
  bodies contain no app shell, skeleton, upload action or other people's names
  or emails. 3 of 4 fail with 200 when the layouts are removed. Integration:
  layouts redirect/allow per role (`auth-access`). Also checked under
  `next start`: staff `/admin` 307 → `/staff`.
- `feat/nl-gaps` is already in this branch (via `feat/nabalens-mvp`). Its
  `tests/e2e/gaps.spec.ts` GAP-11 HTTP test accepted a 200 with an in-body
  redirect; it now requires 307 → `/staff` and no skeleton (fails with 200
  when `app/admin/layout.tsx` is removed). `tests/integration/gaps-http.test.ts`
  has no page-status assertion, so nothing to tighten there.
- Next's redirect shell still carries the route's static `<title>` (e.g.
  "Content · NabaLens"); a fixed string, also in the JS bundle, not data.

## Mobile staff-accounts flake (acceptance-map report), fixed
- **Symptom:** after Deactivate on `/admin/staff/[id]`, the toast said
  "deactivated" but the header kept "Active" and the Deactivate button for 30 s+.
- **Root cause:** the header's status and buttons came only from server props,
  which update only when the action's in-roundtrip re-render of the page
  arrives. The action's result (and so the toast) resolves before that streamed
  re-render. The re-render re-reads Auth (`getUserById`), the portfolio,
  signed URLs and venues, and under load GoTrue alone took 10 s+ per call.
  Nothing mobile-specific: mobile ran when the machine was busiest. Reproduced by
  delaying that re-render 40 s (temporary, uncommitted): the toast assertion
  passed and the header assertion timed out, exactly as reported.
- **Fix:** `setStaffActive` / the action return the new `status` (`inactive`;
  reactivation gives `active` or `invited` from the unbanned user's last
  sign-in). `useAccountControls().withConfirmedStatus` shows it for that member
  while the page still holds the same props object, then fresh props win; it also
  calls `router.refresh()`. Used by `AccountHeader` and the staff directory.
- **Guards:** `tests/ui/account-header.test.tsx` (props never change; 3 of 4
  fail with the fix disabled); the e2e checks the header within 5 s (Inactive,
  Reactivate, no Active/Deactivate), and passed with the 40 s delay in place;
  integration checks the returned status.
- **Merged `feat/nabalens-mvp` (a964290) into this branch** to fix the real
  integrated code. Follow-ups from the merge: `loadMorePortfolioAction` usage in
  auth-access → `loadLibraryPage({ staff })`; Continue click in
  `tests/e2e/gaps.spec.ts` and `tests/library/e2e.ts`; `/auth/confirm` page +
  `/auth/confirm/verify` in `tests/unit/scope-guard.test.ts`; exact
  `{ ok: true }` results in `tests/integration/staff-accounts.test.ts`.
- **Not mine, still failing on `feat/nabalens-mvp`:**
  `tests/integration/gaps-profile-origin.test.ts` "/api/profile refuses a
  cross-origin POST" — the GAP-11 test is merged but `/api/profile` has no
  Origin check yet (review finding #7); a cross-origin POST renames the profile.

Results after this fix (isolated stack, load ~4-13): `pnpm test` 16 files / 128
passed; `pnpm test:integration` 171 passed, 1 failed (the GAP-11 test above),
11 skipped; `pnpm test:e2e` 31 passed, 1 skipped; mobile staff-accounts spec 3/3;
typecheck, lint, build pass.

## Results after finding #8 (isolated stack, 586xx, load ~18)
`pnpm test:integration` 12 files / 138 passed (all-green, incl. auth-bootstrap
5/5); `pnpm test:e2e` (E2E_PORT=3586) 18 passed; `pnpm test` 102 passed;
typecheck, lint, build pass.

## Earlier results (load average 28-39)
| Suite | Result |
| --- | --- |
| auth-links | 10/10 in one run |
| auth-access | 17/17 in one run |
| auth-invites | 11/12 in one run; the 12th (orphan adoption) passed alone |
| auth-internal | 6/6 |
| auth-bootstrap | 4/5 in two runs, a different test timing out each time; every test passed at least once |
| full `pnpm test:integration` | baseline 84/84 at start; the final full run failed across old and new files with GoTrue 504s / "Database connection error" (machine load), no assertion failures from behaviour |

GoTrue on a cold connection pool needed >10 s (Docker DNS timeouts), so warm it
before a run: `bash /tmp/authedge-warm.sh` (6 `GET /auth/v1/admin/users?per_page=1`).

## Next
- Re-run `pnpm test:integration` on a quiet machine (or the default stack) to get
  one all-green run including auth-bootstrap.
- Lifecycle suite (`pnpm test:lifecycle`) not re-run after the one-line edit.

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
