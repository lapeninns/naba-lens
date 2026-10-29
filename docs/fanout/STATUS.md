# NabaLens fan-out status

Integration branch: `feat/nabalens-mvp`. Updated 29 October 2026 by the integrator after
merge #2. All wave-1 tracks are merged.

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
  merge #1. All branches are kept.
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
  to one at a time per process; a second concurrent call gets `decoder_busy`, which means
  "retry".
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
