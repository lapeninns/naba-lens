# Handoff: fix-privacy (`feat/nl-fix-privacy`, base `feat/nabalens-mvp` @ 874c844)

## Goal

The privacy runtime suite failed in setup (`privacy-runtime.test.ts:171`) because
it expected `/auth/confirm` to answer 303. Since auth-edges, `/auth/confirm` is an
interstitial page (200) whose Continue form POSTs to `/auth/confirm/verify`
(303 + session cookie).

## Done

- `signInOverHttp` follows the real flow (as `tests/e2e/helpers/email-link.ts`):
  GET the interstitial (200, no session cookie), parse its Continue form's hidden
  fields from the HTML, POST them to `/auth/confirm/verify` same-origin (303 to
  `/`, session cookie set).
- Before the real POST, the same unspent token is POSTed cross-origin three ways
  (`Sec-Fetch-Site: cross-site`; foreign `Origin` without Sec-Fetch-Site;
  `Origin: null`) from the anonymous jar.
- New test "signs in through the email-link interstitial without caching or
  echoing the token": interstitial is `no-store`, never public/s-maxage, sets no
  `sb-*-auth-token` cookie, has `referrer same-origin` and `noindex, nofollow`
  meta; verify sets the session with `private` and `no-store`, Location `/`, and
  the token hash appears in no header or body; the 9 cross-origin POSTs are 403,
  no Location, no session cookie, no token echo; the token still signs in after
  them (refusal does not spend it).
- All existing checks (shared caching, Vary, nosniff, log scan for token_hash)
  now also cover the interstitial and verify responses, since they are recorded.
- No app code changed; only `tests/integration/privacy-runtime.test.ts`.

## Results (real)

- `E2E_PORT=3491 node scripts/ci/privacy-runtime.mjs /tmp/nl-fix-privacy`:
  `Tests 12 passed (12)` → `privacy-runtime: 12 passed, 0 failed, 0 skipped: PASS`
- `pnpm typecheck`: clean. `pnpm lint`: 0 errors, 3 pre-existing warnings in
  `scripts/db/lib/drill.ts`. `pnpm test`: 21 files, 153 passed. `pnpm build`: ok.

## How to run my stack

```sh
W=/tmp/nl-fix-privacy; mkdir -p $W
E2E_PORT=3491 node scripts/ci/prepare-stack.mjs $W   # random 58000-63900 block; this run got 603xx
supabase --workdir $W start && supabase --workdir $W db reset
supabase --workdir $W status -o json > $W/status.json
E2E_PORT=3491 node scripts/ci/privacy-runtime.mjs $W
supabase --workdir $W stop --no-backup
```

The stack is stopped. Note `prepare-stack.mjs` picks a random base; rerun it if
it lands on a block another worktree uses (583xx etc.).

## Open questions

None.
