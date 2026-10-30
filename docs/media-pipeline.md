# Server media pipeline

This library processes media in the Node runtime, with no Supabase imports.
Original bytes are retained unchanged by the caller. Client filenames and MIME
labels do not establish safe content, and validation is not publication clearance.

## Upload API: one image decode

For an image upload call `processImage(bytes, declaredMime?)` once. It validates,
decodes once into oriented raw pixels and builds WebP `preview` (1600px bounding
box) and `thumb` (480px bounding box), returning width/height and detected MIME.
Dimensions come from raw decode information, without a full-resolution encode.
Alternatively, call `validateMedia`: its successful image result already includes
these derivatives. **Persist that result; do not call createImageDerivatives after
validation.** The compatibility `createImageDerivatives` wrapper calls processImage
and is an alternative entry point, not a second upload stage.

`createAvatarDerivative` is a separate profile-photo operation: one decode and a
cropped 256×256 WebP. sharp operations have a 10-second native processing timeout.
Only resized WebP output is returned. EXIF (including GPS/Artist), XMP, orientation
and source ICC metadata do not propagate; tests assert each of these.

Limits live in `lib/config/media.ts`: 20 MiB photos, 200 MiB videos, 5 MiB avatars,
40 million image pixels, decoder deadlines and budgets, worker V8 limits, image
output sizes and video dimensions. Decode errors are typed `MediaError`; validation
returns `{ok:false,error}` including pixel_limit, decode_timeout, decoder_busy,
corrupt_media and VideoProbeError codes such as probe_limit. Oversize and size
mismatch failures occur before decoding.

## Detection and declared MIME

`sniffMedia` inspects signatures/container brands using Buffer views without copying
the input. Recognised images: JPEG, PNG, WebP and HEIC/HEIF. HEIC requires a matching
**major** brand (heic/heix/hevc/hevx/mif1/msf1), matching the decoder's rules. AVIF and
AVIS are unsupported even when compatible brands include mif1. ftyp parsing skips
the minor version and reads separate 4-byte compatible brands. Unknown video brands
are unsupported; QuickTime fallback is permitted only without an ftyp box.

`normalizeDeclaredMime` lowercases, trims and strips parameters. Empty, generic
binary labels and ambiguous aliases (HEIF/HEIC, image/jpg/pjpeg, QuickTime/M4V) are
advisory unknowns. Contradictions between recognised unambiguous labels and detected
content fail; the stored MIME always comes from sniffing and video probing, never
the browser label. For videos those two results must agree, and validation returns
the probe's dimensions, duration, codec list and playability hint.

Signatures identify content; they do not sanitize originals. HTML/SVG/executable
files presented directly are rejected, including misleading extensions. JPEG/PNG
with trailing payloads or video free boxes containing other data can still pass.
The tests explicitly demonstrate this polyglot policy. Derivatives contain newly
encoded pixels, but original bytes remain untrusted and must be served as below.

## HEIC worker lifecycle and measurements

Dependencies: sharp 0.35.5; heic-decode 2.1.0; libheif-js 1.23.5 (transitive).
The embedded WASM bundle needs no system HEVC decoder, ffmpeg or external wasm file.
The decoder is imported **only inside** `lib/media/heic-worker.mjs`.

Every operation creates a fresh worker_thread, including its own WASM context.
Only one HEIC worker may run per module instance. A concurrent request returns
`decoder_busy`; retry through the caller's bounded job scheduling. There is no
in-memory queue retaining arbitrary upload buffers. The 15-second wall deadline
covers worker startup, decode and derivatives. The parent awaits termination on
success, error or timeout before releasing the slot. Decoder stdout/stderr is drained
without copying attacker-controlled parser diagnostics into application logs.
Worker resourceLimits are 128 MiB old V8 generation, 16 MiB young generation and
4 MiB stack. **V8 resourceLimits do not cap WASM linear memory, raw buffers or native
sharp/libvips memory.** Worker disposal addresses retained decoder contexts; it is
not an OS hard memory sandbox. Use host memory limits and load testing as well.

The decoder exposes top-level images but does not expose primary-image identity.
We process the first top-level image, **not a guaranteed HEIF primary image**.
Container transforms are handled by libheif's display path; physical-phone rotation,
HDR/colour fidelity and multi-image primary ordering remain staging coverage gaps.
Pixel limits are checked after container parse and before output RGBA allocation;
they do not prove a hard peak memory ceiling for malicious containers.

Reproduce fixtures with `node tests/fixtures/media/generate.mjs` (macOS sips + sharp)
and `node tests/fixtures/media/review-generate.mjs` (local ffmpeg). All inputs are
synthetic gradients/colour frames, with no identifiable people. Run the worker
memory regression and print measurements with:

```
node tests/media/benchmark-heic.mjs
# invokes vitest run tests/media/heic-memory.test.ts --disableConsoleIntercept --silent=false
```

Measured 2026-10-29 on Node v24.16.0, Darwin arm64, one test process. Times include
worker startup, one HEIC decode, both derivatives, result delivery and termination.
RSS is sampled every 5 ms; peaks can miss shorter spikes. These replace the earlier
in-process decoder measurements and the unsupported 1 GiB sizing claim.

| Scenario | Input bytes | Count | Total ms | Starting RSS bytes | Sampled peak RSS bytes | Ending RSS bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 12 MP (4000×3000) | 337286 | 1 | 336 | 86294528 | 359251968 | 281690112 |
| 39 MP (7500×5200) | 1083818 | 1 | 757 | 281706496 | 690929664 | 461307904 |
| Sequential 12 MP | 337286 | 30 | 11077 | 461307904 | 599752704 | 512851968 |
| Malformed HEIC-branded garbage | 19922944 | 100 | 8215 | 512851968 | 649904128 | 524730368 |

The memory regression bounds peak growth for a single 12 MP operation below 512 MiB,
39 MP below 1 GiB, and ending RSS growth for each repeated/failure series below
384 MiB. These broad allocator tolerances catch the prior multi-GB retention;
they are test thresholds, not a promise about all hosts/files. Native allocators
retain memory after workers exit, so zero RSS growth is not expected.

Start staging with a 2 GiB Node function, one decode at a time and a host timeout
longer than the 15-second worker deadline. This is a measurement-led staging
starting point, not a certified production minimum. Limits are per module instance;
multiple server processes/instances each have their own slot.

Deployment must include the unbundled heic-worker.mjs and its resolvable heic-decode
and sharp dependencies. Next/Vercel integration must explicitly trace/include the
worker (for example outputFileTracingIncludes) and smoke-test worker startup in the
deployed Linux function. Do not copy macOS node_modules into Linux. This library's
starter app build does not exercise a hosted media route, so hosted worker packaging
and Linux memory/load tests are NOT_RUN and remain release requirements.

## Video validation by ranges

`validateMedia({source, declaredMime, filename, size?})` accepts a local path or
`VideoRangeSource {size,read(offset,length)}`. It reads at most the first 64 KiB for
sniffing, then uses the same source for probing. Whole-file Uint8Array input remains
supported through zero-copy views. Images still require their complete bytes.
Size-only requests return bytes_required and never approve content.

Use stable object size/content for the lifetime of a probe; paths must be trusted
server-generated local paths. Source adapters need their own network timeouts.
Never concatenate first/last fragments: range offsets must refer to the full object.
ISO-BMFF follows headers and skips mdat to find moov at the tail. Tests send a full
200 MiB virtual source and a sparse local file through validation, return dimensions,
and assert fewer than 12 reads and 100 KB transferred for that test source.
Probe budgets: 4 MiB per read, 16 MiB aggregate, 96 requests, 64 top-level boxes.
Validation adds one head read. WebM metadata must be within the initial 4 MiB;
out-of-budget metadata returns probe_limit. Corruption of media packets can escape
metadata probing: this does not certify complete bitstream integrity.

Only enabled video/audio tracks participate. Dimensions come from the first enabled
video track and tkhd orthogonal rotation is applied; unsupported transforms fail.
Metadata/disabled poster tracks do not change codecs or dimensions. WebM dimensions
must be positive and at most 32768; larger values fail rather than overflow DB fields.
Fragmented MP4 and zero/unknown movie duration return undefined.

`likelyBrowserPlayable` is deliberately narrow: MP4 with baseline/main H.264, or
High with explicit 8-bit 4:2:0 AVC configuration, level ≤5.1, and accompanying AAC;
WebM VP8/VP9 with Opus/Vorbis. QuickTime, HEVC, AV1, other profiles/codecs and uncertain
configurations return false. This can produce false negatives for capable browsers.
**The UI decides using canPlayType and the video element's onerror**, offering
“Preview unavailable in this browser” plus an authorised original download.
No universal transcoding or guaranteed cross-browser playback is claimed.

## Requirements for download/sign routes

These routes belong to the integration track. Before serving any original:

- Authorise the current caller and asset; use only ready, non-deleted validated media.
- Set `Content-Type` from persisted validated MIME, never the client label/filename.
- Set `Content-Disposition: attachment` with safely encoded/sanitized filenames.
- Set `X-Content-Type-Options: nosniff`. Do not render originals as HTML or serve
  attacker-supplied Content-Type/disposition parameters.
- A signed URL must enforce attachment and validated Content-Type at the storage
  response. Verify nosniff at the actual response; if storage cannot enforce all
  required headers, proxy the download through an authorised route that can.
- Keep responses private and use the shared short signing TTL. Derivative preview
  access still requires authorisation; a sanitized derivative does not make it public.

These are required integration contracts, not claims that routes or provider headers
have been implemented or deployed in this library track.

## Verification scope

Deterministic tests cover worker recycling/concurrency/deadline recovery, memory
regression, single-entry processing, metadata stripping, MIME aliases/contradictions,
major/minor brand parsing, polyglots, range/path validation, rotation and enabled
tracks, fMP4 unknown duration, real locally generated HEVC MOV, absent WebM Duration,
metadata budgets, dimension overflow and the original valid/corrupt/truncated cases.
Physical iPhone samples and hosted Linux execution are NOT_RUN. No applicable browser
journey exists in this server library; e2e is NOT_APPLICABLE per qa-with-e2e guidance.
Shared config and this document are the explicitly requested ownership exceptions.

## Review remediation and final local checks

Review findings 1–4, 6, 8–11 are fixed in the library. Finding 5 is documented
accurately with mandatory response-header requirements for the route-owning track;
trailing-payload rejection was optional and is not implemented. Finding 7 now uses
HEIC major brands and explicitly documents first-top-level-image behaviour rather
than claiming primary-image selection. Finding 12 has regression coverage including
real synthetic HEVC; physical iPhone footage remains NOT_RUN.

Final command output (2026-10-29, feat/nl-media):

```
pnpm typecheck
$ tsc --noEmit
# exit 0
pnpm lint
$ eslint
# exit 0
pnpm test
Test Files 5 passed (5)
Tests 41 passed (41)
Duration 26.41s
# exit 0
pnpm build
Compiled successfully in 445ms
Finished TypeScript in 1411ms
Generating static pages ... 4/4
# exit 0
git diff --check
# no output; exit 0
```

No provider mutation, push, PR, merge or deployment was performed.

## Upload recovery, browser playback and storage limits (uploads track, 30 Oct 2026)

Measured on this Mac (Darwin 27.0.0, Apple silicon) against an isolated local stack
(`storage-api` v1.72.1, file backend), with synthetic fixtures from
`tests/fixtures/uploads/generate.mjs`. Evidence: `tests/e2e/upload-recovery.spec.ts`,
`tests/integration/upload-recovery.test.ts`, `tests/integration/upload-limits.test.ts`.
Physical phones and hosted Supabase were **not** tested.

### Browser playback matrix (staff viewer, `/api/media/{id}/stream`)

"plays": the `<video>` element decoded frames (`videoWidth > 0`, `currentTime > 0`).
"fallback": the viewer showed "Preview unavailable in this browser". No case left a
broken player. Admin download of the HEVC original was byte-identical (SHA-256) in
every run.

| File (validated type, codec)        | Chromium 156 (Playwright) | WebKit 27.2 (Playwright) | Firefox                  |
| ----------------------------------- | ------------------------- | ------------------------ | ------------------------ |
| `clip-h264.mp4` (video/mp4, avc1)   | plays                     | plays                    | not run (see below)      |
| `clip-hevc.mp4` (video/mp4, hvc1)   | fallback (MediaError 4)   | plays                    | not run                  |
| `clip.mov` (video/quicktime, avc1)  | fallback (see defect)     | plays                    | not run                  |
| `clip.webm` (video/webm, VP9)       | plays                     | plays                    | not run                  |

- **Chromium and MOV.** `canPlayType("video/quicktime")` is `""` in Chromium, so the
  viewer shows the fallback without trying. A raw `<video>` given the same H.264 MOV
  **does** play in Chromium (640×360, `currentTime` advanced). iPhone MOVs are usually
  H.264 or HEVC, so letting the element try `video/quicktime` (and relying on its
  `onError` fallback, which already works for HEVC) would show more previews. The
  viewer belongs to the visual-a11y track (`components/nabalens/media-viewer.tsx`).
- **Chromium and HEVC.** `canPlayType("video/mp4")` says "maybe", the element then
  fails with `MEDIA_ERR_SRC_NOT_SUPPORTED`, and `onError` swaps in the fallback. Branded
  Google Chrome on macOS may decode HEVC through VideoToolbox; that was not tested.
- **WebKit** is Playwright's WebKit build, not Safari on iOS. It played all four files
  here, including HEVC and VP9 WebM.
- **Firefox: not run.** Playwright's Firefox (builds 1555, 1543 and 1538) does not
  start on this host: `Could not find profile folder` (or a launch timeout), whatever
  `TMPDIR` is. The e2e test records this as a "not run" annotation, not a pass.

### Storage and bucket limits (local stack)

| Limit                                   | Value                                    | How verified                                            |
| --------------------------------------- | ---------------------------------------- | ------------------------------------------------------- |
| `media` bucket                          | private, `file_size_limit` 209,715,200 B, no MIME allow-list | `storage.getBucket` in `upload-limits.test.ts`          |
| `avatars` bucket                        | private, 5,242,880 B, `image/webp` only  | same                                                    |
| Storage server global limit             | `FILE_SIZE_LIMIT=209715200` (from `[storage] file_size_limit = "200MiB"`) | container env; TUS create at 200 MiB + 1 B returns **413** "Maximum size exceeded", at exactly 200 MiB returns 201 |
| 200 MiB video via TUS                   | 34 × 6 MiB PATCH requests, 7–8 s locally, finalised `ready` | real upload of an exactly 209,715,200 B H.264 MP4       |
| App limits                              | `reserve` refuses declared sizes over 20 MiB (photo) / 200 MiB (video); `finalise` measures the stored object and fails anything over the limit, whatever was declared | `upload-recovery.test.ts` (21 MiB photo with a 1,000 B declared size → `failed`, "larger than the upload limit") |

The product limit (200 MiB) equals both the bucket and the global limit, and the
boundary is inclusive. **Hosted Supabase is different**: the global upload limit is
set per project and depends on the plan (the Free plan caps uploads at 50 MB). Before
release, check the hosted project's global "Upload file size limit" is at least
200 MiB and that the `media` bucket's own limit is 200 MiB; otherwise videos between
the two limits fail at storage with HTTP 413, which the client reports as "This file
is larger than the storage limit."

### Recovery behaviour verified in the real UI

- **Mixed batch** (12 chosen): the 21 MiB photo ("Photos can be up to 20 MB.") and the
  11th file ("You can upload up to 10 files at a time.") are refused before any
  request. Of the 10 uploaded, 8 become `ready` (JPEG, PNG, WebP, HEIC, H.264 MP4, MOV,
  WebM, JPEG), the disguised HTML fails with "This file type is not supported." and
  the truncated JPEG with "This file is damaged or could not be read." At most two
  storage requests were in flight at once (observed: exactly 2, with storage slowed
  by 400 ms per request so the overlap was observable). Every `ready` row has a
  validated type, size and stored original, plus both derivatives for photos.
- **Server Functions run one at a time.** Next dispatches a client's Server Function
  calls sequentially, so one file's `reserve` or `finalise` (for example a long HEIC
  decode) delays the other file's `reserve`/`finalise`. Storage transfers still run
  two at a time. Moving reserve/finalise to Route Handlers would remove this queueing.
- **Retry** after a dropped connection (the transport's own 6 attempts over ~38 s)
  reuses the same asset id; one row, one finalise.
- **Cancel** while the reservation is in flight, while the bytes are in flight, and
  while queued: no finalise call is made (observed on the network), queued files are
  never reserved, and the abandoned reservations are tombstoned by
  `prepare_media_cleanup` only after the 24 h window. Until then the portfolio lists
  them with the "Uploading" label.
- **TUS interruption.** A chunk whose connection drops is followed by `HEAD` and a
  `PATCH` from the server's offset; completed chunks are never resent. When the
  connection stays down past the client's retries, the file shows "The connection was
  interrupted. Check your connection, then retry: the upload continues where it
  stopped." and **Retry** resumes the same asset from its offset (no new `POST`).
- **Reload or closed tab.** Transfers stop (not promised to continue). The portfolio,
  after a reload and in a fresh context, shows the asset as unfinished from server
  state. Choosing the **same file** again in the same browser reserves the same asset
  (its key is remembered in `localStorage` for 20 h, under a SHA-256 of name, size,
  type and modification time) and TUS resumes from the stored offset. In another
  browser it becomes a new upload, and the unfinished one is cleaned up after 24 h.
