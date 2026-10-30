# Handoff: journey-e2e (branch `feat/nl-journey`, base `feat/nabalens-mvp` @ 078b60a)

Status: **done**. The release-critical gate passed twice in a row with `retries: 0`
(19/19 each run). Full results and the defect list are in `docs/qa-report.md`.

## How to run

```sh
W=$(node tests/e2e/prepare-stack.mjs /tmp/nabalens-journey-stack)   # 583xx (E2E_PORT_BLOCK), studio/realtime/analytics/edge off
(cd /tmp && supabase --workdir "$W" start)
# Gate (each command < 8 min):
E2E_SUPABASE_WORKDIR="$W" pnpm exec playwright test tests/e2e/journey.spec.ts tests/e2e/negative.spec.ts tests/e2e/filters.spec.ts --project=chromium   # builds first
E2E_SKIP_BUILD=1 E2E_SUPABASE_WORKDIR="$W" pnpm exec playwright test tests/e2e/responsive.spec.ts --project=chromium
E2E_SKIP_BUILD=1 E2E_SUPABASE_WORKDIR="$W" pnpm exec playwright test tests/e2e/journey.spec.ts --project=firefox --project=webkit --project=mobile-chromium
supabase --workdir "$W" stop
```

- The app runs on :3457 (`E2E_PORT`).
- `E2E_SKIP_BUILD=1` reuses `.next`. Only use it against the same stack, because the public
  URL and key are inlined at build time.
- Screenshots: `.artifacts/screenshots/`. Gate JSON: `.artifacts/gate/`. Both are
  gitignored.

## Done

- **`playwright.config.ts`**
  - Resolves the isolated stack from `E2E_SUPABASE_WORKDIR` and refuses 554xx.
  - Runs `next build && next start`.
  - Projects: chromium (everything), firefox, webkit and mobile-chromium (`@core` only).
  - 1 worker, `retries: 0`.
  - Firefox gets `MOZ_APP_DATA`, because macOS 27 denies Playwright's Firefox access to
    `~/Library/Application Support/Firefox` ("Could not find profile folder").
- **`tests/e2e/prepare-stack.mjs`**
  - Builds the isolated stack config: site URL → :3457, unused services off.
  - Per-IP `sign_in_sign_ups`/`token_verifications` raised to 300, because every browser
    context shares one IP. The committed config is unchanged.
- **`tests/e2e/helpers/*`**
  - DEV FIXTURE world: two venues, Admin A/B, Staff A/B (venue 1), Staff C (venue 2), all
    `*@nabalens.test`. Users are created by one SQL statement in the seed.sql shape.
  - Mailpit polling for a NEW message.
  - Synthetic JPEG, `sips` HEIC and ffmpeg HEVC media.
  - Upload-dialog status recorder.
- **Specs:** `journey.spec.ts`, `negative.spec.ts`, `filters.spec.ts` and
  `responsive.spec.ts` (`@axe-core/playwright` added as a dev dependency).
- **`docs/qa-report.md`**: results, defects, visual review, flakiness root cause, and what
  is untested.

## App changes outside my ownership (small, each needed by a failing release check)

1. `app/admin/admin-library.tsx` (slice): `React.useOptimistic` for filters. Quick
   successive filter changes no longer drop earlier choices.
   - May conflict textually with `feat/nl-library` f3ee17b. Keep both: their
     `filtersToSearch` and my `shown`/`setShown`.
2. `lib/server/media/access.ts` + `lib/server/media/storage.ts` (slice): drain the error body
   instead of `await body.cancel()`. A missing original hung `/download` forever; it now
   returns 404.
3. `components/nabalens/media-tile.tsx` (ui): video duration added to the tile's accessible
   name (WCAG 2.5.3).
4. `components/nabalens/staff-directory-table.tsx` (ui): the mobile row link takes its name
   from its visible text (WCAG 2.5.3).
5. `tests/e2e/slice.spec.ts`: removed its hidden 504 retry loop. `README.md`: updated the
   `test:e2e` line.

No test-ids were added to app code.

## Integrator must know

- **`negative.spec.ts` "admin portfolio offers download and delete"** is `test.fail()`. That
  is defect 1, fixed on `feat/nl-library` f3ee17b. After merging library this test will
  "unexpectedly pass": remove the `test.fail()` line.
- **Flakiness root cause.** The Docker VM (8 GB) was shared by 12–14 Supabase stacks:
  - MemAvailable was 0.37–0.9 GB with swap 100 % used, and memory PSI `full` was 63–97 %.
  - GoTrue then hit its 10 s request deadline and returned 504. Storage stalled too.
  - Once the orchestrator freed memory, both runs were clean. Keep concurrent stacks down.
- **Reported, not fixed:**
  - Defect 4: a hung gallery refresh blocks all later refreshes, because `fetch` has no
    timeout.
  - Defect 5: `/admin/staff` 500s when GoTrue `listUsers` is slow.
  - Defect 8: a failed download shows no in-app message.
  - Cosmetic items: see the QA report.
- **Intermittent unit-test teardown error.** `tests/upload/transport.test.ts` once threw an
  unhandled `ENOENT` mkdir in a TUS temp dir after all 102 tests had passed. It did not
  recur in later runs and is not touched by this branch.

## Not tested (browser emulation only)

Physical iPhone/Android camera capture, real phone HEIC/HEIF and HEVC/MOV files, mobile
Safari, background or sleep behaviour during upload, real SMTP, hosted Supabase, and screen
readers. WebKit is Playwright's engine on macOS, not iPhone Safari.

## Stack

`nabalens-journey` (583xx) is stopped at the end of this track. Restart it with the commands
above.
