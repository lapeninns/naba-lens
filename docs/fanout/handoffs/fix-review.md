# fix-review (final review F4–F11)

Branch `feat/nl-fix-review`, based on `feat/nabalens-mvp` @ 2471677.
Review: `git show review/nl-final:docs/reviews/final-review.md`.

## Status

In progress: all fixes committed with regression tests; full integration,
build, affected e2e and the privacy step still to run (see Next steps).

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

## Next steps

1. `pnpm test:integration` (full), `pnpm build`.
2. Affected e2e (chromium): auth-guards, library, slice, staff-accounts, gaps,
   upload-recovery, profile-outage, refresh-hang.
3. `E2E_PORT=3497 node scripts/ci/privacy-runtime.mjs /tmp/nl-fix-review`.
4. Stop the stack.

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
