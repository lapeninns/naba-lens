# NabaLens final pre-release review

- **Range:** `git diff 3e0a499..5d28d64` on `feat/nabalens-mvp` (visual, followups and auth-edges, plus their merges). Secfix, uploads, journey and load were merged before `3e0a499`. Their conflict resolutions in `finalise.ts`, `access.ts` and `admin-library.tsx` were reviewed as well (merges `3fd04cc`, `1c5db9b`, `9fc4d95`).
- **Date:** 2026-10-30. Branch `review/nl-final`, head `5d28d64`. Only this file is committed. No application code was changed.
- **Method:**
  - `code-review` skill at high effort over the range.
  - A manual security review. The `security-review` skill could not run because it needs `origin/HEAD`, which this worktree does not have; its focus list was covered by hand.
  - Every suspicion was confirmed or refuted with a test on an isolated slim stack. Details are in the Evidence section.

## Verdict

**Release-blocking findings: YES. All three are in tests or CI; none is in product code or security.**

The merged head `5d28d64` fails its own release gate:

- `pnpm test:integration` has 1 failure (F1).
- The new CI `privacy-runtime` step fails (F2).
- `pnpm test:visual` is broken (F3).

All three are semantic merge conflicts. The followups and visual branches were written against the old one-step `GET /auth/confirm` sign-in or the old Server Function result shape. Auth-edges changed both. Each fix is a few lines of test code, and I checked that fixing F1 and F2 makes them pass (F3 is the same pattern).

`lci` on this head would be red, so it cannot merge through the required gate until these are fixed.

On the application side I found **no security defect**:

- `/auth/confirm` is not an open redirect, needs a same-origin POST, and is single-use.
- The role guard returns real 307s.
- A profile-read outage never grants access.
- The degraded accounts view never changes what anyone can do.

The remaining findings are robustness and UX issues worth fixing soon. None blocks release.

## Findings, ranked

| #   | Severity                 | Where                                                                  | Status                         |
| --- | ------------------------ | ---------------------------------------------------------------------- | ------------------------------ |
| F1  | Blocking (CI)            | `tests/integration/auth-links.test.ts:369`                             | Confirmed                      |
| F2  | Blocking (CI)            | `tests/integration/privacy-runtime.test.ts:159-174`                    | Confirmed                      |
| F3  | Blocking (release check) | `tests/e2e/visual.spec.ts:88-110`                                      | Confirmed                      |
| F4  | Medium (availability/UX) | `app/admin/layout.tsx:18`, `app/staff/layout.tsx:14`                   | Confirmed                      |
| F5  | Low-Medium (degradation) | `app/_media/media-gallery.tsx:129`                                     | Confirmed (code + Next source) |
| F6  | Low (observability)      | `lib/server/media/context.ts:32`                                       | Confirmed                      |
| F7  | Low                      | `app/auth/confirm/verify/route.ts:12-24`                               | Confirmed (code)               |
| F8  | Low (load)               | `lib/server/accounts/auth-users.ts:57`                                 | Confirmed (code)               |
| F9  | Low (load)               | `app/admin/staff/account-controls.tsx:138,237`, `lib/auth/index.ts:27` | Confirmed (code)               |
| F10 | Low (legacy data only)   | `scripts/bootstrap-admin.ts:104`                                       | Plausible                      |
| F11 | Informational            | `scripts/ci/privacy-runtime.mjs` readiness probe                       | Plausible                      |
| R1  | —                        | `lib/server/accounts/directory.ts:180` (404 seen as outage)            | Refuted                        |

### F1. The integration suite is red on the merged head

- **What:** `tests/integration/auth-links.test.ts:369`, "session expiry › pages, Server Functions and routes treat it as signed out", expects `loadMyMedia(null)` to equal `{ ok: false, message }`.
  - Followups (`f68d80d`) added `status` to every staff Server Function failure (`app/staff/actions.ts:60`).
  - Auth-edges wrote the test before that and merged after.
- **Failure:** `pnpm test:integration` gives 201 passed, **1 failed**, 12 skipped. The CI `database-and-browser` step fails.
- **Evidence:** a full integration run on the isolated stack. Diff: `+ "status": 401`. Adding `status: 401` to that expectation gives auth-links 14/14 (verified, then reverted).
- **Fix:** add `status: 401` at line 371. The app behaviour is correct.

### F2. The CI privacy step can never pass on the merged head

- **What:** `tests/integration/privacy-runtime.test.ts` `signInOverHttp` signs in with one `GET /auth/confirm?...` and expects `303 /`.
  - Since auth-edges, that GET returns the 200 Continue page by design: a GET must not use up the token.
  - Followups (`6021d3a`) wired this suite into `scripts/ci/local-ci.sh` as a strict step (11 passed, 0 skipped required) before auth-edges merged.
- **Failure:** `node scripts/ci/privacy-runtime.mjs <W>` prints `expected 200 to be 303` in `beforeAll`, then `privacy-runtime: 0 passed, 0 failed, 11 skipped: FAIL`, exit 1. The step's strictness works: it fails rather than skipping silently.
- **Evidence:** I ran the step itself against the isolated stack. Then I patched only `signInOverHttp` to GET the page (expect 200) and POST `/auth/confirm/verify` with same-origin headers. Result: **11 passed, 0 skipped: PASS**, including "prints no tokens, signed URLs, keys or emails to the server log" with the new Continue page (verified, then reverted).
- **Fix:** that helper change. Privacy itself is fine on the merged head.

### F3. `pnpm test:visual` is broken on the merged head

- **What:** `tests/e2e/visual.spec.ts` `signIn` (lines 88-110) does `page.goto('/auth/confirm?...')` and returns without pressing **Continue**. Every test that signs in then expects `/staff`, `/admin` or `/auth/blocked`.
- **Failure:** `pnpm test:visual <W> --no-build --project chromium -g "staff: empty portfolio"` fails at `:491` `toHaveURL(/\/staff$/)`; the page is still on `/auth/confirm`.
- **Impact:** not in `local-ci.sh` (it needs `NABALENS_VISUAL`), so it is not a CI gate. But the visual and accessibility release check cannot be re-run.
- **Fix:** click Continue and wait to leave `/auth/confirm`, as `tests/library/e2e.ts:28-30` already does.

### F4. A profile-read failure in the new layout gates skips the app's error UI

- **What:** `app/admin/layout.tsx:18` and `app/staff/layout.tsx:14` call `requireActive*()`. That calls `getAuthState()` → `loadProfile()`, which throws on a database error (`lib/auth/profile.ts:51`).
  - A segment's `error.tsx` does not wrap that segment's own `layout.tsx` (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md:96`).
  - There is no `app/error.tsx` or `app/global-error.tsx`.
- **Failure:** during a PostgREST or database blip, `/admin` and `/staff` return **500** with Next's bare error document. Before, the page's own throw rendered `app/admin/error.tsx` ("The library could not load", **Try again**).
- **Evidence:** I made `public.profiles` unreachable on the isolated stack (renamed, schema reloaded) and fetched from a real `next start`:
  - `/admin` as admin, `/staff` as staff and `/admin` as staff all returned `500`. None contained the app's "could not load / Try again" UI.
  - In-process, `AdminLayout` threw `Could not load profile: PGRST205`.
- **Security:** none. It fails closed: no 200, no data. Access was restored after renaming the table back (`/staff` 200).
- **Fix (suggested):** add `app/error.tsx` (and optionally `global-error.tsx`), or catch `loadProfile` errors in the layouts and render the same retry UI.

### F5. Timed-out gallery refreshes pile up in Next's serial action queue

- **What:** `app/_media/media-gallery.tsx:129` races `loadPage(null)` against a 10 s timer, then clears `refreshing` in `finally`.
  - The Server Function call is not cancelled; the comment says so, and no `AbortController` is used because Server Functions take no signal.
  - Next's client runs Server Functions one at a time (`node_modules/next/dist/client/components/app-router-instance.js:39-95`, `runRemainingActions`).
- **Failure:** while the server is slow for more than 10 s:
  - Each 5 s tick (staff with pending uploads, `:166`), 15 s tick (admin) or focus event queues another `loadMyMedia` or `loadLibraryPage` behind the stuck one.
  - Each new call's timer also starts while it waits in the queue, so it "times out" too.
  - `reserveUpload` and `finaliseUpload` wait behind the whole queue. On recovery, the queued reads all run.
- **Before the change:** the guard stayed set, so at most one refresh was ever queued.
- **Fix (suggested):** keep `refreshing` set until the abandoned call actually settles (still show the error at 10 s), or skip interval refreshes while one is still in flight.

### F6. The 503 path in `getMediaActor` swallows every error without logging

- **What:** `lib/server/media/context.ts:32` turns any exception from `getAuthState()` into `503 "Could not check your account right now"`. That includes config errors such as missing env, `createClient` failures and programming bugs. Nothing is logged.
- **Evidence:** during the outage test, `/api/media/:id/download` returned `503` with `retry-after: 5`, and `/api/profile` returned `503`. Both are correct and fail closed. The only `⨯ Could not load profile` server-log lines came from page renders.
- **Fix (suggested):** `console.error` the cause (no identifiers), or catch only the profile-load error.

### F7. `/auth/confirm/verify` duplicates the shared same-origin helper

- **What:** `app/auth/confirm/verify/route.ts:12-24` re-implements `lib/server/http/same-origin.ts` `isSameOriginRequest`, without its comma-split and lower-casing of `X-Forwarded-Host`/`Host`.
- **Failure:** only for a browser that sends no `Sec-Fetch-Site` header (old Safari before 16.4) behind a proxy that sends a list in `X-Forwarded-Host` or mixed-case `Host`. That user gets `403 Forbidden.` on Continue.
- **Not a security issue:** the check is no weaker.
- **Fix:** call `isSameOriginRequest(request.headers)`.

### F8. The `listUsers` page loop keeps running after the 4 s deadline

- **What:** `lib/server/accounts/auth-users.ts:57`. `withAuthDeadline` stops waiting, but the loop has no cancelled flag. It keeps fetching up to `MAX_PAGES`=20 pages from an already slow GoTrue.
- **Impact:** with fewer than 1000 users it is one page, so the effect is small today.
- **Fix:** check a `timedOut` flag between pages.

### F9. Extra re-renders and auth reads on admin pages

- **What:**
  - `account-controls.tsx`: `saveEdit` with an activation change calls `router.refresh()` twice, at `:138` via `confirmStatus` and at `:237` in `finally`. The action has already called `revalidatePath`.
  - The new layouts add a third uncached `getAuthState()` (claims plus a profile query) per `/admin*` and `/staff` render (`lib/auth/index.ts:27`).
- **Impact:** extra load under the very slowness auth-edges works around. Not a correctness issue.
- **Fix:** wrapping `getAuthState` in React `cache()` keeps "fresh per request" and drops the duplicate reads.

### F10. `bootstrap:admin` leaves a ban on an already-active admin

- **What:** `scripts/bootstrap-admin.ts:104` returns `already_admin` before `liftDeactivationBan`.
- **When it matters:** only for an admin that is active in `profiles` but banned in Auth. That state only arises if the old script promoted a deactivated staff account. The app never deactivates admins (`manage.ts:37`).
- **Impact:** pre-release, so no production data should be affected. The script also now has a second, unbounded `findAuthUserByEmail` (`:24`) that duplicates the lib version with the same name.

### F11. The privacy step's readiness probe accepts any server on the port

- **What:** `scripts/ci/privacy-runtime.mjs` polls `/login` on `E2E_PORT` and does not check that its own child is the server answering.
- **Failure:** if Playwright's server outlived the e2e step, `next start` would exit with `EADDRINUSE` and the suite would run against the old server.
- **Why it is not silent:** the log assertion would then read an empty log. But the cleanup test uses a fresh `CLEANUP_SECRET`, so it would fail rather than pass falsely.
- **Fix:** fail if `server.exitCode !== null` after the probe.

### R1. Refuted: a deleted Auth user shows a permanent "Sign-in details unavailable" banner

`lib/server/accounts/directory.ts:180` treats any `getUserById` error as an outage, including a 404. But `profiles.id` references `auth.users(id) on delete cascade` (`supabase/migrations/20261029120000_nabalens_schema.sql:43`). A profile without its Auth user cannot persist; the only case is a race between the profile read and an Auth delete. One stale banner at most; not worth a change.

## Focus areas: conclusions

### Conflict resolutions

- **`lib/server/media/finalise.ts` (`3fd04cc`): correct.** The uploads side (`claimLost = !data?.length`, then `settleLostClaim`) was kept. It replaces the old inline takeover check and adds what that check lacked:
  - A deleted asset's new derivatives and original are removed, and the call answers 404.
  - Another finalise that already made the asset ready counts as success.
  - Anything else is 409.

  The service-role read in `settleLostClaim` runs only for a row this actor already claimed. The followups change in range (`BUSY_RETRIES` 8→1, `HEIC_FINALISE_WORST_CASE_MS`) only touches timing; `tests/unit/finalise-budget.test.ts` covers it.

- **`lib/server/media/access.ts` (`1c5db9b`): correct.**
  - `signedUrlTtlSeconds()` can only shorten the 60 s lifetime: an override counts only when `>= 1 && < limit`.
  - `signDerivative` signs with the service role only after `getReadableAsset`.
  - The privacy step (F2, patched) confirmed that signed redirects are ≤ 60 s.
- **`lib/server/media/profile.ts` and `app/api/profile/route.ts`: unchanged in range.** The route runs its same-origin check first, then `getMediaActor("staff")`, and passes `auth.status` through. During the outage it returned `503` JSON with `no-store`. The 503 never leads to a write.
- **`app/admin/admin-library.tsx` (`9fc4d95`): correct.**
  - `useOptimistic(filters)` drives the controls (`value={shown}`), so quick filter changes build on each other.
  - `search` and the gallery `key` come from the server `filters` that the shown page belongs to, so a page is never re-keyed under the wrong filters.
  - The old `toSearch` was replaced by `filtersToSearch` throughout.
- **`lib/server/accounts/portfolio.ts`:** the modify/delete conflict was resolved by deleting the file. It is absent, and the admin portfolio uses `loadLibraryPage`.

### `/auth/confirm` interstitial

- **Token handling:**
  - The GET never uses the token: three GETs in a row, then a POST, still succeeds.
  - A token is single-use: replaying the POST gives `303 /login?error=link_invalid` and sets no auth cookie.
  - Only `email`, `magiclink` and `invite` are accepted. A real `recovery` token is refused on both the page and verify.
  - The hash format is checked (`/^[A-Za-z0-9_-]{8,256}$/`) and React escapes it into the hidden field.
  - Page headers: `Cache-Control: private, no-cache, no-store`, `<meta name="referrer" content="same-origin">`, `X-Frame-Options: DENY` plus CSP `frame-ancestors 'none'`, so the Continue button cannot be clickjacked.
- **Open redirect: none.** Verify always answers `303 /` or `303 /login?error=link_invalid` through `seeOther()` (a relative, fixed path). `next=`/`redirect_to=` in the query and in the form body are ignored. `evil.example` appears only inside Next's flight-data echo of the request URL, never in an `href`, `action` or `Location`.
- **CSRF:** real-server results:
  - `Sec-Fetch-Site: cross-site` → 403.
  - `same-site` → 403.
  - Foreign `Origin` without `Sec-Fetch-Site` → 403.
  - `Origin: null` → 403.

  Requests without these headers, or with a spoofed `X-Forwarded-Host`, are accepted by design: only non-browser clients can send them, and they hold no victim cookies.

- **Residual (informational, an improvement on before):** an attacker can still send someone their own valid link. If the person presses Continue, they are signed in as the attacker's account (login CSRF by social engineering). The old GET route did this with no click at all.

### Role 307 guard (layouts) and proxy

- `proxy.ts` and `lib/supabase` did not change in range; the proxy still checks only that a session exists.
- Real HTTP results:
  - staff → `/admin`, `/admin/staff` and `/admin/staff/:id` get **307 `/staff`**. The bodies hold only `<title>` and script tags: no names, shell or data.
  - admin → `/staff` gets **307 `/admin`**.
  - A session created before deactivation gets **307 `/auth/blocked`**.
  - A staff RSC request to `/admin` returns no admin content.
- Pages and Server Functions still re-check. The e2e `auth-guards.spec.ts` passed in the CI Playwright run.
- See F4 for the error path.

### Accounts auth-timeout degradation and authority

**Never wrong authority.**

- Every access decision reads `profiles` (`role`, `active`, `venue`) through `getAuthState()`/`requireAdminCaller`, never the directory entry.
- In degraded mode `toEntry` gives `row.active ? "active" : "inactive"`. So an invited (never signed-in) person **shows** as Active; the notice says so.
  - An invited person's profile is already `active = true` in the database. "Invited" is a label from Auth's `last_sign_in_at`, not a separate permission state.
  - Deactivated accounts stay exactly `inactive`.
- The one UI control that reads `status` is the edit dialog's active toggle (`account-controls.tsx:254`, `status !== "inactive"`). It stays correct.
- `inviteStaff` and `resendInvitation` refuse with nothing saved or sent on a timeout or failure.
- `withConfirmedStatus` only shows a status the server returned, and only until fresh props arrive.
- `tests/integration/auth-directory.test.ts`, where Auth hangs or fails, passed.

### Refresh timeout / AbortController

Behaves as the code comment says: a late result is dropped and the error is shown. See F5 for the queueing side effect.

### 503 profile path

Fails closed everywhere. With the profile unreachable:

- `getAuthState` throws.
- `getMediaActor` returns 503.
- `loadMyMedia` and `reserveUpload` return `{ ok: false, status: 503 }`.
- `/api/media/:id/download` returns 503 with `Retry-After: 5`; non-admins still get the same 404 as an unknown asset when the database is healthy.
- `/api/profile` returns 503.

See F4 and F6 for page UX and logging.

### CI privacy step

The design is sound: it reuses or rebuilds the `.next` build for the stack, captures the server log, requires 11 passed and 0 skipped, and is never skipped. It fails today because of F2; see also F11. The `email_sent = 100` change in `scripts/ci/prepare-stack.mjs` only touches the throwaway CI stack config.

### Cleanup GET for Vercel Cron

Same constant-time Bearer check as POST, with `no-store`. No header → 401; wrong secret → 401 `unauthorized`.

## Evidence

**Isolated stack:**

- Workdir `/tmp/nl-final-review-stack`, made with `tests/security/prepare-stack.mjs`, then project `nl-final-review` with ports moved to 567xx.
- `[studio]`, `[realtime]`, `[analytics]` and `[edge_runtime]` disabled; started with `-x vector,logflare,supavisor,imgproxy`.
- `email_sent`, `sign_in_sign_ups` and `token_verifications` raised as the CI stack does.
- `site_url` was later set to `:3794` for e2e.
- **Stopped at the end** with `supabase --workdir /tmp/nl-final-review-stack stop --no-backup`.

**Results on `5d28d64`:**

| Check                                                                  | Result                                                                                                           |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`, `pnpm lint`                                          | pass                                                                                                             |
| `pnpm test` (unit + UI)                                                | 21 files, 153 passed                                                                                             |
| `pnpm test:integration`                                                | 201 passed, **1 failed (F1)**, 12 skipped (privacy-runtime without a server, plus existing skips)                |
| `pnpm test:security <W>`                                               | 153 passed                                                                                                       |
| `pnpm test:lifecycle <W>`                                              | 23 passed                                                                                                        |
| Playwright CI config, `chromium`                                       | 42 passed, 15 skipped, 0 failed (6.3 min)                                                                        |
| Playwright CI config, `mobile-chromium`                                | 16 passed, 1 skipped, 0 failed (3.2 min)                                                                         |
| `node scripts/ci/privacy-runtime.mjs <W>`                              | **FAIL**: 0 passed, 11 skipped (F2). With the helper patched: 11/11 PASS                                         |
| `pnpm test:visual <W>` (one test)                                      | **FAIL** at `visual.spec.ts:491` (F3)                                                                            |
| Scratch probe suite (real `next start` plus in-process; not committed) | 7/7: open-redirect params, replay, disallowed types, CSRF matrix, 307 guard, deactivated session, profile outage |

**How the profile outage was simulated:** on the isolated stack only, `alter table public.profiles rename to profiles_review_outage; notify pgrst, 'reload schema'`, then renamed back in `finally`. Access was checked again afterwards.

**Not run:** the full `local-ci.sh`/`lci`. Per the CI rules it runs once on the final head, and this head is known red (F1, F2). Firefox and WebKit e2e projects were not run either; `scripts/ci/playwright.config.ts` defaults to chromium.

## Resume notes

- The three blocking fixes are test-only:
  - F1: add `status: 401` at `auth-links.test.ts:371`.
  - F2: two-step sign-in in `privacy-runtime.test.ts` `signInOverHttp`.
  - F3: press Continue in `visual.spec.ts` `signIn`.
- After those, run `pnpm test:integration` and `node scripts/ci/privacy-runtime.mjs <W>` on an isolated stack. Then rebase and run `lci run <profile> --pr N --post --comment` once on the final head.
- F4 to F9 can follow in one PR. F4 (`app/error.tsx`) is the most user-visible.
