# Handoff: privacy-audit (WIP)

Branch `feat/nl-privacy` from `feat/nabalens-mvp` @ 3a23c9b.

## Goal
Bundle scan for server secrets, runtime cache/header/PII audit of every page and media
route as anon/staff/admin, server-log audit. Owned: `scripts/ci/scan-bundle.mjs`,
`tests/integration/privacy-*.test.ts`, `docs/privacy-audit.md`.

## Done
- `scripts/ci/scan-bundle.mjs`: passes on a build made with the isolated stack's env.

## In progress
- `tests/integration/privacy-runtime.test.ts` (HTTP matrix + log audit).

## Stack
Workdir `/tmp/nabalens-privacy-stack`, project `nabalens-privacy`, ports 597xx
(studio/realtime/analytics/edge_runtime disabled). Env in `/tmp/nabalens-privacy-env.sh`.
`next start` on :3597 logging to `/tmp/nabalens-privacy-server.log`.
Stop: `supabase --workdir /tmp/nabalens-privacy-stack stop`.
