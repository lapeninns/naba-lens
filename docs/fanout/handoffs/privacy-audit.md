# Handoff: privacy-audit

Branch `feat/nl-privacy` from `feat/nabalens-mvp` @ 3a23c9b. Status: **done**. The full
report is `docs/privacy-audit.md`.

## Done

- `scripts/ci/scan-bundle.mjs` scans client chunks, prerenders and `public/` for secrets and
  server-only code. Exit 1 on findings, 2 with no build. Result: no findings.
- `tests/integration/privacy-bundle.test.ts` is the scanner's self-test (3 tests).
- `tests/integration/privacy-runtime.test.ts` (11 tests) drives the real journey over HTTP
  against `next start` on an isolated stack. It checks the headers, bodies and server log of 127
  responses as anon, staff A, staff B and admin. It is skipped without `PRIVACY_BASE_URL`.
- Fixes, both outside the owned paths and both tiny:
  - `next.config.ts` adds global `X-Content-Type-Options: nosniff`.
  - `app/auth/redirect.ts` sends `Cache-Control: private, no-store` on the session-setting
    303s.
- Reported, not fixed: R1–R8 in `docs/privacy-audit.md`. The main one is R1, the admin staff
  pages embedding signed storage URLs (accounts track).

## How to run the stack

`docs/privacy-audit.md` → "Runtime suite: how to run". This audit used workdir
`/tmp/nabalens-privacy-stack` (project `nabalens-privacy`, ports 597xx; studio, realtime,
analytics and edge_runtime off). The temp copy has `email_sent = 100`. The stack was stopped at
the end.

## Open questions

- Should R1 (signed URLs in the admin staff portfolio and directory) switch to `mediaRoutes` and
  `avatarUrl`? That belongs to the accounts track or the integrator.
- Check the hosted Supabase/CDN headers for signed URLs at M6 (R2).
