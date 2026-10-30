# NabaLens fan-out status

Integration branch: `feat/nabalens-mvp`. Updated 30 October 2026 by the integrator after
merge #4b. Wave 1, wave 2 (slice, lifecycle, accounts) and the finished wave-3 tracks below
are merged. Not pushed; `main` untouched.

## Merge #4b (30 October 2026, base `69f3d08`)

Merged with `git merge --no-ff` in this order. **Still running elsewhere, not merged:**
`feat/nl-authedge`, `feat/nl-visual`.

| Branch            | Tip       | Merge commit | Conflicts and resolution                                                                                                                                                                                                                                                         |
| ----------------- | --------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `feat/nl-secfix`  | `0166b98` | `1c5db9b`    | `access.ts`: library's `signedUrlTtlSeconds()` + secfix's service-role signing after `getReadableAsset`. `portfolio.ts` kept deleted. `next.config.ts`: secfix's headers (includes global `nosniff`). `gaps-support.ts`: merge #4a's no-retry version.                           |
| `feat/nl-uploads` | `ac58e9c` | `3fd04cc`    | `finalise.ts`: uploads' lost-claim block (`.is("deleted_at", null)`, `settleLostClaim`: tombstone → remove derivatives + original, 404; ready → ready; else 409) + secfix's `claim()` (`take_over_stale_media_claim`). Uploads' F4 size checks and failed-original removal kept. |
| `feat/nl-journey` | `ff5325e` | `9fc4d95`    | `admin-library.tsx`: merge-plan recipe (`useOptimistic` `shown` for the controls; `search`, gallery key and paging on committed `filters`; library's `filtersToSearch`). `README.md`: docs2 layout kept.                                                                         |
| `feat/nl-load`    | `6349632` | `137c7a8`    | None.                                                                                                                                                                                                                                                                            |

### Integration changes, merge #4b

- **`5f19b58`** `tests/security/upload-path.regression.test.ts` (F1/R4) imported the deleted
  `lib/server/accounts/portfolio.ts`. It now pages `listLibrary` filtered to the staff
  member, with the same assertions: nothing links a signed original; a video's
  `previewUrl` is `/api/media/[id]/stream`. No code signs originals (`createSignedUrl` is
  used only in `signDerivative` and `signAvatar`, both after their access checks; the
  directory signs avatars only).
- **`be3ba67` Playwright: one root config** (`playwright.config.ts`), journey's, with:
  - projects `chromium` (every spec, 1280×800), `firefox` and `webkit` (`@core`), and
    `mobile-chromium` (Pixel 7: `@core` **plus** auth, slice, staff-accounts, library and
    gaps, which ran at phone width before journey's config replaced the old
    `mobile`/`desktop` projects). `workers: 1`, `retries: 0`, no server reuse;
  - the Firefox private app-data fix moved to `tests/e2e/helpers/firefox.ts`, also used
    by upload-recovery's own Firefox launch for the playback matrix;
  - `upload-recovery.spec.ts` and `gaps.spec.ts` (GAP-11 HTTP) ran only in a project named
    `desktop`, which no longer exists, so they would have skipped silently. They now
    target `chromium`. `--list` shows 4 upload-recovery tests under `chromium`;
  - `negative.spec.ts`: `test.fail()` removed from "admin portfolio offers download and
    delete" (fixed by library); it passes;
  - the CI wrapper `scripts/ci/playwright.config.ts` now reuses the root projects for
    `CI_BROWSER` (chromium → `chromium` + `mobile-chromium`; firefox/webkit → `@core`)
    instead of its own `*-desktop`/`*-phone` projects; `run-suites.mjs` passes the CI stack
    as `E2E_SUPABASE_WORKDIR`; `scripts/ci/prepare-stack.mjs` points the CI stack's Auth
    Site URL/redirects at `E2E_PORT` (3457) and raises only its per-IP sign-in/verify
    limits, like journey's stack. Not run end to end through `local-ci.sh` here;
  - docs (`README.md`, `docs/setup.md`, `docs/ci.md`): port 3457, production build,
    project matrix.
  - Not applicable yet: `playwright.visual.config.ts` and the visual exclusion (visual is
    not merged).
- **`bac072f` semantic conflicts in merge #4a's tests** (no assertion weakened):
  - `library.test.ts` and `gaps-http.test.ts` called `reserve_media_asset` without the key
    and size secfix now requires. They pass both. The gaps direct-RPC test previously
    accepted any error; it now requires `venue_unavailable`.
  - `gaps-http.test.ts`: `reserveUpload`'s refusal now also carries `status: 403`
    (uploads' `app/staff/actions.ts`); asserted exactly.
  - `tests/library/seed.ts`: new `original` option stores the original while the
    reservation is `uploading`. Secfix's storage trigger refuses writes to an original
    once the reservation is closed, including service-role writes, so the old "upsert
    after ready" fixture was refused.
  - `tests/migrations/upgrade.test.ts` passes key and size (not run here; the migration
    suite needs its own phases).
- **`455d345`** `tests/lifecycle/stale-processing.test.ts` (secfix) declared 4 bytes for a
  ~1 KiB JPEG; uploads' F4 check then failed finalise with `size_mismatch`. The fixture
  declares the real size.
- **Media tile duration:** `media-tile.tsx` announces the duration once, at the end
  (journey). Upload selectors match by prefix (`^Video, <file>`) and still match.
  Revisit when visual lands (merge plan: journey's trailing variant wins).
- **Staff directory:** journey's visible-text link name; no test used the old
  `aria-label`.
- **HEIC** (load, `lib/media/heic.ts`): callers now queue for the single decode slot in
  arrival order, for at most `heicTimeoutMs`, instead of getting `decoder_busy` at once.

### Checks on merge #4b (`455d345`), 30 October 2026

| Check                                                                       | Result                                                                         |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `CI=true pnpm install --frozen-lockfile` (10.30.1)                          | exit 0 (added `@axe-core/playwright` 4.14.0 from the lockfile)                 |
| `CI=true pnpm@11 install --frozen-lockfile --ignore-scripts` (11.28.9)      | exit 0, scratch copy of `package.json` + lockfile                              |
| `pnpm typecheck` / `pnpm lint`                                              | exit 0 / exit 0                                                                |
| `pnpm test`                                                                 | 18 files, 138 passed                                                           |
| `pnpm build` + `pnpm scan:bundle`                                           | exit 0; 57 files, 1703 KiB, no findings; `[worker thread]` HEIC chunks present |
| `pnpm test:integration` (default 554xx, fresh `supabase db reset`)          | 13 files passed, 1 skipped; **138 passed, 11 skipped, 0 failed**               |
| `pnpm test:security "$W"` (isolated 564xx, `nabalens-merge4b`, fresh reset) | 3 files, 153 passed                                                            |
| `pnpm test:lifecycle "$W"` (same stack)                                     | 2 files, 23 passed                                                             |
| `tests/e2e/negative.spec.ts --project=chromium` (journey stack, 583xx)      | 8 passed, including the former `test.fail()` case                              |

- `gaps-profile-origin.test.ts` now **passes** (finding 7 fixed by secfix). The
  intentional failure recorded for merge #4a is gone.
- The 11 skipped are `privacy-runtime.test.ts` (needs a production server, as before).
- Load (`uptime`): 4.28 / 4.17 / 7.82 before starting; 3.73 / 3.98 / 6.96 → 4.76 / 4.23 /
  6.90 across the full integration run; 2.87 / 3.81 / 6.55 at the security run; 3.80 /
  3.85 / 6.07 after e2e. Other stacks up: `Nabaperks`, `nabalens-visual`. No timeouts.
- Stacks: default `nabalens` started from this checkout, reset, stopped. Isolated
  `/tmp/nl-merge4b-sec` (564xx; studio, realtime, analytics, edge runtime off) and
  `/tmp/nl-merge4b-e2e` (583xx, `tests/e2e/prepare-stack.mjs`) stopped.
- **Not run here** (the lead runs them): full e2e on every project, `local-ci.sh`, the
  migration suite and the backup/restore drill. `.next` was last built against the e2e
  stack; rebuild before serving against another.

### Open items after merge #4b

- From load: `finalise.ts` `BUSY_RETRIES = 8` now compounds with the 15 s HEIC FIFO wait
  (worst case ~170 s); lower it or set `maxDuration`. `reserveUpload`/`finaliseUpload`
  answer HTTP 500 when `loadProfile` throws on a PostgREST error.
- From secfix: `app/admin/staff/[id]/avatar/route.ts` should use `isSameOriginRequest`;
  confirm a `storage.objects` trigger is allowed on hosted Supabase; cleanup (and so the
  stale-processing reaper) is still unscheduled.
- From uploads: viewer `canPlay` rejects H.264 MOV in Chromium (visual/library); stale
  `uploading` rows labelled "Uploading" (visual/library); Server Functions serialise
  reserve/finalise per client (slice); hosted bucket/global upload limits (M6).
- From journey: defects 4 (hung refresh blocks later refreshes), 5 (`/admin/staff` 500 on
  slow `listUsers`), 8 (no in-app message on a failed download).
- CI: HEIC fixtures use macOS `sips` (Ubuntu needs another encoder); privacy runtime
  suite and migration suite are not CI stages yet.
- On visual/authedge merge: visual Playwright config and explicit visual exclusion,
  duration-label dedupe, upload selector check, authedge's GET cleanup wording.

## Merge #4a (30 October 2026, base `88fc61b`)

Merged with `git merge --no-ff`, in the merge plan's order. All 11 merged without a textual
conflict. The journey/library `admin-library.tsx` conflict and the visual/journey duplicate
duration in the plan only arise once journey and visual land, so neither applied here.

| Branch                   | Tip       | Merge commit | Notes                                                                        |
| ------------------------ | --------- | ------------ | ---------------------------------------------------------------------------- |
| `feat/nl-migrations`     | `75dc8ac` | `61908c9`    | Migration-safety suite (`tests/migrations`), backup/restore drill scripts.   |
| `feat/nl-privacy`        | `cf9ca90` | `001dd1c`    | Bundle secret scanner, runtime header/log audit, global `nosniff`.           |
| `feat/nl-library`        | `e83de82` | `8a560c9`    | Admin portfolio on `MediaGallery`, preview recovery; interim portfolio gone. |
| `feat/nl-gaps`           | `566d1e0` | `2d208a4`    | GAP-11/12/16/19 tests, including the deliberate failing BUG test below.      |
| `feat/nl-ci`             | `e4f7b91` | `91e3e8b`    | Workflow, `scripts/ci/local-ci.sh`, isolated stack, browser matrix adapter.  |
| `review/nl-wave3`        | `ce09ae1` | `6986881`    | `docs/reviews/wave3-review.md`.                                              |
| `review/nl-upload-path2` | `0b169e5` | `c14f462`    | `docs/reviews/upload-path-review.md`.                                        |
| `review/nl-scope`        | `3894911` | `c786772`    | `docs/reviews/scope-audit.md`.                                               |
| `feat/nl-docs2`          | `be8a897` | `e71be84`    | Supersedes `feat/nl-docs` (contained; not merged separately).                |
| `feat/nl-acceptance`     | `1193e85` | `7787d5b`    | `docs/acceptance.md` (audits `3a23c9b`; reconcile at final head).            |
| `feat/nl-mergeplan`      | `4c03805` | `b5c85a3`    | `docs/fanout/merge-plan.md`.                                                 |

Pending at merge #4a: journey, visual, authedge, uploads, load, secfix (journey, uploads,
load and secfix landed in merge #4b above).

### Integration changes, merge #4a (`a964290`)

- **Scripts.** Added `"test:migrations": "node tests/migrations/run.mjs"` (documented by the
  migrations handoff, usage `pnpm test:migrations "$W" <phase>`) and
  `"scan:bundle": "node scripts/ci/scan-bundle.mjs"`. No dependency change; the lockfile is
  untouched. `minimumReleaseAge: 1440` and `allowBuilds` are unchanged.
- **Bundle scan in CI.** `scripts/ci/local-ci.sh` runs `scan-bundle` right after a passing
  build, so the workflow (which calls that script) now fails on a finding.
- **Fixture retries removed** (merge plan, "fixture retries are a visible policy issue"):
  `tests/library/seed.ts` `setupIdentity`, `tests/library/e2e.ts` `signInAs` and
  `tests/integration/gaps-support.ts` `setupIdentity`/`setupSession` now fail once on a local
  auth 504, with a "machine load?" diagnostic, instead of looping.
- **Configs.** Root `vitest.config.ts` stays authoritative and already discovers the new unit
  (`library-gallery`, `no-image-optimiser`, `scope-guard`) and integration files. The
  standalone `tests/{security,lifecycle,migrations}/vitest.config.ts` stay separate. Root
  `playwright.config.ts` and `scripts/ci/playwright.config.ts` are unchanged; the plan's
  Playwright consolidation (journey/visual configs, `desktop` vs `chromium` project names,
  visual exclusion) waits for journey and visual.
- **Docs.** One `README.md`; it now links `docs/acceptance.md`, `docs/privacy-audit.md`,
  `docs/backup-restore.md`, `docs/ci.md` and the three `docs/reviews/*`. The POST-only
  cleanup wording stays correct until authedge (GET support) lands.

### Known failing test (intentional, at merge #4a only; passes since merge #4b)

`tests/integration/gaps-profile-origin.test.ts` > "/api/profile refuses a cross-origin POST
and changes nothing" **failed on purpose** until `feat/nl-secfix` landed: `/api/profile`
accepts a cross-origin POST (`display_name` becomes "TEST cross-origin rename"). It is not
skipped. `pnpm test:integration` therefore exits 1 with exactly this one failure.

### Checks on merge #4a (`a964290`), 30 October 2026

| Check                                                                    | Result                                                           |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `CI=true pnpm install --frozen-lockfile` (10.30.1)                       | exit 0, lockfile up to date                                      |
| `CI=true pnpm@11 install --frozen-lockfile` (11.28.9)                    | exit 0                                                           |
| `pnpm typecheck`                                                         | exit 0                                                           |
| `pnpm lint`                                                              | exit 0                                                           |
| `pnpm test`                                                              | 15 files, 124 passed                                             |
| `pnpm build`                                                             | exit 0                                                           |
| `node scripts/ci/scan-bundle.mjs` (after build)                          | 57 files, 1701 KiB, no findings                                  |
| `pnpm test:integration` (default 554xx stack, fresh `supabase db reset`) | 116 passed, 11 skipped, **1 failed** (the intentional one above) |

- Load: `uptime` load averages 8.80 / 11.21 / 18.58 at the start of integration and 8.53 /
  10.84 / 18.11 at the end (01:09–01:10 local); no timeouts were seen.
- The 11 skipped are `privacy-runtime.test.ts`, which needs `PRIVACY_BASE_URL`,
  `PRIVACY_SERVER_LOG` and `CLEANUP_SECRET` against a production server (`docs/privacy-audit.md`).
  `privacy-bundle.test.ts` ran, because `.next/static` existed after the build.
- The default stack was started from this checkout only for this run, then stopped.
- **Not run here** (the lead runs them at the end): e2e (`pnpm test:e2e`, `library.spec.ts`,
  `gaps.spec.ts`), security, lifecycle, the migration suite and the backup/restore drill.
- Still open from the merge plan: migration suite as an explicit CI stage, the privacy
  runtime suite in CI, CI auth URLs/`E2E_SUPABASE_WORKDIR` wiring, and the signed-read,
  delete/finalise and stale-processing security fixes from the reviews (expected from
  secfix).

## Merged

| #   | Branch               | Tip       | Merge commit | Notes                                                                              |
| --- | -------------------- | --------- | ------------ | ---------------------------------------------------------------------------------- |
| 1   | `feat/nl-foundation` | `da34c62` | `33e16e0`    | M0 + M1: schema, RLS, storage, auth, `proxy.ts`, test harness.                     |
| 1   | `feat/nl-ui`         | `d9a42c2` | `0203513`    | Theme, shadcn kit, `components/nabalens/**`, `/ui-preview` (404 in production).    |
| 2   | `feat/nl-media`      | `d4d4cb2` | `a00c8ae`    | `lib/media`: sniff, validate, image/HEIC derivatives in a worker, video probe.     |
| 2   | `feat/nl-transport`  | `28e830b` | `9856ce6`    | `lib/upload`: browser transport (TUS resume, signed PUT), queue adapter.           |
| 2   | `feat/nl-security`   | `11faf92` | `858d870`    | Adversarial RLS/storage/auth suite (114 tests) on an isolated stack. No SQL fixes. |

### Integration changes, merge #1

- **Lockfile.** Re-resolved from the `minimumReleaseAge: 1440` base (`635f8d8`) rather than
  taking either branch's lockfile.
- **Test harness.** One `vitest.config.ts`, foundation's. The `unit` project also runs
  `tests/ui/**`, and component tests opt into jsdom per file.
- **`/login`** renders `LoginCard` through `requestSignInLink(email) -> { error? }` in
  `app/login/actions.ts`. `login-form.tsx` was removed, and the e2e selectors follow the new copy.
- **`MEDIA_LIMITS.maxFilesPerBatch` was renamed to `maxBatchFiles`**, the name the UI kit and
  the media branch use. A type test asserts that `MEDIA_LIMITS` satisfies the UI's
  `UploadLimits`.
- **Fonts.** `app/layout.tsx` uses the UI's Geist fonts, and `--font-heading` maps to sans.

### Integration changes, merge #2

- **`lib/config/media.ts`.** Foundation's file stays canonical: its names, comments,
  `MediaLimits`, `maxBytesFor` and `abandonedUploadInterval`. Every processing limit from the
  media branch is added with an unchanged value: pixel limit, sharp timeout, HEIC worker
  deadline and V8 limits, HEIC concurrency, probe byte/request/box/depth/EBML budgets, maximum
  video dimension, sniff head size and derivative sizes.
  - The media branch's `signedUrlTtlSeconds` and `abandonedUploadHours` were dropped, because
    `lib/media` reads neither. Use foundation's `signedUrlExpirySeconds` and
    `abandonedUploadWindowHours` instead.
  - `tests/unit/media-config.test.ts` now uses `toMatchObject` for the product limits.
- **vitest.** `tests/media/**` and `tests/upload/**` join the `unit` project, so `pnpm test`
  runs them. The media branch's one-line config was dropped, and the transport branch had none.
- **Upload types.** `lib/upload/types.ts` keeps its own copy of `UploadContext`/`Uploader`, so
  `lib/` never imports `components/`.
  - `tests/upload/helpers/ui-queue-contract.ts` now re-exports the **real**
    `components/nabalens/upload-queue.ts` types instead of a verbatim copy.
  - The existing `expectTypeOf(...).toEqualTypeOf` assertions in
    `tests/upload/queue-adapter.test.ts` therefore compare against the source. Changing
    `attempt: number` to `string` in `lib/upload/types.ts` produced three TS2344 errors in
    `pnpm typecheck`. The change was reverted.
- **Security suite.**
  - Added a `pnpm test:security <workdir>` script, equivalent to
    `node tests/security/run.mjs <workdir>`.
  - New `tests/security/prepare-stack.mjs` creates that workdir from `supabase/` with project
    `nabalens-security` and ports moved from 554xx to 564xx. Its output matches the config the
    security track used, byte for byte.
  - Documented in `README.md` and `docs/security-tests.md`. The suite keeps its own
    `tests/security/vitest.config.ts`, so `pnpm test` and `pnpm test:integration` are
    unchanged.
- **Path bug.** `tests/media/pipeline.test.ts` now uses `fileURLToPath` instead of
  `URL.pathname`, which stays percent-encoded when the checkout path has a space ("LapenInns
  Project"). `lib/media` itself passes `URL` objects and is unaffected.
- **Lockfile.** Re-resolved from the policy base again. The new dependencies match the branches'
  versions: sharp 0.35.5, heic-decode 2.1.0, libheif-js 1.23.5, tus-js-client 4.3.1,
  @tus/server 2.4.6 and @tus/file-store 2.1.1. The security track's report of 25 rejected
  entries came from its stale foundation-era lockfile, which was not used.
- **Worktrees.** The `feat/nl-foundation` and `feat/nl-ui` worktrees were removed after
  merge #1. The `feat/nl-media`, `feat/nl-transport` and `feat/nl-security` worktrees are
  clean but were **kept**: each is still the working directory of a live agent session
  (claude, bash, node REPLs). Run `git worktree remove` on them once those threads are closed.
  `review-nl-media` is not a merged branch and was not touched. All branches are kept.
- **Stack restart.** The `nabalens` stack was started from the foundation worktree, so after
  that worktree was removed, Kong's email-template bind mounts pointed at a deleted directory.
  Auth then logged `templatemailer ... 404` and sent no magic links, and the e2e run failed.
  The stack was restarted from this checkout (`supabase stop && supabase start`); the mounts
  now point here and e2e passes. **Start the default stack from the main checkout only.**

## HEIC worker under `next build` (verified)

`lib/media/heic.ts` spawns `new Worker(new URL("./heic-worker.mjs", import.meta.url))`. No
route imports `lib/media` yet, so a temporary, uncommitted Route Handler called `processImage`
and `validateMedia` on the fixtures. It was built with `pnpm build` and served with
`next start`. Findings:

- **Turbopack rewrites the worker.** It turns the `new Worker` call into a worker-thread entry
  chunk (`.next/server/chunks/[worker thread]-lib_media_heic-worker_mjs_*.js`).
  - That chunk loads the worker module bundled into a server chunk, which also contains
    `libheif-js/libheif-wasm/libheif-bundle.js`, so the WASM is inlined.
  - Turbopack also emits the raw `heic-worker.*.mjs` as an asset, but nothing uses it. With that
    asset deleted, HEIC still decoded.
- **Runtime results under `next start`:**
  - `synthetic-12mp.heic`: ok, `image/heic`, 4000×3000, preview 111,582 B, thumb 28,306 B.
  - PNG: ok.
  - `synthetic.mp4` via `validateMedia({ source: path })`: ok, avc1, 320×240, 0.2 s.
- **Deployment trace.** The route's `.nft.json` includes the worker entry chunk, the bundled
  chunk, `sharp` and its native `@img/sharp-*-darwin-arm64` + libvips binaries.
- **Config.** `sharp` is already on Next's default `serverExternalPackages` list.
  **`next.config.ts` is unchanged.**
  - Do not add `heic-decode` or `libheif-js` to `serverExternalPackages`. The worker would then
    import them from `node_modules` at runtime, and they are not in the trace.
  - The trace holds only the build machine's sharp binaries, so build on the deploy platform
    (for example Vercel's Linux builder).
- **Wave 2 must re-check.** Once a real route imports `lib/media`, repeat this check: a
  `[worker thread]` chunk must exist in `.next/server/chunks`, and that route's `.nft.json`
  must list it.

## Checks on `feat/nabalens-mvp` (final tree, after `supabase db reset`)

| Command                                                 | Result                                                                                                                                            |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile` pnpm 10.30.1 / 11.17.0 | pass / pass ("Lockfile passes supply-chain policies", 765 entries; pnpm 11 checked in a scratch copy)                                             |
| `pnpm typecheck`                                        | pass, no errors                                                                                                                                   |
| `pnpm lint`                                             | pass, no errors                                                                                                                                   |
| `pnpm test`                                             | 12 files, 102 tests passed (foundation unit, UI, media incl. HEIC memory, upload transport)                                                       |
| `pnpm test:integration`                                 | 4 files, 33 passed (stack `nabalens`, 554xx)                                                                                                      |
| `pnpm test:e2e`                                         | 12 passed (mobile + desktop, real magic link via Mailpit)                                                                                         |
| `pnpm test:security "$W"`                               | 1 file, 114 passed (stack `nabalens-security`, 564xx)                                                                                             |
| `pnpm build`                                            | compiled; routes `/`, `/admin`, `/auth/*`, `/login`, `/staff`, `/ui-preview`                                                                      |
| `node tests/media/benchmark-heic.mjs`                   | passed. 12 MP: 317 ms, peak RSS 361 MB. 39 MP: 679 ms, peak 677 MB. 30×12 MP: 9.5 s, peak 603 MB. 100 malformed 19 MiB inputs: 7.1 s, peak 658 MB |

The security suite ran against the existing `nabalens-security` stack, which the security
track left running. It was not reset, because its migrations and seed are identical to this
checkout's.

## Security check: public sign-up (from merge #1, re-confirmed by the security suite)

Config: `[auth] enable_signup = false`, `[auth.email] enable_signup = true`. A raw HTTP probe
with the publishable key returned:

- `POST /auth/v1/signup` (password): 422 `signup_disabled`.
- `POST /auth/v1/otp` with `create_user: true`: 422 `signup_disabled`.
- `POST /auth/v1/otp` with `create_user: false`: 422 `otp_disabled`.
- Afterwards, 0 auth users existed for the probe email.

Magic links for invited users still work (e2e). **No config change was needed.** Keep
`[auth.email] enable_signup = true`: in the Supabase CLI it enables the email provider. For
hosted Supabase, "Allow new users to sign up" must be off and the Email provider on; check this
at M6.

## Ready for wave 2

Use these entry points. Don't reimplement them.

**Server auth (`lib/auth`).** Call one of these in every page, Server Function and Route
Handler. Each re-reads the current profile, so a deactivated user is denied even with a live
session.

- `requireActiveStaff()` / `requireActiveAdmin()` → `CurrentProfile`. They redirect to login,
  the blocked page or the other role's home. The contract aliases are `requireStaff` and
  `requireAdmin`.
- `authorize(role)` → `{ ok: true, profile } | { ok: false, status: 401 | 403, reason }`, for
  Route Handlers that must return a status code.
- `uploadBlockReason(profile)` → `"not_staff" | "no_venue" | "venue_inactive" | null`. Use it to
  show the setup message instead of the Upload action.

**Limits and keys (`lib/config`).**

- `MEDIA_LIMITS` (`lib/config/media.ts`) is the only source of limits, plus `maxBytesFor(kind)`
  and `abandonedUploadInterval()`. Pass it straight in: `UploadDialog limits={MEDIA_LIMITS}`,
  `EditProfileDialog maxAvatarBytes={MEDIA_LIMITS.maxAvatarBytes}`, and
  `createUploader({ limits: MEDIA_LIMITS, … })`.
- `STORAGE_BUCKETS.media` / `.avatars` (`lib/config/storage.ts`).
- `mediaObjectKeys(uploaderId, assetId, ext)` → `{ original, preview, thumbnail }`.
- `avatarObjectKey(userId, avatarId)`.
- Keys are bucket-relative: `{uploader}/{asset}/original.jpg` in bucket `media`.

**Database functions** (call as the signed-in user through `lib/supabase/server`, not the
service role, so `auth.uid()` applies):

- `reserve_media_asset(p_media_type, p_extension, p_original_filename, p_size_bytes?)` →
  `(id, original_path, venue_id)`.
  - It derives owner and venue from the caller's current profile and generates the ID and key.
  - It raises `not_active_staff`, `venue_unavailable` or `invalid_extension`.
  - **It does not check sizes.** Check `MEDIA_LIMITS` first.
  - Only sign upload URLs for keys it returned. Signed upload URLs made with the service role
    bypass the reserved-key policy.
- `delete_media_asset(p_asset_id)` writes a tombstone (`deleted_at`). It raises
  `media_asset_not_found` for a missing or forbidden asset; PostgREST maps that to HTTP 500, so
  routes must map it to 404.
  - Physical removal goes through `prepare_media_cleanup(p_abandoned_after, p_limit)`, run with
    the service role on a schedule. Nothing schedules it yet.
- Processing: the service role moves an asset from `uploading` to `processing` to `ready`.
  `ready` requires `validated_mime_type` and `size_bytes`.

**Media processing (`lib/media`, server-only, Node runtime).**

- `validateMedia({ bytes? | source?, size?, declaredMime, filename }, limits?)` →
  `{ ok: true, kind, mime, ext, size, … } | { ok: false, error }`.
  - For images it requires `bytes` and already returns `preview`, `thumb`, `width` and `height`.
  - For video, pass a local path or a `VideoRangeSource` as `source`; it returns probe metadata
    (codec, dimensions, `durationSeconds?`, `likelyBrowserPlayable`).
- `processImage(bytes, declaredMime)` → `{ preview, thumb, width, height, kind, mime, ext }`.
  Use it when you already know the file is an image.
- **Use the derivatives these return.** Don't run a second image stage.
- `createAvatarDerivative(bytes)` → WebP buffer for `avatarObjectKey`.
- Also exported: `sniffMedia`, `probeVideo` and `MediaError` (`.code`). HEIC decoding is limited
  to one at a time per process; concurrent calls queue for the slot in arrival order
  (since merge #4b, `feat/nl-load`) and get `decoder_busy` ("retry") only after waiting
  `heicTimeoutMs`.
- Download and sign routes must send `Content-Disposition: attachment`, the validated
  `Content-Type` and `X-Content-Type-Options: nosniff` (`docs/media-pipeline.md`).

**Browser upload (`lib/upload`, client-only).**

- `createUploader({ reserve, finalise, supabaseUrl, getAccessToken, limits, apiKey? })` →
  `MediaUploader`.
- `toQueueUploader(upload, { newKey? })` → the UI's `Uploader`. Pass it to `UploadDialog` or
  `useUploadQueue`.
- `reserve(ReserveInput)` and `finalise({ assetId, idempotencyKey })` are wave 2's Server
  Functions. Shapes are in `lib/upload/types.ts` and `docs/upload-transport.md`. They should
  return errors rather than throw them, because Next hides thrown messages in production.
- `guardBeforeUnload` and `preflight` are also exported.

## Open gaps and decisions for wave 2

- **Idempotent reserve needs a schema decision.** `ReserveInput.idempotencyKey` must map to the
  same asset on retry, but `reserve_media_asset` has no key parameter and `media_assets` has no
  column to store one. The contract fixes "exactly the spec's columns". The smallest options:
  - a migration adding a nullable unique `idempotency_key` (or `(uploader_id, key)`), plus a
    function parameter, recorded as a contract amendment; or
  - a server-side key-to-asset map outside `media_assets`.

  Wave 2 (slice) owns this choice.

- **No real pages yet.** `/staff` and `/admin` are placeholders. Wave 2 wires `AppShell`,
  `MediaGrid`, `UploadDialog` and the other components to data. `components/nabalens` stays
  free of `lib/supabase`, and server code never imports `components/`.
- **No routes yet** for upload reserve/finalise, the processing step, signed reads (60 s,
  `MEDIA_LIMITS.signedUrlExpirySeconds`) or downloads.
- **No cleanup scheduler** for `prepare_media_cleanup`, and no avatar upload route.
- **Accounts track:** invitations, account management, deactivation UI.
- **Minor:**
  - `LoginCard`'s sent state says "Open it on this device", although `token_hash` links also
    work in another browser. The UI track owns that copy.
  - `next dev`/`next start` warn about a stray `~/pnpm-workspace.yaml` outside the repo. This
    is harmless.
- **Release items, not verified:** physical phones (camera, HEIC, video playback), hosted
  Supabase, SMTP, Linux/Vercel worker startup and memory under load. V8 `resourceLimits` do not
  cap WASM or native memory (`docs/media-pipeline.md`).

## Local stacks on this Mac

- `nabalens`: API `:55421`, DB `:55422`, Studio `:55423`, Mailpit `:55424`. Started from the
  main checkout.
- `nabalens-security`: API `:56421`, DB `:56422`, Studio `:56423`, Mailpit `:56424`. Started
  from a temporary workdir (`tests/security/prepare-stack.mjs`).
- `Nabaperks` (543xx) is a different project. Don't touch it.
