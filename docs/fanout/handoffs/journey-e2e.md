# Handoff: journey-e2e (branch `feat/nl-journey`, base `feat/nabalens-mvp` @ 078b60a)

## Goal
Release-critical Playwright E2E against `next build && next start` + an isolated local
Supabase stack, real Mailpit links; viewport/axe/keyboard checks; `docs/qa-report.md`.

## How to run
```sh
W=$(node tests/e2e/prepare-stack.mjs /tmp/nabalens-journey-stack)   # 583xx, studio/realtime/analytics/edge off
(cd /tmp && supabase --workdir "$W" start)
E2E_SUPABASE_WORKDIR="$W" pnpm exec playwright test --project=chromium          # builds first
E2E_SKIP_BUILD=1 E2E_SUPABASE_WORKDIR="$W" pnpm exec playwright test --project=firefox --project=webkit --project=mobile-chromium
supabase --workdir "$W" stop
```
App port 3457 (`E2E_PORT`), stack block `E2E_PORT_BLOCK` (default 583). Firefox needs the
`MOZ_APP_DATA` override set in `playwright.config.ts` (macOS denies Playwright's build access
to `~/Library/Application Support/Firefox`).

## Done
- `playwright.config.ts`: isolated-stack env, prod build, projects chromium/firefox/webkit/mobile-chromium, retries 0, 1 worker.
- `tests/e2e/helpers/*`: SQL fixture provisioning (no GoTrue), Mailpit polling for a NEW message, synthetic JPEG/HEIC(sips)/HEVC(ffmpeg), upload-dialog status recorder.
- `journey.spec.ts` (@core): passed on chromium and webkit once.
- `negative.spec.ts`: written; first run blocked by auth-server stalls (below).

## Flakiness investigation (evidence, 2026-10-30 00:40)
- GoTrue 504 = its 10 s request deadline. Same call is ~30 ms when idle (12/12 at 22–39 ms).
- Docker VM (8 GB, 18 CPU) shared by 14 Supabase stacks: MemAvailable 365 MB, swap 100% used,
  memory PSI full avg60 = 63%, avg300 = 76%. Stalls hit auth, storage and kong alike.
- Not fixed by retries (none added). Mitigations in the suite: fixture users created by one SQL
  statement (seed.sql shape), workers 1, event-based waits.
- Isolated config raises per-IP `sign_in_sign_ups`/`token_verifications` to 300 (all test
  contexts share one IP). Committed `supabase/config.toml` unchanged.

## Known app defects found
- `/admin/staff/[id]` viewer has no Download/Delete (spec §3). Fixed on `feat/nl-library` f3ee17b;
  `negative.spec.ts` keeps a `test.fail()` that flips when that merges.

## Next steps
See the "In progress" list in the latest commit message / below.
