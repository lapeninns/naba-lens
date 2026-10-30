# Wave 3 review: `4918867..078b60a` (feat/nabalens-mvp)

Independent security and correctness review of the wave 1–2 merge (foundation,
media, ui, slice, lifecycle, accounts) against `docs/spec/NabaLens-MVP-Execution-v0.2.md`
and `docs/fanout/CONTRACT.md`. No application code was changed.

## Scope and method

- Read every migration, `lib/server/{media,accounts,lifecycle}/**`, `lib/auth/**`,
  `lib/supabase/**`, `proxy.ts`, all `app/**/route.ts`, `app/**/actions.ts`,
  `app/_media/**`, the admin portfolio page, and the routing, upload and cleanup docs.
- Ran an isolated local stack, `/tmp/nl-wave3-review`. It was made with
  `tests/security/prepare-stack.mjs`, then given project `nabalens-w3review` and
  ports 593xx, with studio, realtime, analytics and edge_runtime disabled. I
  probed each suspicion there with separate signed-in identities (seeded dev
  fixtures plus the service role, used only to arrange state). The probe scripts
  are in `/tmp/nl-w3-probes` and are not committed.
- Repository checks on `078b60a`:
  - `pnpm typecheck`: exit 0
  - `pnpm lint`: exit 0
  - `pnpm test`: 12 files, 102 tests passed
  - `pnpm test:security` on the isolated stack: 114 passed
  - `pnpm test:integration` on the isolated stack: 7 files, 84 passed
  - Not run: `pnpm build`, `test:e2e` and `test:lifecycle`. Each would need its own
    app server or stack, and none of my findings depend on them.

## What holds up (verified)

- **Service-role use.** Every service-role call re-checks the caller first.
  Reserve and finalise authorise through `getMediaActor`, which reads the profile
  fresh. Finalise reads the row through RLS, and so does the reopen in reserve,
  which also filters on `uploader_id`. Delete tombstones through the
  `delete_media_asset` RPC before the service role removes anything. The account
  operations (invite, resend, update, ban, avatar) call `requireAdminCaller` or
  `resolveCaller` and read the target through the admin's own RLS client. Cleanup
  takes a 32+ character bearer secret and compares it in constant time.
- **No overwrites.** There is no UPDATE policy on `storage.objects`. A staff
  `upsert: true` over an existing original was rejected by RLS (probe P2), and so
  was minting an upsert signed upload URL (P5b).
- **Database guards.** Role, venue, activation, owner, key and tombstone are all
  enforced in the database (guards plus column grants). The security suite covers
  this and passes.
- **Original downloads.** The download and stream routes proxy the original with
  the validated `Content-Type`, `attachment`, `nosniff` and `private, no-store`.
  Range is forwarded only when it matches `^bytes=\d*-\d*$`.
- **Reservation idempotency.** The unique `(uploader_id, client_upload_key)` index
  plus the `unique_violation` fallback make concurrent reserves return one asset.
  Finalise claims are compare-and-set on `upload_state`.
- **Invitations and sign-up.** `enable_signup = false`, and magic links use
  `shouldCreateUser: false`. Invitations hard-code `role: "staff"`. Two concurrent
  invites for one email cannot both succeed: GoTrue rejects the duplicate, and an
  orphan adoption hits profile 23505.
- **Out-of-scope features.** None found (no approval, tags, comments, analytics,
  ZIP or extra roles). `/ui-preview` returns 404 in production.

## Findings (ranked)

### 1. MEDIUM: any signed-in user can mint storage signed URLs of any lifetime; they outlive deactivation and the tombstone

- **Where:** `supabase/migrations/20261029120200_nabalens_storage.sql:105` (policy
  `nabalens_media_select`) and `:113` (`nabalens_avatars_select`). Both grant
  end users SELECT on `storage.objects`, and Storage's sign endpoint accepts any
  `expiresIn`.
- **Scenario:** Staff A calls `supabase.storage.from("media").createSignedUrl(<own
original>, 31536000)` directly with their session; an admin can do the same for
  any asset or avatar. The app's 60 s expiry (spec §7, `MEDIA_LIMITS.signedUrlExpirySeconds`)
  is only a convention of its own routes. The year-long bearer link keeps working
  after:
  - the account is deactivated;
  - the asset is tombstoned, until the bytes are physically removed. If
    `removeMediaAsset` hits a storage error, removal waits for the cleanup job,
    and per `docs/cleanup.md` none is scheduled.
- **Evidence (probe P3):**
  - staff signs own original for 1 year: `ok`
  - admin signs any original for 1 year: `ok`
  - after `profiles.active = false`: the URL returns `200 image/jpeg`
  - after `delete_media_asset` but before removal: `200`
  - for comparison, a 2 s URL fetched after 3.5 s returned `400`, so expiry itself
    works.
- **Spec:** §7 says "choose a short expiry, initially 60 seconds", "Unvalidated or
  removed objects are not generally readable", and "An inactive account is denied
  new … downloads". The spec accepts that already-issued links live until they
  expire. It assumes those links are short.
- **Fix:** Remove the end-user SELECT policies on `media` and `avatars`. Have the
  routes sign with the service role _after_ `getReadableAsset` / `signAvatar`
  have authorised the caller, which they already do. That keeps the 60 s expiry a
  server decision. Alternatively, stream derivatives and avatars through the
  routes the way originals already are. Add a security test that an
  end-user-minted signed URL is refused.

### 2. MEDIUM: admin individual portfolio (`/admin/staff/[id]`) is a second, weaker gallery: expiring URLs baked into SSR, raw signed originals, no download or delete

- **Where:**
  - `lib/server/accounts/portfolio.ts:113-127` signs thumbnails, previews and, for
    videos, the **original** once, at render time, for 60 s.
  - `app/admin/staff/[id]/portfolio-gallery.tsx:17` says "Preview only for now:
    download and delete are wired by the slice and lifecycle tracks". Neither was
    wired after the merge.
- **Scenario:**
  - The admin opens a portfolio and clicks a tile more than 60 s later. The
    viewer's `previewUrl` has expired and shows "Preview unavailable". Lazy tiles
    below the fold also fail once they load after 60 s.
  - A video's preview is a direct storage URL to the original, so seeking or
    buffering past 60 s fails. Storage also serves it with the uploader's
    `Content-Type` and no `nosniff`. `docs/media-routes.md:55` says this must
    not happen ("Originals are proxied rather than served from signed storage
    URLs").
  - The page offers no download or delete, though spec §3 says "Admin's
    preview/download/delete actions work here too. Reuse the portfolio/gallery
    components instead of building a second implementation."
- **Evidence:** the code paths above, plus the expiry behaviour from probe P2.
  `app/admin/library-actions.ts:13-15` already documents the intended reuse
  (`loadLibraryPage({ staff: id })`).
- **Fix:** Render the portfolio with `app/_media/media-gallery.tsx` and
  `listLibrary(actor, { staffId })`. Those use the per-request
  `/api/media/[id]/{thumb,preview,stream,download}` routes and `deleteMedia`.
  Then delete `listMediaForUploader` and its signing.

### 3. MEDIUM: a finalise that dies mid-flight leaves the asset in `processing` forever; cleanup never touches it

- **Where:** `supabase/migrations/20261029150000_nabalens_media_cleanup.sql:107`
  only abandons `upload_state in ('uploading','failed')`.
  `lib/server/media/finalise.ts:19,213-216` relies on a later finalise call with the
  same key to take over a stale claim.
- **Scenario:** The function times out or is OOM-killed during a HEIC decode or
  video probe, or the network drops after the claim. The row stays `processing`.
  The browser loses its in-memory upload key on reload, so no later finalise
  comes. After that:
  - The staff portfolio shows "Processing" indefinitely. Spec §5 says
    "Reopening the app must accurately distinguish completed, incomplete and
    failed uploads".
  - The original is kept forever, with nothing ever making it `failed`.
- **Evidence (probe 2):** `prepare_media_cleanup(p_now => now + 30 days)` left a
  `processing` row with stored bytes untouched: `{"upload_state":"processing",
"deleted_at":null}`. The staff member still sees it as `processing`.
- **Fix:** In `prepare_media_cleanup`, also treat `processing` rows older than
  the stale-claim window (or the 24 h window) as abandoned. Better, first flip
  them to `failed` so the UI shows a real error and the user can retry or
  delete. Add a lifecycle test.

### 4. LOW: signed upload tokens are honoured after the reservation is processing, tombstoned, or the user is deactivated

- **Where:** `lib/server/media/reserve.ts:216-219`. `createSignedUploadUrl` is
  checked against the insert policy only when the URL is signed. Supabase's
  token stays valid for 2 h, and the upload made with it skips
  `can_upload_media_object`.
- **Scenario:** Staff obtain a signed upload URL, then either:
  - are deactivated, or
  - delete the asset (tombstone), or
  - a finalise moves the row to `processing`.
    The `PUT` with the token still stores up to 200 MiB. The bytes can never become
    `ready`, because finalise re-authorises and validates, so this is not a
    validation bypass. It does break "inactive account is denied new uploads" (§7),
    and it leaves orphans under tombstoned keys until cleanup runs, which is
    unscheduled.
- **Evidence:**
  - P4: "signed-upload after tombstone+deactivate: STORED"
  - P5: "signed-upload while processing: STORED"
- **Fix:** Route small files through the same authenticated TUS / standard upload
  as large ones. RLS is then evaluated at write time, though that needs
  verifying on the stack. Or accept the 2 h window explicitly in
  `docs/media-routes.md` and make the cleanup schedule a release blocker.

### 5. LOW: `reserve_media_asset` is directly callable and skips the route's allow-list and limits

- **Where:** `supabase/migrations/20261029160000_media_client_upload_key.sql:107,144`.
  The extension is only checked against `^[a-z0-9]{2,5}$`, and
  `p_size_bytes` is unbounded. Execute is granted to `authenticated`.
- **Scenario:** A staff member calls the RPC through PostgREST with
  `p_extension => 'html'` and `p_size_bytes => 999999999999`, then stores
  `text/html` bytes at `…/original.html` (probe P1: both succeed). There is no
  per-user cap on open reservations, so one insider can reserve repeatedly and
  push 200 MiB into each slot, limited only by the 24 h cleanup, which is not
  scheduled.
- **Mitigations already in place:**
  - Finalise validates content.
  - A JPEG+HTML polyglot does pass `validateMedia` as `image/jpeg`, but storage
    served the stored `text/html` object as `text/plain` on this stack (probe 3).
  - The download route forces the validated type and extension.
- **Fix:**
  - Mirror the allow-list in SQL (`jpg|png|webp|heic|heif` for image,
    `mp4|mov|webm` for video).
  - Cap `p_size_bytes` per type.
  - Cap open `uploading`/`failed` reservations per uploader, for example at 20.

### 6. LOW: stale-claim takeover in finalise compares the database clock with the app clock

- **Where:** `lib/server/media/finalise.ts:92`,
  `Date.now() - Date.parse(current.updated_at) > STALE_PROCESSING_MS`.
- **Scenario:** If the app host's clock runs more than 2 min ahead of Postgres, or
  a legitimate finalise of a large video or HEIC takes more than 2 min, a second
  finalise resets the row to `failed` and processes it again. The first then
  writes `ready`. The second's `.eq("upload_state","processing")` update matches
  nothing, so it returns 503 "Could not save this file" for an asset that is
  actually ready. The next retry heals it.
- **Fix:** Do the staleness test in SQL
  (`.lt("updated_at", <db now - interval>)` through an RPC, or
  `now() - updated_at` in a guarded update). Treat "row already ready" as
  success when the final update matches nothing.

### 7. LOW (hardening): `/api/profile` has no Origin check; no security headers

- **Where:**
  - `app/api/profile/route.ts:12`: the multipart POST changes display name and
    avatar. `app/admin/staff/[id]/avatar/route.ts:38-41` checks Origin, but this
    route does not.
  - `next.config.ts`: no CSP or `frame-ancestors`.
- **Scenario:** The route relies on the session cookie being `SameSite=Lax`. Any
  future cookie or proxy change that relaxes this, or a same-site subdomain,
  enables CSRF of a staff profile. `@supabase/ssr` cookies are JS-readable by
  default, so any XSS would expose the session. A CSP is the cheap backstop.
- **Fix:** Copy the Origin check into `/api/profile`. Add a baseline
  `headers()` config with CSP, `frame-ancestors 'none'` and
  `Referrer-Policy`.

### 8. INFO: `/auth/confirm` consumes the token on GET

- **Where:** `app/auth/confirm/route.ts:15-27`.
- **Scenario:** Corporate mail scanners (for example Safe Links) prefetch links,
  so invite or magic links can arrive already used and show "link invalid". This
  is a usability risk for the real-phone pilot.
- **Fix:** Have the GET render a confirm button that POSTs the `token_hash`.

## Contract and spec notes

- The `client_upload_key` amendment is implemented as `CONTRACT.md` describes.
- There are two portfolio listing implementations, `lib/server/media/library.ts`
  and `lib/server/accounts/portfolio.ts`, against spec §3 "reuse"; see finding 2.
- `docs/cleanup.md` correctly says nothing is scheduled. Findings 1, 3, 4 and 5
  all lean on cleanup, so scheduling it should be a release blocker (spec §11).

## Verdict

**Not ready to release as is, but no critical or high-severity hole was found.**
Authentication, RLS, column guards, overwrite protection, service-role re-checks
and reserve idempotency all hold under direct API probing, and all existing suites
pass. Before the pilot:

1. Fix finding 1. It is the one spec §7 control (short-lived signed reads, denial
   after deactivation) that end users can bypass today.
2. Fix finding 2, a visible functional gap on an admin screen the spec requires.
3. Fix finding 3, or uploads can get stuck in "Processing" forever.
4. Schedule cleanup.

Findings 4–8 are low-severity hardening.
