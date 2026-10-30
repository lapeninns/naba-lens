# Wave 3 review: fixes (track `security-fixes`)

Fixes for findings 1, 3, 4, 5, 6 and 7 of `docs/reviews/wave3-review.md`. Finding 2
(admin portfolio) belongs to the `library` track; finding 8 (`/auth/confirm` on GET) is
not in this track. Everything database-side is in one migration,
`supabase/migrations/20261030100000_security_hardening.sql`.

## Finding 1: no end-user storage reads

- **Change:** dropped `nabalens_media_select` and `nabalens_avatars_select`. EXECUTE on
  `private.can_read_media_object` and `private.can_read_avatar_object` is revoked from
  `authenticated`. End users keep only the INSERT policy for their reserved original key.
- **App:** the routes sign with the service role only after their existing checks.
  - `signDerivative`: after `getReadableAsset`.
  - `signAvatar`: after the own-or-admin check and the RLS profile read.
  - The accounts directory and portfolio: after `requireAdminCaller`.
  - Expiry stays `MEDIA_LIMITS.signedUrlExpirySeconds` (60 s).
- **Proof:** `tests/security/hardening.test.ts`, as real staff and admin JWTs.
  - `createSignedUrl` (one year), `createSignedUrls`, `download` and `list` are all
    refused on originals, derivatives and avatars.
  - The app read path still issues 60 s URLs (the token's `exp - iat` is checked) that
    serve the bytes, for the owner and for an admin.
  - It returns 404 to other staff, to a deactivated owner, and for deleted assets.
- **No signed original, anywhere:** `lib/server/accounts/portfolio.ts` used to sign a
  video's original for the admin portfolio. It now signs only the WebP derivatives, and
  videos play through `/api/media/[id]/stream`. Every service-signed URL now points at a
  server-written WebP: a derivative (written by finalise with `contentType: image/webp`)
  or an avatar (written by the server; the `avatars` bucket only accepts `image/webp`).
  Originals reach a browser only through `streamOriginal`, which sends the validated
  type, `attachment`, `nosniff` and `private, no-store`.
- **Client Content-Type on originals (upload-path review F1):**
  - Storage serves the Content-Type that the backend stored from the upload request, not
    the `storage.objects.metadata` row. I measured this: rewriting
    `metadata.mimetype` in the DB did not change what was served. So a database trigger
    cannot normalise it.
  - Rewriting each original after validation would mean a copy of up to 200 MiB in
    finalise, which the uploads track owns.
  - Given the two points above, the client's label on an original is now unreachable:
    no end-user read, no signed original, and download/stream override every header.
  - Restricting the `media` bucket's `allowed_mime_types` was rejected. Phones send HEIC
    with empty or odd labels, so it would break real uploads.
- **Regression tests:** `tests/security/upload-path.regression.test.ts` ports the
  reviewer's repros with the fixed expectations:
  - R4: no staff-minted read URL, and no authenticated GET of an original.
  - R4b: a polyglot sent as `text/html` is served only as `image/jpeg` with `attachment`
    and `nosniff`.
  - R4c: for six hostile client types, the derivative URLs serve `image/webp`, and the
    admin portfolio contains no signed original (a video's `previewUrl` is the stream
    route).
- **Other suites:** the existing matrix in `tests/security/access.test.ts` now expects no
  direct reads. Four integration tests and two lifecycle tests now read through the app
  path (`getReadableAsset` + `streamOriginal`, or `signAvatar`) and assert that direct
  reads are denied.

## Finding 4: original writes re-check the reservation

The INSERT policy already required the reservation to be `uploading`, not tombstoned,
owned by active staff, and at an active venue. The gap is the signed-upload token. Storage
checks the policy when the URL is **minted**. The later PUT with the token runs without
the user's JWT, and the policy is not evaluated then.

- **Change:** the trigger `nabalens_guard_media_original_write` (BEFORE INSERT OR UPDATE on
  `storage.objects`) runs on every write to a key that some reservation owns as its
  original. That covers every path and every role. It enforces the same rules using the
  reservation's own uploader, because a token upload has no `auth.uid()`. Derivative keys
  are not original keys, so the server's preview and thumb writes are unaffected.
- **Proof:** a token minted while the reservation is open is now refused (and nothing is
  stored) once the reservation is tombstoned, `processing` or `failed`, once the uploader
  is deactivated, or once the venue is deactivated. The same token still works while the
  reservation stays open (control).
- **TUS investigation:**
  - Raw TUS was run with the user's JWT: a 6 MiB chunk, then a change of state, then the
    final chunk.
  - **Before** the migration, completion was already refused after a tombstone, after a
    move to `processing`, and after deactivation. Storage re-runs the insert with the
    user's JWT when the upload finishes, so RLS applies at completion.
  - **After** the migration, the trigger refuses first (HTTP 403,
    `media_reservation_closed`).
  - All of these, plus the control (an undisturbed TUS upload completes), are in
    `hardening.test.ts`.
- **Not verified:** whether a refused write leaves bytes in the storage backend with no
  `storage.objects` row. Such bytes are unreachable through the API.
- **Hosted note:** this is the first trigger on a `storage` table in this project. It
  works on the local stack (`postgres` may create it). Confirm the hosted project allows
  it before the first `db push`.

## Finding 5: `reserve_media_asset` enforces its own limits

- **Decision:** enforce the limits inside the function, rather than revoking it from
  `authenticated`.
  - The function derives owner, venue and the idempotent retry from the JWT.
  - Moving it to the service role would mean a new signature with an explicit uploader,
    a contract change (`CONTRACT.md` amendment), and edits to about eight test files owned
    by other tracks.
  - Checking inside the function also protects any future caller.
- **Limits now in the function:**
  - **A client upload key is required** (`invalid_upload_key`). Before this, a keyless
    reservation turned off finalise's key binding (upload-path review F5). Every
    test that called the RPC directly now passes a key and a size.
  - Extension allow-list per media type: `jpg|png|webp|heic|heif` for images,
    `mp4|mov|webm` for videos. These are formats, not tunable limits. `original.html`
    cannot be reserved.
  - **A declared size is required**, must be positive, and must be within the per-type
    cap: 20 MiB for images and 200 MiB for videos (`invalid_size`).
    - The caps mirror `MEDIA_LIMITS.maxPhotoBytes` and `maxVideoBytes`.
    - SQL cannot import `lib/config/media.ts`, so `hardening.test.ts` reserves exactly at
      and one byte over each `MEDIA_LIMITS` value. A change on only one side fails the
      suite.
    - The stored bytes are still checked again at finalise.
    - The function avoids a `CASE` expression, because the Supabase CLI's statement
      splitter cuts the function body there.
  - At most **20 open reservations** per uploader: `uploading`, `processing` or `failed`,
    and not deleted. That is two full batches. Retries of an existing key do not count.
    A per-uploader advisory transaction lock stops concurrent calls from overshooting.
    The error is `too_many_open_uploads`, which the route maps to a 409 with a plain
    message.
- **Proof:** HTML or SVG extensions, a type/extension mismatch, a size over the cap, and
  zero, negative or missing sizes and a missing key are all refused. Regression R10
  replays the reviewer's exact call (`html`, 999999999999 bytes, no key) and finds no
  `.html` reservation afterwards. Allowed types are accepted. The cap holds,
  ignores retries, and frees up after a ready or deleted asset. 30 concurrent calls give
  exactly 20 reservations.

## Finding 3: stale `processing` reaper

- **Change:** `fail_stale_media_processing(p_stale_after, p_limit)` is service-role only.
  It moves claims whose `updated_at`, the claim stamp, is older than the window to
  `failed`, using the database clock.
  - It refuses windows shorter than 10 minutes.
  - `runMediaCleanup` calls it first with `MEDIA_LIMITS.staleProcessingMinutes` (30 min,
    well above any route `maxDuration`). It reports the result as
    `reaped: { assetIds, reason: "stale_processing" }`.
  - The bytes are kept: the uploader sees a real failure and can retry or delete.
  - Setting `failed` re-stamps `updated_at`, so the 24 h abandoned window starts again.
- **Proof:** `tests/lifecycle/stale-processing.test.ts`.
  - A 31-minute claim is reaped: it becomes `failed`, is not deleted, and its object is
    kept. Claims aged 3 and 29 minutes are untouched, with `updated_at` unchanged. A
    tombstoned claim is untouched.
  - The owner then sees `failed` through RLS, and `finaliseAsset` takes the asset to
    `ready`.
  - A window under 10 minutes is refused.

## Finding 6: stale-claim takeover uses database time

- **Change:** `take_over_stale_media_claim(p_asset_id, p_stale_after)` is service-role
  only. It is a compare-and-set from `processing` to `failed`, and it applies only when
  `updated_at < now() - p_stale_after`.
- **Finalise:** `finaliseAsset` calls the function instead of comparing `Date.now()` with
  `updated_at`. When the final `ready` update matches no row, finalise re-reads the row:
  - if the row is `ready`, it reports success;
  - otherwise it returns 409 and leaves the row to whoever now holds it. Before this
    change, the catch block could flip another finalise's live claim to `failed`.
- **Cleanup clock:** `runMediaCleanup` no longer passes the app clock to
  `prepare_media_cleanup` unless `options.now` is set (tests only).
- **Proof:**
  - The function returns false for a fresh claim and true for one that is 3 minutes old by
    database time. It is a compare-and-set: a second caller gets false.
  - With the app clock mocked one hour ahead, `finaliseAsset` on a live claim returns 409
    and the row is byte-for-byte unchanged. The old code would have taken it over.
  - A claim that is stale by database time is taken over and completed.

## Finding 7: same-origin check and security headers

- **`/api/profile`:** `lib/server/http/isSameOriginRequest` refuses the request when
  `Sec-Fetch-Site` is present and is neither `same-origin` nor `none`, or when `Origin`
  does not match the Host (or X-Forwarded-Host) header. A copy of the admin avatar route's
  `origin !== request.nextUrl.origin` check would have broken profile edits in
  development: there, Next reports `nextUrl.origin` as `http://localhost:PORT` while the
  browser sends `http://127.0.0.1:PORT`. The e2e test caught this.
- **`next.config.ts` `headers()` for `/:path*`:**
  - A CSP:
    - `default-src 'self'`.
    - Scripts and styles: `'self' 'unsafe-inline'`, plus `'unsafe-eval'` in development
      only.
    - `img-src` and `media-src`: `'self' blob: data:` plus the Supabase origin.
    - `connect-src`: `'self'` plus the Supabase origin, plus `ws:` and `wss:` in
      development.
    - `worker-src 'self' blob:`, `object-src 'none'`, `base-uri 'self'`,
      `form-action 'self'`, `frame-ancestors 'none'`.
    - `upgrade-insecure-requests` only when Supabase is served over HTTPS.
  - `X-Content-Type-Options: nosniff`.
  - `Referrer-Policy: strict-origin-when-cross-origin`.
  - `Permissions-Policy: camera=(self), microphone=(self), geolocation=(), payment=(),
usb=()`.
  - `X-Frame-Options: DENY`.
- **Build requirement:** `NEXT_PUBLIC_SUPABASE_URL` must be set at build time, which the
  client bundle already requires.
- **Proof:**
  - `tests/unit/same-origin.test.ts`.
  - `tests/e2e/security-headers.spec.ts`:
    - The headers are present.
    - A real upload of a photo (signed PUT) and a video (TUS), the thumbnail, the preview
      and video playback all run with zero `securitypolicyviolation` events or CSP console
      errors.
    - A cross-origin POST to `/api/profile` gets 403.
  - The full e2e suite passes against both `next dev` and a production `next start`.

## Upload-path review F6

F6 is the same issue as finding 4 above, with the same fix. Regression R2b: after a delete,
a TUS completion and a replay of the server-issued signed URL both store nothing.

## Left for others

- **`lib/server/media/finalise.ts`:** I changed it on this branch for finding 6, before
  the uploads thread took ownership of the file. The change:
  - the stale-claim takeover calls the `take_over_stale_media_claim` RPC instead of
    comparing `Date.now()` with `updated_at`;
  - when the final `ready` update matches no rows, finalise re-reads the row, returns
    `ready` if it is ready, and otherwise returns 409 without touching it.

  I made no further edits after being told the file belongs to uploads. The uploads
  track's F2 fix (adding `deleted_at is null` to the ready update) sits next to my
  lost-claim branch. Merge them so a lost update that finds a tombstoned row removes the
  derivatives and returns not-found, as the reviewer suggested.

- **Upload-path F2 and F4:** uploads track.

- **Finding 2:** `library` track.
- **Admin avatar route:** `app/admin/staff/[id]/avatar/route.ts` (accounts) still uses
  `origin !== request.nextUrl.origin`. That breaks admin avatar uploads under
  `next dev --hostname 127.0.0.1`. Switch it to `isSameOriginRequest`.
- **Scheduling:** cleanup is still unscheduled (`docs/cleanup.md`). The reaper only runs
  when cleanup does.
