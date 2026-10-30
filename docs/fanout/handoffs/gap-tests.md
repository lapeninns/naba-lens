# Handoff: gap-tests (branch feat/nl-gaps)

## Goal

Tests only (no app fixes) for the acceptance gaps no other track covers, per
`git show feat/nl-acceptance:docs/acceptance.md`: GAP-11, GAP-12, GAP-16, GAP-19
and the admin library refresh on focus.

## Status: done

| Gap                                           | Test                                              | Result                                             |
| --------------------------------------------- | ------------------------------------------------- | -------------------------------------------------- |
| GAP-16                                        | `tests/unit/scope-guard.test.ts` (in `pnpm test`) | 10/10 pass                                         |
| GAP-11, GAP-12 (route level)                  | `tests/integration/gaps-http.test.ts`             | 16/16 pass                                         |
| GAP-11 Origin                                 | `tests/integration/gaps-profile-origin.test.ts`   | 1 pass (control), **1 FAIL = BUG**                 |
| GAP-19, focus refresh, GAP-12 UI, GAP-11 HTTP | `tests/e2e/gaps.spec.ts`                          | 7 pass, 1 skipped (HTTP test runs on desktop only) |

`tests/integration/gaps-support.ts` holds the helpers: session cookies made by
`@supabase/ssr` for a real signed-in identity (the test mocks `next/headers` with
them), `uploadAs` (real reserve → storage → finalise), the private-caching check,
and `setupIdentity`/`setupSession`, which retry fixture setup only when the
local auth server returns 504. Each retry is logged with `[gaps]`.

## BUG found (failing test kept, not skipped)

`app/api/profile/route.ts` has no same-origin check. A POST with
`Origin: https://attacker.example` and a valid staff session returns 200 and
renames the caller. `app/admin/staff/[id]/avatar/route.ts` refuses the same
request with 403 (the control test). This is review finding 7 (LOW). SameSite=Lax
cookies limit it in browsers. Fix it by adding the avatar route's Origin check to
`/api/profile`. The test is in commit 5b1d298.

## Mutation checks (run once, app changes reverted, not committed)

With both beforeunload guards and the gallery's focus/visibility listeners
disabled, the GAP-19 test and the focus-refresh test both failed at the expected
assertions. With the code restored, both pass.

## How to run (isolated stack `nabalens-gaps`, ports 624xx)

```sh
W=/tmp/nabalens-gaps-stack
node tests/security/prepare-stack.mjs $W
C=$W/supabase/config.toml
sed -i '' -E -e 's/^project_id = .*/project_id = "nabalens-gaps"/' \
  -e 's/^([[:space:]]*([a-z]+_)?port = )564([0-9][0-9])$/\1624\3/' $C
# then set `enabled = false` under [studio] [realtime] [analytics] [edge_runtime] [storage.vector]
supabase --workdir $W start
# export NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY /
# SUPABASE_SERVICE_ROLE_KEY from `supabase --workdir $W status -o json`
# (API_URL, ANON_KEY, SERVICE_ROLE_KEY)
pnpm exec vitest run --project integration tests/integration/gaps-http.test.ts tests/integration/gaps-profile-origin.test.ts
E2E_PORT=3471 pnpm exec playwright test tests/e2e/gaps.spec.ts --workers=1
supabase --workdir $W stop
```

## Notes for the next wave

- Staff GET `/admin/staff/{id}` returns **200**, not a 3xx. `app/admin/loading.tsx`
  starts streaming before `requireActiveAdmin()` redirects, so Next puts the
  redirect in the body. The test accepts either form and asserts that no staff A
  data is in the response, and that the browser lands on `/staff`.
- `/login` sends a signed-in user back to their home page, so the leave-guard
  test leaves the app through `about:blank`.
- `pnpm test:integration` against any stack now includes the deliberate BUG
  failure until `/api/profile` is fixed.
- Load during the e2e runs was 20–31 (1-minute average), with about 10 other
  Supabase stacks running.
