# fix-review (final review F4–F11)

Branch `feat/nl-fix-review`, based on `feat/nabalens-mvp` @ 2471677.
Review: `git show review/nl-final:docs/reviews/final-review.md`.

## Status

Done. All fixes committed with regression tests; every check below is green.
The isolated stack is stopped.

## Done (one regression test each; each new test was seen failing without its fix unless noted)

- F4 `app/error.tsx` (+ `app/global-error.tsx`): a failed profile read in the
  /admin or /staff layout gate shows "This page could not load / Try again"
  instead of Next's bare 500. Admin/staff `error.tsx` now call `retry()` (Next
  16.3+: re-fetches) instead of `reset()` (re-renders without re-fetching).
  Test: `tests/e2e/profile-outage.spec.ts` (revokes SELECT on profiles from
  `authenticated` → 42501, restores in `finally`; one Playwright worker).
  Negative control: with neither boundary it fails; `app/error.tsx` alone passes.
- F5 gallery refresh is an abortable GET: `app/api/portfolio` (staff) and
  `app/api/library` (admin, same filters), via `app/api/_media-page.ts` (same
  `getMediaActor` checks, same-origin check, `PRIVATE_HEADERS` no-store) and
  `app/_media/fetch-page.ts`. `MediaGallery` takes `refreshPage(signal)`; at
  10 s it aborts. Without `refreshPage` it falls back to `loadPage(null)` and
  keeps the guard until that call settles (no pile-up). Load-more stays on the
  Server Functions. Tests: `tests/ui/library-gallery.test.tsx` (abort + no
  pile-up), `tests/integration/gaps-http.test.ts` "gallery refresh routes",
  `tests/e2e/refresh-hang.spec.ts` (upload completes while the refresh hangs;
  browser cancels it at 10 s). Scope guard allow-list updated.
- F6 `getMediaActor` logs `[media] account check failed` with
  `lib/server/log/redact.ts` (`redactError`: URLs, emails, JWTs, long opaque
  strings removed). Test: `tests/unit/media-actor-unavailable.test.ts`.
- F7 `/auth/confirm/verify` uses `isSameOriginRequest`. Test:
  `tests/unit/confirm-verify-origin.test.ts`.
- F8 `listAuthUsers` stops paging once the caller stops waiting. Test:
  `tests/unit/auth-users-deadline.test.ts` (11 pages → ≤3 before the fix).
- F9 one `router.refresh()` per account edit; `getAuthState` wrapped in React
  `cache()` (per render pass only; Server Functions/Route Handlers still read
  fresh, per the Next auth guide). Tests: `tests/ui/account-controls-refresh.test.tsx`,
  `tests/unit/auth-state-cache.test.ts` (real react-server `cache`).
- F10 `bootstrap:admin` lifts a stale Auth ban before the `already_admin`
  return; uses the lib `findAuthUserByEmail` (60 s deadline for the CLI).
  Test: `tests/integration/lifecycle.test.ts` "lifts a stale Auth ban".
- F11 `scripts/ci/privacy-runtime.mjs` fails fast if the port is taken, and
  fails if its `next start` child exits before or during the suite. Test:
  `tests/unit/privacy-runtime-probe.test.ts` (not run against the old script:
  it would start a full `next build`).

## Results (real, on the final head)

- `pnpm typecheck`: clean. `pnpm lint`: clean (0 problems).
- `pnpm test`: 26 files, 163 passed.
- `pnpm test:integration`: 19 files passed, 1 skipped; 206 passed, 12 skipped
  (privacy-runtime without a server, plus existing skips).
- `pnpm build`: ok; `/api/portfolio` and `/api/library` are dynamic (ƒ).
- Playwright chromium, `E2E_SKIP_BUILD=1`, isolated stack: profile-outage,
  refresh-hang, auth-guards, library, staff-accounts: 10 passed; slice, gaps,
  upload-recovery, journey, auth: 17 passed.
- `E2E_PORT=3497 node scripts/ci/privacy-runtime.mjs /tmp/nl-fix-review`:
  `privacy-runtime: 12 passed, 0 failed, 0 skipped: PASS`.
- `pnpm test:security /tmp/nl-fix-review`: 153 passed.
  `pnpm test:lifecycle /tmp/nl-fix-review`: 23 passed.
- Not run: firefox/webkit/mobile e2e projects, `pnpm test:visual` (a11y track
  owns it), `lci` (runs once on the integrated head).

## Notes for the integrator

- Outside slice paths only where needed: `app/error.tsx`, `app/global-error.tsx`
  (root), `lib/server/log/redact.ts` (new), `tests/unit/scope-guard.test.ts`
  allow-list (two new routes). Nothing under `components/nabalens/**` or
  `tests/visual/**`.
- `app/staff/staff-portfolio.tsx` and `app/admin/admin-library.tsx` gained a
  `refreshPage` prop; small, but a11y may touch them too.

## How to run my stack

```sh
W=/tmp/nl-fix-review; mkdir -p $W
E2E_PORT=3497 node scripts/ci/prepare-stack.mjs $W   # got 618xx
supabase --workdir $W start -x vector,logflare,supavisor,imgproxy
supabase --workdir $W status -o json > $W/status.json
. $W/env.sh   # exports the stack's URL/keys, SUPABASE_DB_URL, SUPABASE_JWT_SECRET
E2E_SUPABASE_WORKDIR=$W E2E_PORT=3497 pnpm exec playwright test <specs> --project chromium
supabase --workdir $W stop --no-backup
```

## Open questions

None.
