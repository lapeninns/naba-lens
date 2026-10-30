# Handoff: gap-tests (branch feat/nl-gaps)

## Goal
Tests (no app fixes) for acceptance gaps GAP-11, GAP-12, GAP-16, GAP-19 and the
admin library refresh-on-focus, per `git show feat/nl-acceptance:docs/acceptance.md`.

## Files (owned)
- `tests/unit/scope-guard.test.ts` — GAP-16 route allow-list + forbidden-feature grep.
- `tests/integration/gaps-http.test.ts` — GAP-11/GAP-12 against the real Route
  Handlers and Server Functions (`next/headers` mocked with genuine @supabase/ssr
  session cookies; `server-only` mocked).
- `tests/integration/gaps-support.ts` — helpers (cookie jar, uploadAs, header check).
- `tests/e2e/gaps.spec.ts` — GAP-19 leave guard, library focus refresh, GAP-12 UI,
  GAP-11 over real HTTP.

## Status
- [x] scope guard green
- [ ] integration run (see below)
- [ ] e2e run (workers=1, record `uptime`)

## How to run the isolated stack
```sh
W=/tmp/nabalens-gaps-stack
node tests/security/prepare-stack.mjs $W
C=$W/supabase/config.toml
sed -i '' -E -e 's/^project_id = .*/project_id = "nabalens-gaps"/' \
  -e 's/^([[:space:]]*([a-z]+_)?port = )564([0-9][0-9])$/\1624\3/' $C
# set enabled = false under [studio] [realtime] [analytics] [edge_runtime] [storage.vector]
supabase --workdir $W start
eval "$(supabase --workdir $W status -o env | sed -n 's/^API_URL=/export NEXT_PUBLIC_SUPABASE_URL=/p; s/^ANON_KEY=/export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=/p; s/^SERVICE_ROLE_KEY=/export SUPABASE_SERVICE_ROLE_KEY=/p')"
pnpm exec vitest run --project integration tests/integration/gaps-http.test.ts
E2E_PORT=3471 pnpm exec playwright test tests/e2e/gaps.spec.ts
supabase --workdir $W stop   # when finished
```

## Known BUG tests
- `/api/profile` accepts a cross-origin POST (no Origin check) — see `// BUG:` in gaps-http.test.ts.
