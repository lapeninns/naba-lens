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
     applies: another user signing someone else's key gets 403.
   - A retry of a stored-but-failed or stored-but-unconfirmed asset returns
     `state: "processing"`, so the client finalises again instead of re-uploading.
2. The browser uploads straight to the private `media` bucket (`lib/upload`).
3. `finaliseUpload` → `finaliseAsset`. It checks that the caller owns the asset and that the
   key matches, then claims it with a compare-and-set to `processing`:
   - A second, concurrent call waits for the first. A claim older than 2 min is taken over.
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

## Read paths (all `Cache-Control: private, no-store`, `nosniff`)

| Route                          | Who                  | What                                                                                                                       |
| ------------------------------ | -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/media/[id]/thumb`    | owner, admin         | 302 to a 60 s signed URL, issued per request and signed as the caller                                                      |
| `GET /api/media/[id]/preview`  | owner, admin         | same, for the 1600 px WebP preview                                                                                         |
| `GET /api/media/[id]/stream`   | owner, admin (video) | proxies the original with Range, re-authorised on every request, so playback survives the 60 s window                      |
| `GET /api/media/[id]/download` | admin                | proxies the unchanged original: validated `Content-Type`, `attachment` filename forced to the validated extension          |
| `GET /api/avatars/[id]?v=`     | self, admin          | 302 to a 60 s signed avatar URL                                                                                            |
| `POST /api/profile`            | staff                | name + optional avatar (≤ 5 MiB, `createAvatarDerivative`). A Route Handler because the Server Function body limit is 1 MB |

Unknown, forbidden, deleted and non-ready assets all answer 404. `media_asset_not_found`
from the delete RPC (HTTP 500 from PostgREST) is mapped to 404 (`rpcFailure`).

Originals are proxied rather than served from signed storage URLs. Measured on the local
stack: storage serves the uploader-supplied Content-Type and sends no `nosniff` header, which
`docs/media-pipeline.md` forbids for originals. Gallery tiles use the stable route URLs, so
lazy-loaded thumbnails never hold expired signatures. No private media goes through
`next/image`.

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
    link to `/admin/staff/{id}` (accounts track) and delete.
- Shared client pieces are in `app/_media/`:
  - `MediaGallery` is reusable for `/admin/staff/[id]`, with
    `loadLibraryPage({ staff: id }, cursor)` from `app/admin/library-actions.ts`.
  - `useMediaUploader`.
  - `deleteMedia`, which calls lifecycle's `removeMediaAsset`.

## Known limits

- Video tiles have no poster frame (no ffmpeg); they show the placeholder icon.
- Staff cannot download their own originals (spec: downloads are an admin action).
- The `failed` reason is shown in the upload dialog only, not after a reload.
