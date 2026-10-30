# Upload transport (`lib/upload`)

Browser-side transfer of staff photos and videos into the private `media`
bucket. It covers spec §5 "Upload sequence" steps 1, 3 and the client half of
2 and 4. Client-only: no React and no server imports. Import it only from
`"use client"` modules.

```
preflight (size/type) -> reserve() -> transfer -> finalise() -> ready | failed
                         server       TUS or      server
                         action       signed PUT  action
```

## API

```ts
import {
  createUploader,
  toQueueUploader,
  guardBeforeUnload,
} from "@/lib/upload"
import { MEDIA_LIMITS } from "@/lib/config/media"

const upload = createUploader({
  reserve: reserveUpload, // server action, see below
  finalise: finaliseUpload, // server action, see below
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  getAccessToken: async () =>
    (await supabase.auth.getSession()).data.session?.access_token ?? null,
  limits: MEDIA_LIMITS, // structurally matches ClientUploadLimits
  apiKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, // optional, sent as `apikey` on TUS
})

const result = await upload(file, {
  idempotencyKey, // one per file, reused on every retry
  onProgress: (fraction) => {}, // 0..1 of bytes stored
  onStateChange: (state) => {}, // "uploading" -> "processing" -> "ready" | "failed"
  signal, // AbortSignal: cancel
})
// result: { assetId: string | null; state: "ready" | "failed"; error?: UploadError }
```

`upload()` never throws: every outcome is a result. `UploadError` is
`{ code, message, retryable }`, where `message` is plain language for the dialog
and `code` is one of `empty_file`, `unsupported_type`, `too_large` (preflight,
not retryable), `aborted`, `reserve_failed`, `transfer_failed`,
`finalise_failed` (retryable), or `processing_failed` (the server rejected the
content; not retryable). `assetId` is `null` only when the file was rejected
before a reservation.

`onStateChange` fires `uploading` once the file passes preflight, `processing`
once the bytes are stored and `finalise` is called, then `ready` or `failed`.
A preflight rejection or a cancel emits only `failed`.

`upload.activeCount()` returns the number of uploads in flight.

### With the ui track's upload queue / `UploadDialog`

`toQueueUploader(upload, { newKey? })` returns an `Uploader`: exactly the ui
track's injected type `(file, context: UploadContext) => Promise<void>`. Both
types are copied verbatim into `lib/upload/types.ts` (lib must not import
`components/`), and a type test asserts that they match. Pass the result
straight to `useUploadQueue` / `UploadDialog`:

```ts
const queueUpload = useMemo(() => toQueueUploader(upload), [upload])
useUploadQueue({ upload: queueUpload, limits: MEDIA_LIMITS })
```

The mapping:

- `context.onProgress` receives the transfer progress (0..1).
- `context.onProcessing()` fires once, when the bytes are stored and
  `finalise` starts.
- `context.signal` is the cancel signal. A cancel rejects with
  `name === "AbortError"` and never finalises.
- Resolves when the asset is `ready`. Otherwise it rejects with a
  `QueueUploadError`: `.message` is the user-facing text and `.error` holds
  `{ code, retryable }`.
- Resume token (`QueueResumeToken`): on the first attempt it is set to
  `{ idempotencyKey }`, where the key comes from `crypto.randomUUID()` by
  default. Once the server reserves the asset it becomes
  `{ idempotencyKey, assetId, tusFingerprint? }`. The fingerprint is
  `nabalens-media:{assetId}` and is set only for TUS transfers. On the queue's
  `retry()` the same key reserves the same asset, and its fingerprint finds the
  stored TUS upload URL. The transfer then resumes from the server offset with
  no duplicate asset.

`upload()` itself also accepts `onReserved({ assetId, resumable })`, which the
adapter uses to record the asset id.

### Resuming after a reload (`keys`)

`toQueueUploader(upload, { keys: localUploadKeyStore() })` (what
`app/_media/use-media-uploader.ts` passes) remembers each unfinished file's
idempotency key in `localStorage` (`nabalens-upload-keys`). Entries are indexed
by a SHA-256 of name, size, type and modification time, so file names are not
stored, and expire after 20 hours: before the server's 24-hour abandoned-upload
cleanup. When the same file is chosen again after a reload or a closed tab,
`reserve` returns the same asset and the TUS transfer resumes from the server
offset. tus-js-client's own upload URLs also live in `localStorage`.

- The key is forgotten once the file is `ready` or fails validation, so the same
  file chosen later is a new upload.
- The same file added twice in one batch gets two keys.
- If `reserve` throws `ReservationGoneError` (the app maps HTTP 404: the
  reservation was removed or cleaned up), the upload fails with
  `reservation_gone` and "This unfinished upload was removed or expired. Retry to
  upload the file again." The key is dropped, so the retry reserves a new asset.
  Other reserve failures keep the key, so a retry cannot create a duplicate.

### `beforeunload`

```ts
useEffect(() => guardBeforeUnload(() => upload.activeCount() > 0), [upload])
```

This shows the browser's own "leave site?" prompt only while transfers are
running. Transfers cannot continue after the tab closes (spec §5).

## What the slice track must implement

In production builds Next.js replaces the message of an error thrown by a
server action with a generic one. Have the server actions return
`{ ok: false, message }` and let the thin client callbacks you pass to
`createUploader` throw `new Error(message)`. That way the dialog shows the real
reason.

### `reserve(input: ReserveInput): Promise<ReserveResult>`

Input (all browser hints, never trusted): `idempotencyKey`, `filename`,
`sizeBytes`, `contentType`, `mediaType`, `preferResumable`.

The server must:

1. Require an active staff profile with an active venue. Throw an `Error` with
   a plain message otherwise; it becomes `reserve_failed`.
2. Return the existing asset when `(uploader_id, idempotencyKey)` was already
   reserved. Never create a second row for the same key. This is what makes
   retries duplicate-free. It needs a unique key column or table; the
   foundation track owns the schema.
3. Otherwise insert `media_assets` (`upload_state = 'uploading'`) with a
   server-generated id, owner and venue snapshot, and object key
   `{uploader_id}/{asset_id}/original.{ext}` in bucket `media`. Re-check
   `sizeBytes` against `lib/config/media.ts` limits on the server.
4. Return:

| field                  | meaning                                                                                                                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assetId`, `objectKey` | as stored                                                                                                                                                                          |
| `bucket`               | `"media"`                                                                                                                                                                          |
| `resumable`            | `true` → TUS. Recommended: `preferResumable` (videos, photos > 6 MiB)                                                                                                              |
| `uploadUrl`, `token`   | when `resumable` is false: `createSignedUploadUrl(objectKey)` (`signedUrl`, `token`). Sign a fresh URL on every call; signed upload URLs expire after 2 hours                      |
| `state` (optional)     | the asset's current `upload_state`. `processing` → client skips the transfer and calls `finalise`; `ready` → client reports ready at once; `uploading`/omitted → transfer normally |

### `finalise({ assetId, idempotencyKey }): Promise<FinaliseResult>`

Idempotent. Check that the caller owns the asset. If it is `ready`, return
`{ state: "ready" }`. Otherwise set `processing`, download and validate the
stored object with `lib/media` (sniff, size, decode/probe, derivatives), then
set `ready` and return `{ state: "ready" }`, or set `failed` and return
`{ state: "failed", error: "<plain message>" }`. Throwing means "could not
confirm" (`finalise_failed`, retryable): the client retries with the same key
and the server must cope with a finalise that already ran.

## Transfer details

- **Signed PUT** (photos ≤ 6 MiB, `resumable: false`): XHR `PUT uploadUrl`
  with the raw file body, `content-type`, `x-upsert: false`. XHR because fetch
  has no upload progress. Network errors, 5xx and 429 retry with
  `retryDelays`; other 4xx fail.
- **TUS** (videos, photos > 6 MiB, `resumable: true`): `tus-js-client` to
  `${supabaseUrl}/storage/v1/upload/resumable`. It uses 6 MiB chunks (Supabase
  requires that size), `uploadDataDuringCreation: false`, header
  `x-upsert: false`, `authorization: Bearer <getAccessToken()>` refreshed per
  request (long videos can outlive a token), and metadata `bucketName`,
  `objectName`, `contentType`, `cacheControl`. Retry delays are
  `[0, 3000, 5000, 10000, 20000]` ms by default.
- **Resume:** the tus fingerprint is `nabalens-media:{assetId}`, stored in
  `localStorage` by tus-js-client. A retry with the same idempotency key
  reserves the same asset, finds the stored upload URL, sends `HEAD`, and
  continues from the server's `Upload-Offset`. Chunks already stored are not
  re-sent. The fingerprint is removed on success. Within one attempt,
  tus-js-client also retries failed chunks from the server offset.
- **Lost response / 409:** object keys are per asset and never overwritten. If
  storage answers "already exists" (HTTP 409, or HTTP 400 with body
  `statusCode: "409"` / `error: "Duplicate"`) to the signed PUT or to the TUS
  `POST` create, an earlier attempt stored the bytes but its response was
  lost. The client treats the transfer as done and calls `finalise`, which
  validates the stored bytes.
- **Cancel:** aborting the signal aborts the XHR or tus request and never calls
  `finalise`. The TUS upload is not terminated, so a retry can resume it.
  Abandoned uploads are left to the server's 24-hour cleanup (spec §5). Once
  `finalise` has started, cancelling no longer interrupts it; the server owns
  validation from there.

## Tests

`pnpm test` (or `pnpm exec vitest run tests/upload`). `tests/upload/` runs the
real transport against an in-process fake of Supabase Storage:
`@tus/server` + `@tus/file-store` on `/storage/v1/upload/resumable`, plus a
signed-PUT endpoint. The fake reproduces Supabase's no-overwrite 409/400
"Duplicate" behaviour and its 404 for finished TUS uploads, and it can inject
failures. Node stand-ins replace XHR, tus's Blob reader and `localStorage`. The
tests use 64 KiB chunks for speed.

The tests cover a chunked upload with the correct headers and metadata; a chunk
failure retried within one attempt; an interrupted transfer resumed on retry
from the stored offset with no completed chunk re-sent; the storage server
killed and restarted mid-transfer; same-key retries creating no second
reservation or asset; 409 after a lost final response (TUS and signed PUT);
abort with no finalise and no further chunks; preflight rejections with zero
network calls; HEIC/MOV recognised by extension when the MIME type is empty;
the queue adapter run through a driver that mimics `UploadQueue` (progress,
the processing switch, resume token with asset id and fingerprint, a retry
resuming the same asset, and cancel → `AbortError` → no finalise, then resume);
and the `beforeunload`
guard.

**Not verified here:** a real local Supabase Storage. The foundation track owns
`supabase/**`, so it was not started on this branch. Header names, the 6 MiB
chunk size, metadata keys and the 409 shapes follow Supabase's documentation.
Confirm them in the slice track's end-to-end test against `supabase start`.
