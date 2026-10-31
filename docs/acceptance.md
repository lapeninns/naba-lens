# NabaLens acceptance map

Track: `acceptance-map`, branch `feat/nl-acceptance`. Revision under test: **`3a23c9b`**
(`feat/nabalens-mvp`). Written 30 October 2026.

This map links each row of spec §10, each bullet of the brief's §4–§5
(`docs/spec/NabaLens-Coding-Agent-Prompt.md`), and each ledger requirement R1–R24
(`docs/release/LEDGER.md`) to existing tests. Each entry gives the test's file and
name, its layer, the identity it runs as, and its result on `3a23c9b`. Every gap
states the assertion that is missing. I didn't edit the ledger. The proposed ledger
updates are in [§6](#6-proposed-ledger-updates-for-the-lead).

## 1. How the results were produced

I used one isolated stack, `nabalens-acceptance`: a temp copy of `supabase/` in
`/tmp/nabalens-acceptance-stack` with ports moved to 515xx. Studio, realtime,
analytics, edge_runtime, storage.vector and the S3 protocol were disabled. Mailpit
stayed on, because e2e needs it. The stack was stopped after the runs. Logs are in
`.artifacts/acceptance/` (gitignored).

| Command (on `3a23c9b`)                                    | Exit | Result                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile` (pnpm 10.30.1)           | 0    | done                                                                                                                                                                                                                                                                                            |
| `pnpm typecheck`                                          | 0    | no errors                                                                                                                                                                                                                                                                                       |
| `pnpm lint`                                               | 0    | no errors                                                                                                                                                                                                                                                                                       |
| `pnpm test` (unit project)                                | 0    | 12 files, **102 passed**                                                                                                                                                                                                                                                                        |
| `vitest run --project integration` (acceptance stack)     | 1    | 6 files passed, 74 tests passed. `privilege.test.ts` failed in `beforeAll`: auth `createUser` returned **504**, so its 10 tests were skipped and no assertion failed                                                                                                                            |
| ↳ rerun `tests/integration/privilege.test.ts` alone       | 0    | **10 passed** → integration total **84/84** (7 files)                                                                                                                                                                                                                                           |
| `node tests/security/run.mjs <W>`                         | 0    | **114 passed**                                                                                                                                                                                                                                                                                  |
| `node tests/lifecycle/run.mjs <W>`                        | 1    | `beforeAll` failed: auth `generateLink` returned **504** (GoTrue log: `context deadline exceeded`, 10 s), so all 17 tests were skipped                                                                                                                                                          |
| ↳ rerun                                                   | 0    | **17 passed**                                                                                                                                                                                                                                                                                   |
| `pnpm exec playwright test` (E2E_PORT 3617) — run 1       | 1    | 7 passed, 11 failed                                                                                                                                                                                                                                                                             |
| ↳ run 2 (full)                                            | 1    | 9 passed, 9 failed                                                                                                                                                                                                                                                                              |
| ↳ run 3 (`slice.spec.ts` + `staff-accounts.spec.ts` only) | 1    | 2 passed, 4 failed                                                                                                                                                                                                                                                                              |
| `pnpm build`                                              | 0    | compiled. Routes: `/`, `/admin`, `/admin/staff`, `/admin/staff/[id]`, `/admin/staff/[id]/avatar`, `/api/avatars/[id]`, `/api/internal/cleanup`, `/api/media/[id]/{download,preview,stream,thumb}`, `/api/profile`, `/auth/{blocked,callback,confirm,logout}`, `/login`, `/staff`, `/ui-preview` |

**Machine load caveat.** Load average was 28–39 throughout, with about 15 Supabase
stacks from other worktrees running at once. Every vitest failure was an auth 504 in
`beforeAll`, and each passed on a plain rerun with no code change. The e2e failures
are explained in [§1.1](#11-e2e-results-per-test-across-the-three-runs). I added no
retries to any test and changed no assertion. Rerun e2e on a quiet machine before
recording any e2e row as VERIFIED.

### 1.1 E2E results per test across the three runs

Results are listed in run order, as mobile = Pixel 7 emulation (412 px) and
desktop = Chrome at 1280 px. Each failure is classified from the Playwright error and
the `[WebServer]` log.

| Test (`tests/e2e/…`)                                                                                 | Mobile  | Desktop | Notes                                                                                                |
| ---------------------------------------------------------------------------------------------------- | ------- | ------- | ---------------------------------------------------------------------------------------------------- |
| `auth.spec.ts` › signed-out visitors are sent to /login                                              | P, P    | P, P    | stable                                                                                               |
| `auth.spec.ts` › an uninvited email gets the same neutral response and no account                    | P, F    | F, F    | F: `/otp` 504, so "Check your email" never shows. The app correctly declines to claim it sent a link |
| `auth.spec.ts` › invited staff signs in by magic link and lands on /staff                            | P, F    | F, P    | F: same `/otp` 504                                                                                   |
| `auth.spec.ts` › an admin lands on /admin                                                            | F, F    | F, P    | F: `/otp` 504 or `createUser` 504                                                                    |
| `auth.spec.ts` › a reused or invalid link offers recovery                                            | F, P    | F, P    | F: `/otp` 504                                                                                        |
| `auth.spec.ts` › a deactivated account is blocked, even with an existing session                     | F, P    | F, P    | F: `/otp` 504                                                                                        |
| `slice.spec.ts` › staff uploads; a different admin downloads identical bytes; other staff are denied | P, F, F | P, P, F | F: 504 (twice). Once on mobile, `2 uploaded` did not appear within 60 s under load                   |
| `slice.spec.ts` › staff edit their own name and profile photo                                        | P, F, P | F, F, P | F: 504, or the 30 s test timeout                                                                     |
| `staff-accounts.spec.ts` › invite → accept → deactivate → reactivate                                 | F, F, F | F, F, F | **Never passed here, see triage below**                                                              |

**Triage needed: `staff-accounts.spec.ts` on mobile.** In runs 1 and 2 the mobile
project failed at the status assertions, and neither failure had an auth error:

- Run 1 timed out after 30 s waiting for `getByText("Active", { exact: true })`.
- Run 2 timed out after 30 s waiting for `getByText("Inactive", { exact: true })`.
  The page showed "… is deactivated. Their uploads stay in the library.", but the
  header still read `Active <email>` and the button still said `Deactivate`.

In other words, `router.refresh()` did not update the header within 30 s, or the
status text on mobile is not a separate element. Load may explain it. The CI track
reported this spec passing on Chromium at its revision
(`docs/fanout/handoffs/ci.md` on `feat/nl-ci`). The other four `staff-accounts`
failures were auth 504s or the 180 s test timeout. **Owner: accounts/visual.** Rerun
`pnpm exec playwright test tests/e2e/staff-accounts.spec.ts --project mobile` on a
quiet machine. If it still fails, check `app/admin/staff/[id]` at 412 px.

There is also a pre-existing retry in test setup, which I left unchanged.
`tests/e2e/slice.spec.ts` `signIn()` retries `auth.admin.generateLink` up to 3 times,
on a 504 only. It is labelled in the code and affects only fixture sign-in, not an
assertion. I'm reporting it because the brief forbids hidden retries.

## 2. Legend

- **Layer:** `unit` (vitest, no stack; jsdom for UI), `int` (vitest `integration` project
  on the local stack), `sec` (`tests/security`, isolated stack), `life`
  (`tests/lifecycle`, isolated stack), `e2e` (Playwright and `next dev` against the
  stack).
- **Identity:**
  - `user` means the assertion runs through a real signed-in user's JWT client.
    The session is minted by `generateLink` plus `verifyOtp`, or in e2e by the real
    `/auth/confirm` route and browser cookies.
  - `anon` means the publishable key with no session.
  - `svc` means the service role. Fixtures are always created with `svc`. I mark
    `svc` only when the **assertion itself** uses it. Everywhere else, `svc` only
    arranges or inspects state.
  - `n/a` is for pure unit tests.
  - `actorFor()` (`tests/slice/media-actor.ts`) is the same `MediaActor` the app
    builds per request: the user's RLS client, a fresh profile, and `svc` only for
    the post-check processing step. It counts as `user`.
- **Result** on `3a23c9b`:
  - `PASS`: passed in the runs above.
  - `PASS*`: passed on a rerun after an auth-504 `beforeAll` failure.
  - `E2E-FLAKY`: passed in at least one run and failed only for environmental
    reasons (§1.1).
  - `E2E-UNVERIFIED`: did not pass on this machine.
- **Abbreviations:** `INT/slice-media` is `tests/integration/slice-media.test.ts`,
  and the other files follow the same pattern. `›` separates describe blocks from
  the test name.

## 3. Spec §10 acceptance tests

| §10 test                 | Tests (layer, identity)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Result on 3a23c9b                                                      | Gap                                                                                                                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invite and login         | `e2e/staff-accounts` › invite → accept → deactivate → reactivate (e2e, user; real invitation email via Mailpit) · `e2e/auth` › invited staff signs in by magic link and lands on /staff (e2e, user; real email) · `e2e/auth` › an uninvited email gets the same neutral response and no account (e2e, anon) · `INT/accounts` › invite-only sign-in › an uninvited email gets no account and a neutral result (int, anon) · `INT/staff-accounts` › invite staff › creates one staff account… / the invited person can accept and lands as active staff (int, user admin) · `SEC/access` › §7/§10: public password signup and OTP account creation yield no account or usable session (sec, anon) · `UNIT/auth` › magic link › never creates users and answers neutrally on errors | int/sec PASS; e2e E2E-FLAKY (auth) and E2E-UNVERIFIED (staff-accounts) | No assertion gap. Needs a quiet-machine e2e rerun (§1.1).                                                                                                                                   |
| Account setup            | `INT/accounts` › an auth user without a profile is not granted access (int, user) · `INT/accounts` › deactivation blocks an existing session › * (int, user) · `INT/lifecycle` › an inactive venue cannot receive uploads or assignments (int, user→RPC) · `UNIT/auth` › uploadBlockReason › blocks admins, missing venues and inactive venues · `UNIT/auth` › toAuthState › distinguishes signed-out, missing, inactive and active accounts · `e2e/auth` › a deactivated account is blocked… (e2e, user) · DB constraint `profiles_staff_requires_venue` makes a staff profile without a venue impossible                                                                                                                                                                       | PASS (e2e FLAKY)                                                       | **GAP-12**                                                                                                                                                                                  |
| Own profile              | `e2e/slice` › staff edit their own name and profile photo (e2e, user) · `INT/slice-media` › own profile › updates name and avatar… (int, user) · `INT/privilege` › staff can change their own display name / cannot grant themselves admin / cannot change their own venue, activation or job title / cannot edit another staff member's profile / cannot point their avatar outside their own folder (int, user) · `INT/staff-accounts` › staff cannot escalate through direct database updates › * (int, user) · `SEC/access` › §7: <actor> cannot change own protected profile column <column> (sec, user × 6 actors)                                                                                                                                                         | PASS* (privilege), rest PASS; e2e FLAKY                                | Small: no test sends `role`/`venue_id`/`active` in the **`/api/profile` HTTP** body and asserts that they are ignored (the DB tests cover the RLS layer). Part of **GAP-11**.               |
| Image upload             | `e2e/slice` › staff uploads… (e2e, user: reload, thumbnail `naturalWidth > 0`, row `ready`) · `INT/slice-media` › finalise › validates the stored JPEG, writes derivatives and is idempotent (int, user) · `INT/slice-media` › reserve › derives owner, venue, id and key on the server (int, user)                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | PASS (e2e FLAKY)                                                       | Small: no assertion on the **visible upload date** or on the contributor and venue labels in the **staff** portfolio after reload. The admin tile label covers contributor and venue.       |
| Admin availability       | `e2e/slice` › staff uploads… (the admin signs in **after** the upload and sees the tile) · `INT/isolation` › an admin sees the same ready asset and every staff profile (int, user) · `INT/slice-media` › a different admin sees it… (int, user)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | PASS                                                                   | **GAP-1**                                                                                                                                                                                   |
| Staff isolation          | `INT/isolation` › staff B cannot read staff A's profile / cannot list or read staff A's media rows / cannot download, sign or list staff A's storage objects / cannot delete or overwrite staff A's asset (int, user, same venue) · `INT/slice-media` › staff B (same venue) cannot finalise, sign, read, list or delete A's asset (int, user) · `life/lifecycle` › staff cannot remove another staff member's asset at the same venue (404, unchanged) (life, user) · `e2e/slice` › … other staff are denied (thumb/preview/stream/download → 404 over HTTP) · `SEC/access` › media list/select…, §7/§10: <state> objects list/download/sign only when ready, live and authorised (sec, user A/B/C)                                                                             | PASS                                                                   | None                                                                                                                                                                                        |
| Cross-role access        | `e2e/auth` › invited staff… (staff `/admin` → `/staff`) · `e2e/staff-accounts` (staff `/admin/staff` → `/staff`; forged POST `/admin/staff/{id}/avatar` → 403) · `e2e/slice` (staff `/api/media/{id}/download` → 404; anon thumb → 401) · `INT/staff-accounts` › every admin operation refuses an active staff caller with no side effects / signed-out and inactive-admin callers are refused too (int, user/anon) · `INT/privilege` › staff cannot call service-only cleanup or read admin-only rows; anonymous requests see nothing (int, user/anon) · `life/lifecycle` › end users cannot run cleanup or take the lease; POST only, and only with the shared secret · `SEC/access` (whole matrix, incl. anon)                                                                | PASS (e2e FLAKY/UNVERIFIED)                                            | **GAP-11**                                                                                                                                                                                  |
| Original download        | `e2e/slice` (SHA-256 of the downloaded file = source; headers `image/jpeg`, `attachment`, `nosniff`, `private, no-store`) · `INT/slice-media` › a different admin sees it and downloads byte-identical original bytes (+ Range 206) · download filenames always carry the validated extension                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | PASS                                                                   | None for JPEG. Video and HEIC originals are not hash-checked through the route. **journey** covers several types (`got.sha256` per file). **WS1 journey:** `menus.library-filters` (MENUS-QA-13) checks a labelled upload's download SHA-256; results are in `docs/qa/evidence/`. |
| Attribution              | `INT/slice-media` › attribution after a venue transfer › keeps old uploads at venue A and puts new ones at venue B (int, user) · `INT/lifecycle` › snapshots the venue at upload; a transfer does not relabel old assets · `INT/staff-accounts` › venue transfer › applies to future uploads only (int, user admin)                                                                                                                                                                                                                                                                                                                                                                                                                                                              | PASS                                                                   | Small: there is no UI check that the admin viewer still shows "Venue at upload = A" after the transfer. Optional.                                                                           |
| Filters                  | `INT/slice-media` › library pagination and filters › pages 24 at a time with a stable cursor and combined filters (int, user admin) · `e2e/slice` (`/admin?staff=…&type=video` server-side) · `UNIT/components` › LibraryFilters › changes the media type and clears all filters                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | PASS                                                                   | Small (UI-level only): no e2e for the **venue** filter, for clearing filters, or for "load more keeps filters". **journey** and **visual** cover parts of this. **WS1 journey:** `menus.library-filters` (MENUS-QA-12) declares the venue filter, Clear filters and Load more; results are in `docs/qa/evidence/`. |
| Partial batch            | `UNIT/upload-dialog` › shows a per-file failure, keeps the successful file and retries · `UNIT/upload-queue` › isolates a failure and retries with the stored resume token · `UNIT/transport` › idempotency › a retry with the same key reuses the reservation… · `INT/slice-media` › returns the same asset for a repeated key, even concurrently; two concurrent first finalise calls both settle on one ready asset (int, user)                                                                                                                                                                                                                                                                                                                                               | PASS                                                                   | **GAP-5**                                                                                                                                                                                   |
| Interrupted upload       | `UNIT/transport` › resumable (TUS) transfer › resumes an interrupted transfer…; resumes after the storage server is killed mid-transfer; treats 409 'already exists'… (against an in-process `@tus/server`, not Supabase) · `UNIT/queue-adapter` › cancel rejects as AbortError… and retry resumes · `INT/slice-media` › finalise before the bytes arrive keeps the reservation open                                                                                                                                                                                                                                                                                                                                                                                             | PASS                                                                   | **GAP-4**                                                                                                                                                                                   |
| Content validation       | `INT/slice-media` › never marks failed validation ready (disguised, corrupt, wrong kind) (int, user) · re-checks size and type limits on the server (route-level `reserveAsset`, 21 MiB → 400, `.exe` → 400) · `MEDIA/sniff` › rejects disguised and unsupported bytes / size-only cannot approve content / rejects oversized before decoding · `MEDIA/pipeline` (corrupt HEIC, MIME mismatch, malformed containers) · `MEDIA/review` (polyglot, metadata stripping) · `INT/lifecycle` › refuses an uploading asset becoming ready without validation (svc, by design) · `SEC/access` › direct media insert/update/delete cannot bypass…                                                                                                                                         | PASS                                                                   | **GAP-13**                                                                                                                                                                                  |
| Real phone media         | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | NOT RUN                                                                | **BLOCKED (R21)**: needs physical iPhone and Android devices. HEIC is proven only with `synthetic-12mp.heic` / `synthetic-39mp.heic` (`MEDIA/pipeline`, `INT/slice-media` › converts HEIC). |
| Video preview            | `UNIT/components` › MediaViewer › shows the explicit fallback when the browser cannot play the video (jsdom) · `MEDIA/pipeline` › HEVC is accepted as a container with unavailable native preview · `MEDIA/video-review` › real locally encoded HEVC MOV is accepted with fallback; high 10-bit H264 profile is not hinted playable · `INT/slice-media` › probes a video by Range reads and stores its metadata · `e2e/slice` (MP4 uploads to `ready`; no playback check)                                                                                                                                                                                                                                                                                                        | PASS                                                                   | **GAP-3**                                                                                                                                                                                   |
| Deactivation             | `INT/staff-accounts` › deactivation and reactivation › denies the existing session on its next request (app guard + RLS + RPC + refresh token revoked) / keeps retained media visible to admin / reactivation restores access with a new sign-in (int, user) · `INT/accounts` › deactivation blocks an existing session › * incl. an inactive admin loses admin access too (int, user) · `INT/slice-media` › … a deactivated session is refused by the database · `life/lifecycle` › deactivation › keeps the portfolio for admins and blocks the deactivated staff member · `e2e/auth` › a deactivated account is blocked, even with an existing session · `e2e/staff-accounts`                                                                                                 | PASS (e2e FLAKY/UNVERIFIED)                                            | **GAP-18**                                                                                                                                                                                  |
| Deletion                 | `life/lifecycle` › removeMediaAsset › staff removes their own asset: hidden from both views, unsignable, objects gone / is idempotent / admin can remove any…; runMediaCleanup › retries a removal whose storage delete failed, on the next run · `INT/slice-lifecycle` › staff remove their own file from both views; other staff get 404 / an admin removes any file · `INT/lifecycle` › deletion hides the asset at once, is idempotent, and drives retryable cleanup · `e2e/slice` (exact confirmation copy, both views lose it, download 404 afterwards) · `UNIT/components` › ConfirmDeleteDialog uses the exact spec copy                                                                                                                                                 | PASS (life PASS*)                                                      | None in-repo. The cleanup **scheduler** is not deployed (R15, R22).                                                                                                                         |
| Signed-link expiry       | `UNIT/media-config` (`signedUrlExpirySeconds` = 60) · `SEC/access` and `INT/*` sign with `expiresIn: 60` only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | PASS (config only)                                                     | **GAP-2**                                                                                                                                                                                   |
| Empty and failure states | `e2e/slice` (staff empty state copy; admin "Nothing matches these filters.") · `e2e/auth` › a reused or invalid link offers recovery · `e2e/staff-accounts` ("has no uploads yet") · `UNIT/components` › EmptyState, LoginCard › explains an expired link, InviteStaffDialog › reports a partial failure without claiming success, ConfirmDeleteDialog › stays open and shows the server error · `UNIT/upload-dialog` › explains rejected files without adding them                                                                                                                                                                                                                                                                                                              | PASS (e2e FLAKY)                                                       | **GAP-6**                                                                                                                                                                                   |
| Responsive/accessibility | e2e runs every spec at Pixel 7 (412 px) and 1280 px. `UNIT/components` › MediaGrid › renders keyboard-focusable tiles… opens on Enter · `UNIT/upload-dialog` (labelled controls)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | e2e FLAKY                                                              | **GAP-7**                                                                                                                                                                                   |

## 4. Ledger requirements R1–R24

| #   | Requirement (short)                                                    | Tests (see §3 for names)                                                                                                                                                                                                                                                                                                                                                                                          | Real user/anon?                  | Result on 3a23c9b        | Gap                                                                                                                                                                                        |
| --- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | Invite-only, no sign-up, no first-user admin                           | `SEC/access` › public password signup and OTP…; `INT/accounts` › invite-only sign-in › *; `INT/lifecycle` › bootstrap-admin › refuses an email without an existing auth user and never creates one; `INT/staff-accounts` › invite staff › *                                                                                                                                                                       | anon + user                      | PASS                     | none                                                                                                                                                                                       |
| R2  | Magic link, neutral unknown email, expired-link recovery               | `e2e/auth` (all 6); `UNIT/auth` › magic link › *; `UNIT/components` › LoginCard › *                                                                                                                                                                                                                                                                                                                               | real browser, real Mailpit email | E2E-FLAKY                | The **time-expired** link (as opposed to a reused one) is untested on base. In flight: **auth-edges** (`INT/auth-links` › an expired link is refused, sets no session and offers recovery) |
| R3  | Role routing; blocked page                                             | `UNIT/auth` › role routing › *; `e2e/auth` › signed-out…, invited staff… (`/admin` → `/staff`), an admin lands on /admin, a deactivated account is blocked                                                                                                                                                                                                                                                        | real browser                     | unit PASS, e2e FLAKY     | Small: no e2e for an **auth user with no profile** reaching `/auth/blocked` (covered at int level by `INT/accounts`)                                                                       |
| R4  | Staff edit only name and avatar                                        | `INT/privilege` › *; `SEC/access` › protected-column matrix; `INT/staff-accounts` › staff cannot escalate…; `e2e/slice` › staff edit their own name and profile photo                                                                                                                                                                                                                                             | user                             | PASS (privilege PASS*)   | Part of GAP-11 (`/api/profile` HTTP body tamper)                                                                                                                                           |
| R5  | Venue snapshot; transfer keeps history                                 | `INT/slice-media` › attribution…; `INT/lifecycle` › snapshots the venue…; `INT/staff-accounts` › venue transfer › *                                                                                                                                                                                                                                                                                               | user                             | PASS                     | UI label check is optional (§3 Attribution)                                                                                                                                                |
| R6  | Staff and admin views reference one asset                              | `INT/slice-media` › staff A sees the asset… + a different admin sees it… (same `assetId`); `e2e/slice` (same row; deletion removes it from both views)                                                                                                                                                                                                                                                            | user                             | PASS                     | none                                                                                                                                                                                       |
| R7  | Library refresh ~15 s and on focus                                     | none                                                                                                                                                                                                                                                                                                                                                                                                              | —                                | NOT TESTED               | **GAP-1**                                                                                                                                                                                  |
| R8  | Batch 10, 2 parallel, retry, idempotent, resumable                     | `UNIT/upload-queue` › runs at most maxParallelUploads transfers at once; rejects … over-limit files; does not count finished files against the batch limit · `UNIT/transport` › * · `UNIT/queue-adapter` › * · `INT/slice-media` › reserve (idempotent key) + finalise (concurrent) · `UNIT/media-config` (limits)                                                                                                | user (int)                       | PASS                     | **GAP-4**, **GAP-5**                                                                                                                                                                       |
| R9  | Limits enforced on the server                                          | `UNIT/media-config` › matches the chosen product limits · `INT/slice-media` › re-checks size and type limits on the server · `MEDIA/sniff` › rejects oversized before decoding · `INT/staff-accounts` › profile photo › rejects oversized and undecodable photos (admin avatar path)                                                                                                                              | user                             | PASS                     | **GAP-13**                                                                                                                                                                                 |
| R10 | Image formats and derivatives; server-side validation                  | `MEDIA/pipeline` › decodes {jpeg,png,webp}…, decodes synthetic 12MP HEIC with WASM, HEIC corrupt/truncated… · `MEDIA/heic-memory` · `MEDIA/review` › * · `INT/slice-media` › converts HEIC… / never marks failed validation ready…                                                                                                                                                                                | n/a, user                        | PASS                     | Deployed decoder BLOCKED (R22). Physical phones BLOCKED (R21)                                                                                                                              |
| R11 | MP4/MOV/WebM validated; playback or fallback                           | `MEDIA/pipeline` › probes real synthetic {mp4,mov,webm} · `MEDIA/video-review` › * · `UNIT/components` › MediaViewer fallback                                                                                                                                                                                                                                                                                     | n/a                              | PASS                     | **GAP-3**                                                                                                                                                                                  |
| R12 | Original bytes; admin download hash-equal                              | `e2e/slice` (sha256) · `INT/slice-media` › … byte-identical original bytes                                                                                                                                                                                                                                                                                                                                        | user, real browser download      | PASS (e2e FLAKY)         | none (other types: journey)                                                                                                                                                                |
| R13 | Private buckets; no cache or image-route leaks; short signed links     | `SEC/access` (object matrix per state) · `e2e/slice` (download and thumb `Cache-Control: private, no-store`, `nosniff`) · `INT/slice-media` (download headers). `next/image` is deliberately not used (`components/nabalens/media-tile.tsx:62`, `media-viewer.tsx:96`)                                                                                                                                            | user/anon                        | PASS                     | **GAP-2**; preview/stream/avatar headers in **GAP-11**                                                                                                                                     |
| R14 | Deactivation blocks sessions; reactivation; admin keeps media          | §3 Deactivation                                                                                                                                                                                                                                                                                                                                                                                                   | user                             | PASS                     | **GAP-18**                                                                                                                                                                                 |
| R15 | Deletion hides both views, denies grants, retried cleanup              | §3 Deletion                                                                                                                                                                                                                                                                                                                                                                                                       | user (+svc cleanup, by design)   | PASS*                    | Scheduler not deployed (R22). See **GAP-5b** (stuck `processing`)                                                                                                                          |
| R16 | Staff isolation, including the same venue                              | §3 Staff isolation                                                                                                                                                                                                                                                                                                                                                                                                | user, anon                       | PASS                     | none                                                                                                                                                                                       |
| R17 | Invitations: duplicate, resend, partial failure, no duplicates         | `INT/staff-accounts` › invite staff › refuses a duplicate email…, concurrent invitations for one email create exactly one account, an email failure is reported as partial and recovered by resend, a retry adopts an auth user left without a profile…, does not adopt an unrelated…; resend invitation › * · `e2e/staff-accounts` (duplicate refused in the UI) · `UNIT/components` › InviteStaffDialog partial | user (admin)                     | int PASS; e2e UNVERIFIED | none (e2e rerun)                                                                                                                                                                           |
| R18 | Combined filters, stable cursor, empty states                          | `INT/slice-media` › pages 24 at a time with a stable cursor and combined filters · `INT/staff-accounts` › pages one person's ready media newest first · `e2e/slice` (URL filters, empty filter state)                                                                                                                                                                                                             | user                             | PASS                     | UI-level only (§3 Filters) **WS1 journey:** `menus.library-filters` (MENUS-QA-12); results are in `docs/qa/evidence/`. |
| R19 | Responsive 360/390/768/1280/1440, keyboard, focus, labels, no overflow | e2e at 412 and 1280 only; jsdom keyboard test for tiles                                                                                                                                                                                                                                                                                                                                                           | —                                | NOT TESTED as specified  | **GAP-7**                                                                                                                                                                                  |
| R20 | Chromium, Firefox and WebKit on desktop                                | `playwright.config.ts` defines Chromium-only projects (`mobile` = Pixel 7, `desktop` = Desktop Chrome)                                                                                                                                                                                                                                                                                                            | —                                | NOT TESTED               | **GAP-8**                                                                                                                                                                                  |
| R21 | Physical iPhone/Android                                                | none                                                                                                                                                                                                                                                                                                                                                                                                              | —                                | BLOCKED                  | human device test                                                                                                                                                                          |
| R22 | Staging, real email, deployed decoder, cleanup schedule                | none (local only)                                                                                                                                                                                                                                                                                                                                                                                                 | —                                | BLOCKED                  | owner chose local-only                                                                                                                                                                     |
| R23 | Scope: two interfaces, no excluded workflows                           | no automated test. Manual audit in `docs/reviews/wave3-review.md` (branch `review/nl-wave3`, at `078b60a`): "None found". This run's `pnpm build` lists only the routes in §1                                                                                                                                                                                                                                     | —                                | MANUAL ONLY              | **GAP-16**                                                                                                                                                                                 |
| R24 | Secure first-admin bootstrap                                           | `INT/lifecycle` › bootstrap-admin › refuses an email without an existing auth user and never creates one / promotes an existing staff account and is idempotent / creates an admin profile for an invited user without one                                                                                                                                                                                        | runs the script (svc by design)  | PASS                     | none                                                                                                                                                                                       |

## 5. Brief §4–§5 bullets not already covered above

| Brief bullet                                                                                                                                     | Tests                                                                                                                                                                                                                                                                                                                                  | Result                        | Gap                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------- |
| §4 10 files/batch, 2 parallel, 20 MiB / 200 MiB / 5 MiB                                                                                          | `UNIT/media-config` › matches the chosen product limits / picks the per-kind byte limit · `UNIT/upload-queue` › * · `INT/slice-media` › re-checks size…                                                                                                                                                                                | PASS                          | GAP-13 (bucket limits, 200 MiB real video, own-avatar 5 MiB)                                      |
| §4 "Verify provider/bucket limits"                                                                                                               | none on base                                                                                                                                                                                                                                                                                                                           | —                             | GAP-13                                                                                            |
| §4 HEIC/HEIF through a verified deployable decoder                                                                                               | `MEDIA/pipeline`, `MEDIA/heic-memory`, `INT/slice-media` › converts HEIC…; `docs/fanout/STATUS.md` (worker chunk traced under `next build`, macOS arm64 only)                                                                                                                                                                          | PASS (local)                  | Deployed decoder BLOCKED (R22)                                                                    |
| §4 Preserve originals, lightweight previews, validate content not extensions                                                                     | see R10, R12, Content validation                                                                                                                                                                                                                                                                                                       | PASS                          | —                                                                                                 |
| §4 Private storage, resumable transfers                                                                                                          | `SEC/access`; `UNIT/transport`                                                                                                                                                                                                                                                                                                         | PASS                          | GAP-4                                                                                             |
| §4 Server-generated IDs/paths; owner/venue from trusted data; idempotent finalise                                                                | `INT/slice-media` › derives owner, venue, id and key on the server; validates the stored JPEG… and is idempotent; two concurrent first finalise calls…; `SEC/access` › <actor> reservation derives owner/venue and deletion enforces owner-or-admin; `INT/lifecycle` › keeps owner, venue and keys immutable even for the service role | PASS                          | —                                                                                                 |
| §4 Retry a failed file without duplicating successful assets                                                                                     | see Partial batch                                                                                                                                                                                                                                                                                                                      | PASS                          | GAP-5                                                                                             |
| §4 Real uploading/processing/ready/failure states                                                                                                | `UNIT/upload-queue` › reports progress, then processing, then done · `UNIT/queue-adapter` › reports progress, switches to processing and resolves when ready · `UNIT/transport` › reports processing failure from the server                                                                                                           | PASS                          | GAP-5b (stuck `processing`), GAP-4 (reopen distinguishes completed, incomplete and failed)        |
| §4 Checks in every server action/API and in DB/storage policies                                                                                  | `INT/staff-accounts` › every admin operation refuses…; `SEC/access`; `life/lifecycle` › answers 404 for unknown or malformed IDs and 401 without a session                                                                                                                                                                             | PASS                          | GAP-11 (`/api/avatars`, `/api/profile`, preview/stream headers)                                   |
| §4 Privileged credentials server-only                                                                                                            | none                                                                                                                                                                                                                                                                                                                                   | —                             | **GAP-17**. In flight: **privacy** (`scripts/ci/scan-bundle.mjs`, a client bundle secret scanner) |
| §4 Staff cannot modify role, venue, activation, owner, keys or validation state                                                                  | R4; `INT/privilege` › staff cannot insert, re-own or validate media rows directly / cannot upload to an unreserved key…                                                                                                                                                                                                                | PASS                          | —                                                                                                 |
| §4 Avoid leaking via caches or public image routes                                                                                               | R13                                                                                                                                                                                                                                                                                                                                    | PASS                          | GAP-11                                                                                            |
| §4 Snapshot venue                                                                                                                                | R5                                                                                                                                                                                                                                                                                                                                     | PASS                          | —                                                                                                 |
| §4 Deactivation blocks existing sessions                                                                                                         | R14                                                                                                                                                                                                                                                                                                                                    | PASS                          | GAP-18                                                                                            |
| §4 Staff remove own, admin any; hide in both views; deny grants; retry cleanup                                                                   | §3 Deletion                                                                                                                                                                                                                                                                                                                            | PASS                          | —                                                                                                 |
| §4 Acknowledge existing signed links and downloads are not recalled                                                                              | `UNIT/components` › ConfirmDeleteDialog uses the exact spec copy; `e2e/slice` (copy visible); `docs/cleanup.md`                                                                                                                                                                                                                        | PASS                          | GAP-2 (lifetime of existing links is unbounded today)                                             |
| §4 Warn before navigating away from active uploads (spec §5)                                                                                     | `UNIT/transport` › beforeunload guard › prompts only while uploads are active and can be removed; the uploader reports its active count                                                                                                                                                                                                | PASS (unit)                   | **GAP-19**                                                                                        |
| §5 Separate staff identities, an admin, direct API/storage access                                                                                | `SEC/access` (A, B, C, admin, inactiveStaff, inactiveAdmin, anonymous)                                                                                                                                                                                                                                                                 | PASS                          | —                                                                                                 |
| §5 Privilege escalation, venue transfers, duplicate retries, partial failures, deletion, deactivation, original-byte downloads, combined filters | see R4, R5, R8, §3                                                                                                                                                                                                                                                                                                                     | PASS                          | GAP-5                                                                                             |
| §5 Run lint, type, unit/integration, build and e2e                                                                                               | §1                                                                                                                                                                                                                                                                                                                                     | all ran; e2e flaky under load | rerun e2e on a quiet machine                                                                      |
| §5 Verify the journey at mobile and desktop widths                                                                                               | e2e projects `mobile` (412) and `desktop` (1280)                                                                                                                                                                                                                                                                                       | E2E-FLAKY                     | GAP-7                                                                                             |
| §5 Record physical-phone checks separately                                                                                                       | none                                                                                                                                                                                                                                                                                                                                   | BLOCKED                       | R21                                                                                               |
| §5 Bootstrap the first admin securely; public account creation disabled                                                                          | R24, R1                                                                                                                                                                                                                                                                                                                                | PASS                          | —                                                                                                 |

## 6. Gaps to dispatch

Wave-3 coverage comes from each branch's commits and handoff file, because no wave-3
**prompts** exist in `docs/fanout/` on this branch. Where a branch has neither, the
entry says "unknown". The in-flight branches are:

- **journey** (`feat/nl-journey` @ 4c97963)
- **visual** (`feat/nl-visual` @ 23c46f1)
- **library** (`feat/nl-library` @ f3ee17b)
- **auth-edges** (`feat/nl-authedge` @ 66099f2)
- **uploads** (`feat/nl-uploads` @ 84bab92)
- **ci** (`feat/nl-ci` @ 2f389c4)

Two further branches are also in flight: **load** and **privacy**.

**GAP-1: Admin foreground refresh (§10 Admin availability, R7).**

- _Missing on base:_ no test checks this. Open `/admin` as admin B and leave it open.
  Have the staff member finish an upload in another browser context. Then assert that
  the tile appears **without navigation or reload** within ≤ 15 s plus a margin. A
  second assertion is also missing: dispatch `focus` / `visibilitychange` with the
  interval paused (for example `page.clock`), and assert that the tile appears
  promptly. Relevant code: `app/_media/media-gallery.tsx:119-128` and
  `app/admin/admin-library.tsx:24`.
- _In flight:_ **journey** (`tests/e2e/journey.spec.ts`, `REFRESH_WINDOW = 25 s`,
  "without reload") covers the interval. I didn't see the focus trigger, so for that
  part coverage is unknown.

**GAP-2: Signed-link expiry and lifetime (§10 Signed-link expiry, R13).**
Three assertions are missing on base:

1. The redirect target of `/api/media/{id}/thumb|preview` carries an expiry of
   ≤ 60 s. Decode the token's `exp`.
2. A link fetched after its expiry returns 4xx, and the UI then recovers with a fresh
   authorised URL. For example, open the viewer, advance the clock past 60 s, and
   check that the image still loads.
3. Review finding 1 (`docs/reviews/wave3-review.md`, MEDIUM) has no test: a staff or
   admin JWT can call `storage.from("media").createSignedUrl(path, 31536000)`
   directly. Assert that this is refused, and that a link minted before
   deactivation or the tombstone stops working.

_In flight:_ **library** added "recover expired previews" code
(`app/_media/preview-recovery.ts`) but no new test that I could see. **auth-edges**
covers session expiry, not signed links. Parts 1 and 3 are not covered, so dispatch
them, including the SQL fix for finding 1.

**GAP-3: Real-browser video playback (§10 Video preview, R11).**

- _Missing on base:_ a real browser does not play the uploaded H.264 MP4 and the WebM.
  Assert `video.readyState >= 2` or that `currentTime` advances while muted. For a
  HEVC MOV, assert that the viewer shows exactly "Preview unavailable in this
  browser" **and** that "Download original" still works. Also assert that videos
  never autoplay with sound (§4). Do this per engine.
- _In flight:_ **uploads**, whose goal lists a "video playback matrix", but its e2e
  `upload-recovery.spec.ts` is still in progress. **ci** has a browser matrix
  wrapper. Treat this as partial or unknown.

**GAP-4: Interrupted upload against real Supabase TUS, and reopen states (§10 Interrupted upload, R8).**

- _Missing on base:_ TUS resume is tested only against an in-process `@tus/server`.
  Four assertions are missing:
  1. A transfer to the local stack's `/storage/v1/upload/resumable` is interrupted
     mid-file and resumes from the server offset. Count bytes sent after the resume.
  2. In e2e, while a video is uploading, go offline and back online, or reload.
     Choosing the file again resumes the same asset.
  3. After a reload, the portfolio distinguishes completed, incomplete and failed
     files (spec §5).
  4. An unrecoverable case, such as a removed reservation, shows the required action.
- _In flight:_ **uploads** covers parts of this. `INT/upload-limits` has "TUS resume
  from offset" on the local stack. `UNIT/upload-keys` has "choosing the same file
  after a reload reuses the asset and resumes the transfer" and "a removed
  reservation fails once with a clear reason". `e2e/upload-recovery.spec.ts` is in
  progress. Assertion 3 is unknown.

**GAP-5: Partial batch in the real app (§10 Partial batch).**

- _Missing on base:_ in e2e, upload a batch of two valid photos plus one disguised or
  corrupt file through the real dialog. Assert that:
  - the two photos reach `ready`;
  - the bad file shows a per-file failure, and the others are unaffected;
  - "Retry" on a transiently failed file (for example with `page.route` aborting the
    first PUT) gives **exactly one** row per file. Count by `uploader_id` and
    `original_filename`.
- _In flight:_ **uploads** integration covers the retry and duplicate case
  (`INT/upload-recovery` › retry after a network failure ›*), and its e2e is in
  progress. **journey** uploads a mixed set but has no failing file. Treat as partial.

**GAP-5b: Stuck `processing` (review finding 3, MEDIUM).**

- _Missing:_ an asset left in `processing` by a crashed finalise, aged past the window
  with psql, must be failed or cleaned by `prepare_media_cleanup` or
  `runMediaCleanup`. It must not stay "Processing" forever.
- _In flight:_ unknown, and it is not in any handoff I found. Dispatch it, including
  the fix in `supabase/migrations/*_nabalens_media_cleanup.sql`.

**GAP-6: Failure states (§10 Empty and failure states).**

- _Missing on base:_ three e2e assertions:
  1. Upload while `context.setOffline(true)`: a usable per-file error with "Retry",
     and no false "uploaded".
  2. A failed download (route 404 or 500 via `page.route`): the viewer shows a usable
     error, not a blank tab or raw JSON.
  3. An admin library first load with zero assets shows the library's empty state.
- _In flight:_ **visual** has state screenshots (login states, blocked page, upload
  dialog states, empty filter result), but I saw neither offline nor failed-download
  states. Treat as partial.

**GAP-7: Responsive and accessibility at the QA widths (§10, R19).**

- _Missing on base:_
  - widths 360, 390, 768 and 1440;
  - axe with no serious or critical issues;
  - no horizontal overflow;
  - visible focus on every tab stop;
  - dialogs trap focus and return it;
  - primary actions are not hover-only.
- _In flight:_ **visual** (`tests/e2e/visual.spec.ts`) has `QA_WIDTHS = [360, 390, 768,
1280, 1440]`, `@axe-core/playwright` at WCAG 2.2 AA, and overflow and keyboard
  focus checks. It should cover this in full once merged and run.

**GAP-8: Cross-browser coverage (R20).**

- _Missing on base:_ Firefox and WebKit projects.
- _In flight:_ **journey** (`playwright.config.ts` adds `firefox`, `webkit` and
  `mobile-chromium`), **ci** (matrix configured, but Firefox and WebKit NOT RUN
  locally per its handoff) and **visual**.

**GAP-11: HTTP-level cross-role and header checks (§10 Cross-role access, R4, R13).**
Five assertions are missing on base:

1. As staff B, GET `/api/avatars/{staffA}` → 404 or 403. As anon → 401.
2. POST `/api/profile` with `role`, `venue_id`, `active` or `job_title` in the body
   changes nothing. With a foreign `Origin`, it is refused. This is review finding 7,
   LOW.
3. `/api/media/{id}/preview` and `/stream` send `Cache-Control: private, no-store`
   and `nosniff`. Only download and thumb are asserted today.
4. Staff GET `/admin/staff/{id}` for another staff member's ID → redirected to
   `/staff` with no data in the HTML.
5. Staff calling `listLibrary` or the `app/admin/library-actions.ts` Server
   Functions directly → refused.

_In flight:_ **auth-edges** has "pages, Server Functions and routes treat it as
signed out and return no data" (for an expired session, not cross-role). The rest is
unknown, so dispatch it.

**GAP-12: Staff at an inactive venue, at route and UI level (§10 Account setup).**

- _Missing on base:_ two assertions:
  - `reserveAsset` or `reserveUpload` for active staff whose venue is inactive
    returns `ok: false` (route level; only the DB RPC is tested now);
  - `/staff` for that person hides "Upload photos or videos" and shows the setup
    message.
- _In flight:_ **visual** has "staff: long name and paused venue", a screenshot that
  may or may not assert that the Upload button is absent. Unknown.

**GAP-13: Storage-level limits and own-avatar size (§10 Content validation, R9, brief "verify provider/bucket limits").**

- _Missing on base:_ five assertions:
  - the bucket `file_size_limit` and `allowed_mime_types` are as configured;
  - storage refuses 1 byte over the limit even with a valid signed URL;
  - bytes larger than the declared size never become `ready`;
  - a real 200 MiB video completes;
  - the staff **own** avatar path (`/api/profile`, `updateOwnProfile`) rejects more
    than 5 MiB. Only the admin path is tested.
- _In flight:_ **uploads** (`INT/upload-limits` › buckets are private with the
  configured size and type limits; storage itself refuses one byte over the limit…;
  a 200 MiB TUS case; `INT/upload-recovery` › an oversized photo is refused at
  reserve, and bytes smuggled past a small declared size fail). The own-avatar 5 MiB
  check is unknown.

**GAP-16: Scope guard (R23).**

- _Missing:_ an automated check that the built route list (from `pnpm build` or a
  filesystem scan of `app/**/page.tsx` and `route.ts`) equals the allowed set in §1,
  and that the source has no approval, task, comment, like, tag or ZIP feature. An
  allow-list test is enough.
- _In flight:_ `review/nl-scope` exists at `3a23c9b` with no commits. Unknown.

**GAP-17: No secrets in client bundles (brief §4).**

- _Missing on base:_ a check that nothing under `.next/static` contains the service
  role key or `SUPABASE_SERVICE_ROLE_KEY`.
- _In flight:_ **privacy** (`scripts/ci/scan-bundle.mjs`).

**GAP-18: Deactivation versus pre-issued upload tokens (review finding 4, LOW).**

- _Missing:_ a signed upload URL or TUS session obtained before deactivation, or before
  the tombstone, must be refused afterwards. Alternatively, record this as an accepted
  limitation next to signed reads.
- _In flight:_ **uploads** owns the transport. Unknown.

**GAP-19: Leave warning wired in the app (spec §5).**

- _Missing on base:_ an e2e test where, during an active upload,
  `page.on("dialog")` sees a `beforeunload` prompt on navigation, and sees none when
  idle. Only the unit guard is tested now.
- _In flight:_ unknown.

**E2E-RERUN: quiet-machine rerun.**

- Rerun `tests/e2e/*.spec.ts` with fewer concurrent stacks. The triage item in §1.1
  (`staff-accounts.spec.ts` on mobile, status not updating after deactivate) must
  pass or be fixed before R14 and R17 can be marked VERIFIED at e2e level.

### Gaps that are not test gaps (blocked)

- **R21:** physical iPhone and Android capture, HEIC and video.
- **R22:** staging, real SMTP, the deployed HEIC decoder, and the cleanup schedule.
- The cleanup scheduler (R15) is not deployed.

## 7. Proposed ledger updates (for the lead)

These are proposals only. This track does not edit `docs/release/LEDGER.md`.

- **Check runs:** add the rows in §1 with environment "isolated `nabalens-acceptance`
  stack (515xx), machine load 28–39" and revision `3a23c9b`.
- **R1, R16 and R24:** the evidence holds at int and sec level, so these qualify as
  VERIFIED by the lead's re-run criterion. R1's e2e part still needs a quiet rerun.
- **R4, R5, R6, R12 and R18:** IMPLEMENTED → VERIFIED at the int level. The UI-level
  extras are optional (§3).
- **R7:** IN PROGRESS → IMPLEMENTED (code in `app/_media/media-gallery.tsx`), but
  **untested**. GAP-1.
- **R13:** keep it IMPLEMENTED and add the blocker "GAP-2 / review finding 1:
  user-minted signed URLs of any lifetime".
- **R14 and R15:** VERIFIED at int and life level. R14's e2e part is pending
  E2E-RERUN.
- **R17:** VERIFIED at int level, pending E2E-RERUN.
- **R19 and R20:** keep IN PROGRESS. Visual and journey cover them.
- **R23:** add the evidence "manual audit wave3-review; no automated guard (GAP-16)".

## 8. How to reproduce

```sh
W=/tmp/nabalens-acceptance-stack
mkdir -p $W/supabase && rsync -a --exclude .temp --exclude .branches supabase/ $W/supabase/
# In $W/supabase/config.toml: project_id = "nabalens-acceptance", 554xx -> 515xx,
# enabled = false for [studio] [realtime] [analytics] [edge_runtime]
# [storage.vector] [storage.s3_protocol]  (keep [local_smtp] for e2e).
supabase --workdir $W start
# Export NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
# SUPABASE_SERVICE_ROLE_KEY, MAILPIT_URL, NABALENS_TEST_DB_URL from
# `supabase --workdir $W status -o json` (never print the keys).
pnpm test
pnpm exec vitest run --project integration
node tests/security/run.mjs $W
node tests/lifecycle/run.mjs $W
E2E_PORT=3617 pnpm exec playwright test
pnpm build
supabase --workdir $W stop --no-backup
```
