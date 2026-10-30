# Upload path review: browser to ready asset

- **Scope:** the integrated upload path on `feat/nabalens-mvp` at `3a23c9b`. This covers the browser transport (`lib/upload/**`, `app/_media/use-media-uploader.ts`), the Server Functions (`app/staff/actions.ts`), reserve and finalise (`lib/server/media/reserve.ts`, `finalise.ts`, `storage.ts`), the storage policies and migrations (including `client_upload_key`), the read and download routes (`app/api/media/**`, `lib/server/media/access.ts`), deletion (`lib/server/lifecycle/remove-media.ts`) and cleanup (`lib/server/lifecycle/cleanup.ts`, `prepare_media_cleanup`). The decoders in `lib/media` were reviewed separately and are only covered here where finalise calls them.
- **Checklist:** the OWASP File Upload Cheat Sheet. Section 4 maps each item to what the code does.
- **Method:** I read the code, then checked every suspicion on an isolated local Supabase stack. The stack was `nabalens-uppath2` on ports 600xx, running storage-api `v1.72.1`, with studio, realtime, analytics, edge runtime, SMTP, vector and S3 turned off. The repros call the real `reserveAsset`, `finaliseAsset`, `removeMediaAssetWith`, `runMediaCleanup` and `streamOriginal` functions as real signed-in identities. Raw Storage HTTP calls (signed PUT, TUS POST/PATCH, signed GET) use those identities' own JWTs. Appendix A has the repro source and Appendix B has the observed output.
- **No application code was changed.**

## 1. Findings, most severe first

| #   | Severity   | Finding                                                                                                                                                                                                     | Repro        |
| --- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| F1  | **Medium** | Staff can mint signed read URLs with any expiry for their own originals. These URLs survive deactivation and storage serves them with the uploader's Content-Type                                           | R4, R4b, R4c |
| F2  | **Medium** | A delete that runs during finalise ends with the tombstoned row marked `ready`. Finalise writes derivatives after the delete reported `storage: "removed"`                                                  | R6           |
| F3  | **Medium** | A crashed finalise leaves the row in `processing` forever. Cleanup never picks it up, so the original is kept indefinitely                                                                                  | R7           |
| F4  | Low–Medium | The declared size is never checked against the stored size. Any reservation can store up to the 200 MiB bucket cap, and objects that fail validation are kept for at least 24 h. There is no per-user quota | R5           |
| F5  | Low        | Calling the `reserve_media_asset` RPC directly skips `reserve.ts`'s extension allow-list and size cap. A reservation made without a key also turns off finalise's key binding                               | R10          |
| F6  | Low        | The server-issued signed upload URL (2 h) still stores bytes after the asset is deleted, re-creating objects under a tombstone                                                                              | R2b          |
| F7  | Info       | A stale-claim takeover can answer 503 for an asset that is already `ready`. There is also no malware scanning and no rate limit on reserve or finalise                                                      | analysis     |

None of these is critical or high. The attacks that matter most are blocked, and Section 2 shows each one blocked on the stack: overwriting a validated original (TOCTOU), uploading to a key you did not reserve, finalising someone else's asset, and duplicate rows from retries.

---

### F1 (Medium): staff-minted signed read URLs with any expiry, served with the client's Content-Type

**Where**

- `supabase/migrations/20261029120200_nabalens_storage.sql:37-56`: `private.can_read_media_object` grants storage SELECT on the **original**, preview and thumbnail to the owning staff member once the asset is `ready`.
- `supabase/migrations/20261029120200_nabalens_storage.sql:105-107`: the `nabalens_media_select` policy.
- `lib/server/media/access.ts:96-98` signs derivatives with the caller's own client, which depends on that policy.

**What happens**

- The SELECT policy is all Supabase Storage checks when a signed URL is minted, and the client chooses `expiresIn`. A staff member holding their own session (anon key + JWT) can call `storage.from('media').createSignedUrl('<uid>/<asset>/original.jpg', 31536000)` directly. They get a working one-year URL.
- That URL:
  - ignores the product's 60 s limit (`MEDIA_LIMITS.signedUrlExpirySeconds`);
  - keeps working after an admin **deactivates** the account (R4: `200` after deactivation). Only deleting the asset kills it.
  - is served straight by storage, so none of the route's protections apply: no `x-content-type-options: nosniff`, no `content-disposition: attachment`, no `cache-control: private, no-store`.
  - uses the **browser-supplied** Content-Type stored at upload time (`metadata.mimetype`), not `validated_mime_type`.
- R4c uploaded one valid JPEG under several client Content-Types. Each asset was validated `ready` as `image/jpeg`, then fetched through its staff-minted signed URL:

| Upload Content-Type     | Served by storage                                            |
| ----------------------- | ------------------------------------------------------------ |
| `image/svg+xml`         | `image/svg+xml`                                              |
| `application/xhtml+xml` | `application/xhtml+xml`                                      |
| `text/xml`              | `text/xml; charset=UTF-8`                                    |
| `application/pdf`       | `application/pdf`                                            |
| `text/javascript`       | `text/javascript`                                            |
| `text/html`             | `text/plain; charset=UTF-8` (storage rewrites only this one) |

- R4b: a JPEG with an HTML/`<script>` tail, uploaded as `text/html`, finalised `ready`.

**Why it matters**

The validated bytes are always a real JPEG, PNG, WebP, HEIC or video, and those binary prefixes are not well-formed XML. That makes script execution through these types unlikely in today's browsers. It is still a direct break of OWASP's "don't trust the client Content-Type" and "serve with nosniff/attachment". The `download` route comment acknowledges the problem (`app/api/media/[id]/download/route.ts:6-9`), but the route only protects the route, not storage. The lifetime and deactivation issues are the real problems: a removed staff member keeps working links to venue media.

The admin download and stream routes are correct. R4b shows `image/jpeg`, `attachment; filename="dish.jpg"` and `nosniff`.

**Fix**

- Remove end-user SELECT on the `media` bucket. Make `nabalens_media_select` admin-only, or drop it.
- Sign derivatives in `signDerivative` with `actor.service` after `getReadableAsset` has authorised the caller. That check already does everything the policy did.
- If staff must keep SELECT, restrict it to `p_name in (a.preview_path, a.thumbnail_path)`. Derivatives are server-written WebP files with a server-set Content-Type, so the remaining exposure is only their unbounded lifetime.
- Originals are already served only through `streamOriginal`.

---

### F2 (Medium): a delete during finalise ends `ready` + tombstoned, and derivatives are written after the removal

**Where**

- `lib/server/media/finalise.ts:300-318`: derivative uploads, with no check on the tombstone.
- `lib/server/media/finalise.ts:320-325`: the `ready` update filters on `upload_state = 'processing'` but **not on `deleted_at is null`**.
- The DB guard allows `processing → ready` on a tombstoned row, because `media_assets_guard` only protects the tombstone itself.

**Repro (R6, deterministic)**

1. The service client given to `finaliseAsset` runs `removeMediaAssetWith` as the owner just before the first `preview.webp` write. This is the user pressing Delete while the photo is processing.
2. The delete reports `{"ok":true,"storage":"removed"}`.
3. Finalise then returns `{"ok":true,"state":"ready"}`.
4. The row ends as `upload_state = ready` with `deleted_at` set, and `preview.webp` and `thumb.webp` are left under the asset prefix.

**Impact**

- The user is told the photo is deleted. Copies of it (the 1600 px preview and the thumbnail) stay in storage until the next cleanup run. `prepare_media_cleanup` does list them, because they are tombstoned objects.
- They cannot be read, since `can_read_media_object` requires `deleted_at is null`, so this is a retention and privacy-promise problem, not an access problem.
- The client also gets `ready` for an asset it deleted.

**Fix**

- Add `.is("deleted_at", null)` to the ready update at `finalise.ts:320-325`.
- When that update matches no rows, re-read the row. If it is tombstoned, remove `keys.preview` and `keys.thumbnail` with the service role and return `notFound` instead of throwing into the generic 503 path.
- Optional: have `removeStoredObjects` re-list the objects after a short delay when the row was `processing` at delete time.

---

### F3 (Medium): a crashed `processing` claim is never cleaned up

**Where**

- `supabase/migrations/20261029150000_nabalens_media_cleanup.sql:104-115`: only `uploading` and `failed` rows are tombstoned as abandoned.
- `lib/server/media/finalise.ts:18-19,92-102`: a stale `processing` claim (older than 2 min) is only recovered when a client calls finalise again.

**Repro (R7)**

1. Reserve, upload, then set the row to `processing`. This is what a finalise leaves behind when its process is killed, for example by a deploy, OOM or timeout.
2. Run `runMediaCleanup` with `now = +30 days`.
3. The row is still `processing` with `deleted_at` null, and the original is still stored.

**Impact**

- If the browser tab is gone (it closed, or the upload queue was cleared), nothing ever retries.
- The original stays in storage forever, and the row stays in the staff portfolio as "processing" forever.
- The finalise comment at `finalise.ts:213-215` says it deliberately does not touch `processing` rows ("which cleanup never touches"), so the gap is known but never closed.

**Fix**

In `prepare_media_cleanup`, also treat `upload_state = 'processing' and updated_at < v_cutoff` as abandoned. The 24 h window is far longer than `STALE_PROCESSING_MS` (2 min). Alternatively, reset stale `processing` rows to `failed` first, so the existing rule applies.

---

### F4 (Low–Medium): declared size ignored, oversized and failed objects retained, no quota

**Where**

- `lib/server/media/reserve.ts:122-131` checks only the **declared** `sizeBytes`.
- The signed upload URL (`reserve.ts:216-219`) and TUS accept anything up to the bucket's `file_size_limit` of 200 MiB (`20261029120200_nabalens_storage.sql:17`), whatever the reservation's type or declared size.
- `finalise.ts:135-137,166-168` rejects oversized files only _after_ storing them. `finalise.ts:262-263` marks the row `failed` but keeps the object.

**Repro (R5)**

- Reserve declaring `sizeBytes: 10` and upload the real 17,894-byte JPEG. The asset becomes `ready`, and `size_bytes` is rewritten to the actual value. That part is fine: the stored size wins.
- Reserve an **image** declaring 1 KiB, then store **25 MiB** through the same signed URL. The upload is accepted. Finalise returns `failed: "This file is larger than the upload limit."`. An immediate cleanup run leaves all 26,214,400 bytes in place.

**Impact**

- Any active staff member can store `N × 200 MiB` with no rate limit or per-user quota. The bytes stay for at least 24 h after their last activity, and `touchMediaReservation` on reserve or finalise can extend that.
- Finalising a 20 MiB image also buffers the whole file into memory (`finalise.ts:138`). That is bounded, but there is no limit on concurrent calls.
- This is an insider/DoS-on-storage risk, not a confidentiality risk.

**Fix**

- In finalise, after `statMediaObject`:
  - if `size > maxBytesFor(row.media_type)`, fail immediately without reading the body;
  - optionally also fail if `size !== row.size_bytes` (declared). The browser knows the exact `File.size`, so a mismatch means tampering.
- On **terminal** validation failures (not `decoder_busy` or transient errors), remove the original straight away with the service role. Keep the row as `failed` for the UI.
- Add a cap in `reserve_media_asset`, such as "at most K non-ready reservations per uploader in the last hour".

---

### F5 (Low): the reserve RPC is callable directly and skips the route's checks

**Where**

- `supabase/migrations/20261029160000_media_client_upload_key.sql:47-52,79,107-109,143-144`. The RPC is granted to `authenticated` and accepts any `[a-z0-9]{2,5}` extension, any non-negative size, and a NULL key.
- `lib/server/media/finalise.ts:208` only enforces the key when the row has one.

**Repro (R10)**

1. A staff JWT calls `rpc('reserve_media_asset', {p_media_type:'image', p_extension:'html', p_original_filename:'index.html', p_size_bytes:999999999999})`. It returns the key `…/original.html`.
2. A direct `storage.upload(key, html, {contentType:'text/html'})` is **stored**.
3. `finaliseAsset(…, idempotencyKey: "")` runs, because the row has no key. It correctly answers `failed: unsupported type`, and `size_bytes = 999999999999` stays on the row.

**Impact**

- Content validation still decides `ready`, so this is not a validation bypass.
- It does allow non-media keys and arbitrary bytes in the bucket (retained as in F4), and nonsense sizes on non-ready rows.
- It also defeats the "key binds the finalise to its reservation" property. That property is defence in depth only, since RLS already limits finalise to the owner.
- A real JPEG uploaded to `original.html` would become `ready`. The stored object would then carry the client's Content-Type, as in F1.

**Fix**

- In the RPC:
  - require `p_client_upload_key is not null`;
  - check `v_ext` against a per-`p_media_type` allow-list (`jpg png webp heic heif` / `mp4 mov webm`);
  - check `p_size_bytes between 1 and <per-type cap>`.
- Keep `reserve.ts`'s checks for friendly messages.
- In finalise, treat a row with a NULL key as not found.

---

### F6 (Low): the server-issued signed upload URL works after the asset is deleted

**Where:** `lib/server/media/reserve.ts:216-219`. Supabase signed upload URLs are checked against RLS when they are **issued**, and act as the storage server at use time. They last 2 h.

**Repro (R2b)**

1. Reserve, then delete the asset. The delete reports `storage: "removed"`.
2. Replay the reservation's signed URL with arbitrary bytes and `text/html`. The bytes are **stored** under the tombstoned asset's prefix.
3. A TUS upload created before the delete is **rejected** at PATCH with `403 new row violates row-level security policy`. TUS re-checks RLS when it finishes; signed PUT does not.

**Impact:** the object is unreadable (tombstoned) and the next cleanup run removes it. This is a small retention gap and a way to store bytes without an active reservation.

**Fix**

- Accept the risk and document it, and keep cleanup scheduled frequently.
- Or prefer TUS for all uploads, since TUS re-checks RLS when it finishes.
- Or check, during cleanup or after delete, for objects created after `deleted_at`. Cleanup already does this implicitly.

---

### F7 (Info)

- **Stale takeover returns 503 for a ready asset.** Suppose finalise A runs past `STALE_PROCESSING_MS` and B takes over. If A's ready update lands first, B's update matches no rows (`finalise.ts:326`), B throws, and B returns 503 "Could not save" for an asset that is `ready`. The asset itself stays correct, since the bytes are immutable (Section 2). The client retries and gets `ready`. Cosmetic.
- **Content and abuse controls.** There is no malware/AV scan (an OWASP recommendation) and no rate limit on reserve or finalise. Re-encoding derivatives limits what viewers get, but the original passes to admins byte-for-byte through `download`.

## 2. Suspicions checked and **not** reproducible (safe on 3a23c9b)

| Hunt item                                                   | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upload to a key you didn't reserve                          | Blocked. User B's direct upload, B minting an upload URL for A's key, and A minting an upload URL for a derivative key (`preview.webp`) all return `new row violates row-level security policy` (R9). `can_upload_media_object` requires an exact `original_path`, the owner, `uploading`, not deleted, and an active staff member at an active venue.                                                                                                                     |
| Replacing an object between validation and `ready` (TOCTOU) | Blocked. There are no end-user UPDATE/DELETE storage policies. Minting a signed upload URL with `upsert: true` is denied at issue (R1). A TUS create with `x-upsert: true` is denied (R2, 403). Replaying the server-issued URL after `ready` gives `The resource already exists` (R3). The stored object cannot change after finalise's `stat`. The only remaining path is delete-then-recreate (F6), and that only works on a tombstoned asset, which is never readable. |
| Finalising someone else's asset                             | Blocked. User B gets 404, a wrong idempotency key gets 404, and an admin gets 403. The row stays `uploading` (R9).                                                                                                                                                                                                                                                                                                                                                         |
| Retries creating duplicates                                 | Blocked. Five concurrent reserves with one key produce one asset and one row (R8). The unique index plus the `unique_violation` fallback in the RPC work.                                                                                                                                                                                                                                                                                                                  |
| Race between duplicate finalise calls                       | Safe. Five concurrent finalises all return `ready` with one row (R8). The compare-and-set claim and wait loop work.                                                                                                                                                                                                                                                                                                                                                        |
| Size bypass (declared vs actual)                            | Partly (F4). The stored size always wins for `size_bytes` and the limits, but nothing stops the bytes being stored first.                                                                                                                                                                                                                                                                                                                                                  |
| Orphaned `ready` rows                                       | Only through F2: `ready` + tombstoned, which is never readable. No `ready` row without validation: the `media_assets_ready_is_validated` check plus the guard trigger prevent it.                                                                                                                                                                                                                                                                                          |
| Objects left after failure                                  | Yes, by design for 24 h (F4) and indefinitely for `processing` (F3).                                                                                                                                                                                                                                                                                                                                                                                                       |
| Signed URL scope/TTL                                        | The app's own URLs are 60 s, scoped to one derivative, and signed as the caller. User-minted URLs are not limited (F1). Upload URLs are 2 h and scoped to one key (F6).                                                                                                                                                                                                                                                                                                    |
| MIME/Content-Type served from client values                 | App routes: never. `validated_mime_type`, `attachment`, `nosniff` and `private, no-store` are verified (R4b). Storage direct: yes (F1).                                                                                                                                                                                                                                                                                                                                    |
| TUS auth                                                    | The bearer token is refreshed on each request. RLS is checked at create **and** at finish (R2b). The fingerprint is per asset and the `x-upsert: false` header is hard-coded (`lib/upload/tus.ts:68-70`).                                                                                                                                                                                                                                                                  |
| Range reads in finalise                                     | `mediaRangeSource` caps every read at the `stat` size. The image path checks `bytes.byteLength === size`. A storage that ignores Range is handled (`storage.ts:61-62`).                                                                                                                                                                                                                                                                                                    |

## 3. Notes on the transport (`lib/upload`, `use-media-uploader`)

- The idempotency key is created once per file and kept in the queue's resume token (`lib/upload/queue-adapter.ts:39-43`), so retries reuse it. Good.
- `isAlreadyExists` treats a 409 on create or PUT as success and moves on to finalise. That is correct because finalise validates the bytes regardless of who stored them.
- The client-side `preflight` and `contentType` are only hints. The server never reads them for validation (`finalise.ts:133,144`). Good.
- A cancel after the transfer never finalises (`uploader.ts:152-153`). The abandoned reservation is left to cleanup, which falls into F4's retention, not a correctness issue.

## 4. OWASP File Upload Cheat Sheet mapping

| OWASP control                                   | Status                                                                                                                                 |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Allow-list extensions                           | ✅ in `reserve.ts`; ⚠️ skippable through the RPC (F5). The stored extension is cosmetic and download always uses the validated type.   |
| Validate file type by content, not Content-Type | ✅ `sniffMedia` + `validateMedia` on stored bytes, with `declaredMime: ""`.                                                            |
| Don't trust the Content-Type header             | ✅ app routes; ❌ storage keeps and serves the client value (F1).                                                                      |
| Change the filename                             | ✅ The key is `uid/assetId/original.ext`. The display name is cleaned, and Content-Disposition is RFC 5987 with a validated extension. |
| Filename length and characters                  | ✅ `cleanFilename` (255 chars, no control characters or separators) plus a DB check.                                                   |
| File size limits                                | ⚠️ Enforced only after storing (F4). The bucket cap is 200 MiB for every type.                                                         |
| Only authorised users upload                    | ✅ Active staff at an active venue only, checked in the RPC and in the storage insert policy.                                          |
| Store outside webroot / separate domain         | ✅ Private bucket on the Supabase origin. ⚠️ The user-mintable URLs on that origin skip the app's headers (F1).                        |
| Set restrictive permissions                     | ✅ Insert-only for users; no update or delete. ⚠️ SELECT on originals for the owner (F1).                                              |
| Content Disarm / rewrite                        | ✅ Derivatives are re-encoded WebP. Originals are served unchanged (as the spec requires) with `attachment` and `nosniff`.             |
| AV / sandbox scan                               | ❌ None (F7).                                                                                                                          |
| Protect from DoS: rate limits / quotas          | ❌ None (F4, F7). Decoder budgets exist in `lib/media`.                                                                                |
| CSRF on upload endpoints                        | ✅ Server Functions (Next's origin check). Storage calls use bearer tokens, not cookies.                                               |

## 5. Verdict

**Conditional pass.** The core integrity properties hold on the real stack. A validated original cannot be swapped, no one can upload into or finalise someone else's reservation, retries and races do not duplicate rows, and the app's own read paths serve validated types with safe headers. No finding allows unauthorised reads or a validation bypass.

Fix before production:

- **F1:** remove end-user storage SELECT on originals and sign with the service role. This closes the unbounded-lifetime, survives-deactivation and client-Content-Type problems in one change.
- **F2:** guard finalise's ready update and derivative writes against a concurrent delete.
- **F3:** let cleanup collect stale `processing` rows.

F4 and F5 are small hardening changes worth taking in the same PR: fail fast on oversize, delete on terminal failure, and enforce the allow-list, size cap and required key in the RPC. Accept and document F6 and F7.

## Appendix A: how to rerun

```sh
W=/tmp/nl-uppath2-stack
node tests/security/prepare-stack.mjs "$W"
# then in $W/supabase/config.toml: project_id = "nabalens-uppath2", 564xx -> 600xx,
# enabled = false for [studio] [realtime] [analytics] [edge_runtime] [local_smtp]
supabase --workdir "$W" start -x vector,logflare,imgproxy,studio,mailpit,realtime,edge-runtime,postgres-meta,supavisor
S=$(supabase --workdir "$W" status -o json)
export NEXT_PUBLIC_SUPABASE_URL=$(jq -r .API_URL <<<"$S") \
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$(jq -r .ANON_KEY <<<"$S") \
  SUPABASE_SERVICE_ROLE_KEY=$(jq -r .SERVICE_ROLE_KEY <<<"$S")
pnpm exec vitest run --config tests/security/upload-path-review.vitest.config.ts --disableConsoleIntercept
supabase --workdir "$W" stop
```

The repro test and its vitest config were scratch files and were not committed, as the brief required. The config reuses `tests/lifecycle/server-only-stub.ts` and includes only that file. Each test (R1–R10, R2b, R4b, R4c) is short:

- **R1:** while the asset is `uploading`, `createSignedUploadUrl(key, {upsert:true})` as the owner, then upload the valid JPEG, finalise, and PUT HTML to the minted URL.
- **R2:** TUS POST with `x-upsert: true` while `uploading`; finalise a valid JPEG through the signed URL; then PATCH the TUS upload.
- **R2b:** TUS POST (`x-upsert: false`), then `removeMediaAssetWith`, then PATCH. Then replay the server-issued signed URL.
- **R3:** after `ready`, replay the server-issued signed URL with `upsert: true`.
- **R4/R4b/R4c:** upload valid JPEG bytes (R4b: a JPEG with an HTML tail) through the signed URL with a chosen `content-type`, then finalise. Then, as the owner, `createSignedUrl(original, 1 year)`, GET it, deactivate the profile and GET again. Compare with `streamOriginal` as admin.
- **R5:** reserve with `sizeBytes: 10` and upload the real bytes. Then reserve an image declaring 1 KiB and store 25 MiB. Finalise, then `runMediaCleanup(admin)`.
- **R6:** `finaliseAsset({...actor, service: racingService})`, where `racingService` is a service client whose `global.fetch` calls `removeMediaAssetWith` (as the owner) before forwarding the first `preview.webp` request.
- **R7:** after the upload, set `upload_state = 'processing'` with the service role, then `runMediaCleanup(admin, { now: +30 days })`.
- **R8:** `Promise.all` of 5 × `reserveAsset` with one key, then 5 × `finaliseAsset`.
- **R9:** finalise as another staff member, with a wrong key, and as an admin. Direct and minted uploads to foreign and derivative keys.
- **R10:** call `reserve_media_asset` over PostgREST with `p_extension:'html'` and no key, then do a direct `storage.upload` and finalise with key `""`.

## Appendix B: observed output (storage-api v1.72.1, 2026-10-30)

```
R1 mint upsert URL: new row violates row-level security policy
R2 TUS create (upsert): 403 new row violates row-level security policy
R2b TUS create: 201
R2b delete: {"ok":true,"assetId":"60cfe5ea-…","storage":"removed"}
R2b TUS patch after delete: 403 new row violates row-level security policy
R2b object exists after delete: false
R2b signed PUT after delete: stored
R3 replay server URL: The resource already exists
R4 row validated mime: image/jpeg
R4 1-year signed URL by staff: issued
R4 GET: 200 content-type: text/plain; charset=UTF-8 nosniff: null disposition: null
R4 GET after deactivation: 200
R4b raw PUT: 200
R4b finalise: {"ok":true,"state":"ready"} validated: image/jpeg storage metadata: {…"mimetype":"text/html"…}
R4b storage GET: 200 content-type: text/plain; charset=UTF-8 nosniff: null csp: null
R4b app download route: 200 image/jpeg attachment; filename="dish.jpg"; filename*=UTF-8''dish.jpg nosniff
R4c image/svg+xml -> 200 image/svg+xml row: ready
R4c application/xhtml+xml -> 200 application/xhtml+xml row: ready
R4c text/xml -> 200 text/xml; charset=UTF-8 row: ready
R4c application/pdf -> 200 application/pdf row: ready
R4c text/javascript -> 200 text/javascript row: ready
R5 reserved with size 10, resumable: false row size 10
R5 finalise: {"ok":true,"state":"ready"} row size now 17894 actual 17894
R5 25MiB stored into a 1KB image reservation: stored
R5 finalise big: {"ok":true,"state":"failed","error":"This file is larger than the upload limit."} state failed
R5 failed object still stored: 26214400
R6 delete: {"ok":true,…,"storage":"removed"} finalise: {"ok":true,"state":"ready"} row: ready deleted_at set: true objects left: [ 'preview.webp', 'thumb.webp' ]
R7 cleanup @+30d: "completed" row: processing deleted_at: null object kept: true
R8 concurrent reserve same key -> distinct assets: 1
R8 concurrent finalise: 5 × {"ok":true,"state":"ready"}
R8 rows for key: 1 state: ready
R9 B: 404 · wrong key: 404 · admin: 403 "Only staff can upload." · state: uploading
R9 B direct / B mint / A mint derivative: new row violates row-level security policy
R10 rpc: original_path …/original.html, upload_state uploading
R10 direct upload to original.html : stored
R10 finalise (no key on row): {"ok":true,"state":"failed",…} row size_bytes 999999999999
Tests 13 passed (13)
```
