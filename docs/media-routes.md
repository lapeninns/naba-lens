# Media slice: reserve, finalise, galleries and private routes

Wave 2, slice track (spec backlog M2 + M3). Server logic lives in `lib/server/media/*`.
Those modules take a `MediaActor` (caller's RLS client, fresh profile, service client),
so the integration tests drive the same code as the app. `context.ts` (server-only)
builds the actor per request after `lib/auth` has authorised the caller.

## Upload path

1. `reserveUpload` (Server Function, `app/staff/actions.ts`) → `reserveAsset`:
   - Requires an active staff member at an active venue and re-checks size and type against
     `MEDIA_LIMITS`.
   - Calls `reserve_media_asset(..., p_client_upload_key)`. The database derives owner, venue,
     ID and key, and a repeated key returns the same asset (contract amendment).
   - Returns either `resumable: true` (videos, photos > 6 MiB → TUS with the user's own token)
     or a signed upload URL. That URL is signed **as the caller**, so the storage insert policy
     applies: another user signing someone else's key gets 403. The token is good for 2 h,
     but every write of an original (signed PUT, TUS completion, standard upload) also passes
     the `guard_media_original_write` trigger, which refuses it unless the reservation is
     still `uploading`, not deleted, its uploader active staff and its venue active
     (wave 3 finding 4, `20261030100000_security_hardening.sql`).
   - `reserve_media_asset` itself requires a client upload key and a declared size, and
     enforces the extension allow-list per media type, the per-type size cap (20 MiB photo,
     200 MiB video, mirroring `MEDIA_LIMITS`) and at most 20 open reservations per
     uploader. Calling the RPC directly cannot skip the route's checks or reserve
     `original.html` (wave 3 finding 5, upload-path review F5).
   - A retry of a stored-but-failed or stored-but-unconfirmed asset returns
     `state: "processing"`, so the client finalises again instead of re-uploading.
2. The browser uploads straight to the private `media` bucket (`lib/upload`).
3. `finaliseUpload` → `finaliseAsset`. It checks that the caller owns the asset and that the
   key matches, then claims it with a compare-and-set to `processing`:
   - A second, concurrent call waits for the first. A claim older than 2 min **by the database
     clock** (`take_over_stale_media_claim`) is taken over; the app clock is never compared
     with database timestamps. If a taken-over finalise later finds the asset `ready`, it
     reports success. Claims that nobody retries are reaped by cleanup (see `docs/cleanup.md`).
   - Reads the object through HTTP Range requests (blocks of at least 256 KiB, cached) and
     sniffs the bytes. The content must match the reserved media type.
   - **Images:** one full read, then `validateMedia` (single decode; HEIC runs in the worker;
     `decoder_busy` is retried).
   - **Videos:** `validateMedia` with a range source; dimensions and duration are stored. Codec
     and playability hints have no column and are not stored.
   - Writes `preview.webp`/`thumb.webp` with the service role, then sets `ready`.
   - Invalid content becomes `failed` and the plain reason is returned. The reason is not
     persisted, because there is no column for it.
   - Missing bytes put the asset back to `uploading` (HTTP 409, retryable).
   - The browser's MIME label is never consulted.
4. **Cleanup safety.** Reserve (including idempotent retries that resume a TUS transfer) and
   finalise (unless the asset is already `processing`) call lifecycle's
   `touchMediaReservation`. That is the function behind `recordUploadActivity`, called here
   with the request's service client so the core stays testable. The 24 h abandoned-upload
   cleanup therefore never removes a live upload.

## Read paths (all `Cache-Control: private, no-store`, `nosniff`)

| Route                          | Who                  | What                                                                                                                                                                 |
| ------------------------------ | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/media/[id]/thumb`    | owner, admin         | 302 to a 60 s signed URL, issued per request with the service role after the caller and asset checks                                                                 |
| `GET /api/media/[id]/preview`  | owner, admin         | same, for the 1600 px WebP preview                                                                                                                                   |
| `GET /api/media/[id]/stream`   | owner, admin (video) | proxies the original with Range, re-authorised on every request, so playback survives the 60 s window                                                                |
| `GET /api/media/[id]/download` | admin                | proxies the unchanged original: validated `Content-Type`, `attachment` filename forced to the validated extension                                                    |
| `GET /api/avatars/[id]?v=`     | self, admin          | 302 to a 60 s signed avatar URL                                                                                                                                      |
| `POST /api/profile`            | staff                | name + optional avatar (≤ 5 MiB, `createAvatarDerivative`). A Route Handler because the Server Function body limit is 1 MB. Same-origin only (`isSameOriginRequest`) |

End users have **no** storage read policy (wave 3 finding 1): they cannot list, download or
sign objects in `media` or `avatars` themselves, so the 60 s expiry is a server decision and
nobody can mint a long-lived link. These routes authorise the caller (fresh profile read)
and the asset first, then sign or stream with the service role.

Unknown, forbidden, deleted and non-ready assets all answer 404. `media_asset_not_found`
from the delete RPC (HTTP 500 from PostgREST) is mapped to 404 (`rpcFailure`).

Originals are proxied rather than served from signed storage URLs. Measured on the local
stack: storage serves the uploader-supplied Content-Type and sends no `nosniff` header, which
`docs/media-pipeline.md` forbids for originals. Gallery tiles use the stable route URLs, so
lazy-loaded thumbnails never hold expired signatures. No private media goes through
`next/image` (guarded by `tests/unit/no-image-optimiser.test.ts`).

Signed-link expiry: new links last `signedUrlTtlSeconds()` (60 s;
`NABALENS_SIGNED_URL_TTL_SECONDS` can only shorten it, for tests). An open gallery recovers
without a reload (`app/_media/preview-recovery.ts`): a failed thumbnail, preview or video load
is re-requested once with a `?r=` marker, which re-authorises and re-signs; a second failure
shows "N previews could not load." with Try again; each foreground refresh retries broken
previews once. Images that failed before hydration are detected on mount.

## Pages

- `/staff`: `ProfileHeader`, Upload (hidden with a setup message when there is no or an
  inactive venue), Edit profile, own gallery (all technical states, cursor pages of 24),
  viewer and delete. It refreshes after uploads, on focus, and every 5 s while an item is
  still processing.
- `/admin`: library of ready assets across venues.
  - Filters `?venue=&staff=&type=` are applied on the server.
  - Cursor pages of 24.
  - Refreshes every 15 s while the tab is visible, and on focus.
  - Viewer shows contributor, venue at upload and date, with download, an "Open portfolio"
    link to `/admin/staff/{id}` and delete.
- `/admin/staff/[id]`: the accounts track's profile header and controls, then the admin
  library filtered to that person (`listLibrary(actor, { staffId })`) in the same
  `MediaGallery`: preview, download, delete and the 15 s refresh.
- Shared client pieces are in `app/_media/`:
  - `MediaGallery`, used by all three pages; `/admin/staff/[id]` pages with
    `loadLibraryPage({ staff: id }, cursor)` from `app/admin/library-actions.ts`.
    Refresh replaces the loaded range atomically, including older files whose
    processing state or availability changed. It reads one cursor page at a time,
    through the previous oldest file's `(created_at, id)` sort boundary (or the
    end of the feed), under one shared 10-second abort deadline. New arrivals
    cannot evict older loaded files or close their open viewer. A deleted oldest
    file is handled by crossing its sort boundary rather than searching for its ID.
    A failure on any page retains the previous snapshot with a refresh warning;
    a later successful refresh retries the range. Very large or slow ranges can
    exceed the deadline; reloading starts again from the newest page if needed.
    Load-more responses from before
    a refresh, and refreshes overtaken by local deletion or label saves, cannot
    restore stale content.
  - `useMediaUploader`.
  - `deleteMedia`, which calls lifecycle's `removeMediaAsset` after the spec's
    confirmation copy. 401, 403 and 404 become plain messages. `storage: "pending"` still
    hides the file, and the cleanup job retries the storage removal. The removed item
    leaves the gallery at once; the other view drops it on its next refresh.

## Known limits

- Video tiles have no poster frame (no ffmpeg); they show the placeholder icon.
- Staff cannot download their own originals (spec: downloads are an admin action).
- The `failed` reason is shown in the upload dialog only, not after a reload.
