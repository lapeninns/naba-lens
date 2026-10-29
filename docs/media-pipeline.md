# Server media pipeline

`lib/media/index.ts` exports pure server functions with no Supabase imports.
Use the Node runtime, not Edge. Originals are never modified. Call validation
before marking an asset ready; storage/upload completion alone is insufficient.

## Formats and contracts

- `sniffMedia(bytes)` returns `{kind,mime,ext}` or null. JPEG, PNG, WebP,
  HEIC/HEIF brands (heic/heix/hevc/hevx/mif1/msf1), MP4, QuickTime MOV and
  WebM are recognised. Signatures are identification only, not validation.
- `validateMedia({bytes?,size?,declaredMime,filename}, limits)` returns
  `{ok:true,kind,mime,ext,size}` or `{ok:false,error}`. Size-only calls return
  `bytes_required`; supplied size must equal the bytes. Filename is untrusted
  display metadata and never establishes type. MIME mismatch fails closed;
  image/heif is an alias for image/heic. Image content is fully decoded;
  video metadata is probed. HTML, SVG and executables fail regardless of name.
- `createImageDerivatives(bytes,mime)` returns WebP `preview` (1600px bounding
  box), `thumb` (480px bounding box) and oriented original width/height.
  No enlargement, source EXIF/GPS or other source metadata is retained.
  JPEG orientation is applied by sharp; libheif applies HEIF container transforms
  while rendering pixels. Animated/multi-image input uses its primary image.
- `createAvatarDerivative(bytes)` returns a cropped 256×256 WebP Buffer.
- Image processing rejects above 40 million pixels, photos above 20 MiB and
  avatars above 5 MiB. Shared defaults are in `lib/config/media.ts`.
  Derivative functions throw; validation converts failures into an error result.

## HEIC decoder proof

Installed policy-compliant dependencies: sharp 0.35.5, heic-decode 2.1.0,
libheif-js 1.23.5 (transitive), vitest 5.0.5. The decoder imports
`libheif-js/wasm-bundle`, whose WebAssembly is embedded in JavaScript; it needs
no system libheif, HEVC-enabled libvips, executable, model download or external
wasm asset. sharp uses its normal prebuilt platform binary. Package-manager
platform selection must run on the deployment target; do not copy macOS
node_modules into Linux. Keep both packages in the server function bundle.

`heic-decode.all` exposes dimensions before allocating the RGBA output. We
reject above the pixel ceiling, decode the primary frame and dispose native
WASM handles in finally. The image enters sharp as raw RGBA, so no source
metadata can reach the WebP. A missing decoder is no longer stubbed with
unsupported_heic_decoder: the installed WASM decoder genuinely works.

Reproduce synthetic fixtures with:

```
node tests/fixtures/media/generate.mjs
/usr/bin/time -l node tests/media/benchmark-heic.mjs
```

Generation uses sharp for a deterministic 4000×3000 RGB gradient and macOS
`sips -s format heic`; ffmpeg 9.0.2 makes blue 320×240 H.264 MP4/MOV and VP9
WebM videos. No downloaded or identifiable-person media is included.

Measured on Node v24.16.0, Darwin arm64, 12 MP gradient HEIC (337286 bytes):
module import 22.40 ms; decode 158.80 ms; process RSS 221462528 bytes;
OS peak RSS 221954048 bytes; elapsed process time 0.20 seconds. These are one
cold-process measurement, not throughput or worst-case limits. Initial solid
colour measurement was 78.88 ms and is superseded by the gradient benchmark.
Tests additionally decode the sample through validation, avatar and derivatives.

This is a Node/WASM deployability proof on the local host, not a Vercel deployment
or Linux load test. Configure a Node function with at least 1 GiB memory, a
30-second processing allowance and one image decode at a time per instance;
measure the actual deployment before release. Two parallel uploads are a
transfer setting, not permission for unrestricted parallel decoding. WASM work
can block the event loop; an external request timeout does not cancel it.
Adversarial CPU use, retained WASM heap growth, HDR/colour fidelity and physical
phone orientation need staging tests. Pixel limits are checked after libheif
has parsed the container, so do not claim a hard process-memory cap.

## Video range strategy and limits

`probeVideo` accepts Uint8Array, local path, or `VideoRangeSource`:
`{size, read(offset,length): Promise<Uint8Array>}`. Supply the full object size
and exact ranges; concatenated first/last fragments lose offsets and are invalid.
ISO-BMFF follows box headers, skips mdat by declared length and reads moov
wherever located, including after a 200 MiB payload. Tests prove this using a
virtual payload whose read callback throws if payload is requested. At most
4 MiB per read and 16 MiB aggregate metadata are allowed; larger metadata
fails `probe_limit`. WebM Info/Tracks must be within the first 4 MiB; a cluster
marker is required. Large files never require a native ffmpeg process.

Result includes MIME, dimensions, duration where present, codec identifiers,
and `likelyBrowserPlayable`. H.264/AAC, VP8/9, AV1, Opus/Vorbis are likely;
HEVC and unknown codecs return false. The UI should feature-detect playback
and show “Preview unavailable in this browser” when needed. This flag cannot
promise playback on a particular browser, codec profile or device.

Container validation detects malformed/truncated structure and missing metadata,
but does not decode every video frame or verify every packet/sample offset.
Corruption inside an otherwise valid mdat/cluster can escape metadata probing.
Full bitstream validation/transcoding requires a separate bounded processing
solution; do not describe this probe as complete video integrity certification.

## Verification and integration

`pnpm install --frozen-lockfile` passes after rebasing on the policy fix (CI=true
was needed to permit replacing this worktree's old node_modules without a TTY).
No release-age policy was bypassed. `pnpm add sharp heic-decode` and
`pnpm add -D vitest` succeed. Unit tests cover valid images/video, disguised,
unsupported, MIME mismatch, oversized, corrupt/truncated inputs, metadata stripping,
orientation, avatar dimensions, HEIC output and bounded video range reads.

No browser journey applies to this server library: e2e is NOT_APPLICABLE.
Actual phone capture/playback, hosted storage, Linux/serverless execution and
UI integration are NOT_RUN. The app build currently contains only the starter
routes, so its success does not demonstrate upload-to-library integration.

Ownership exceptions explicitly requested by the brief: shared MEDIA_LIMITS
file, minimal vitest config and test script/dependencies, and this document.
Foundation should reconcile those files without dropping exports or media tests.

Final local checks (2026-10-29, feat/nl-media):

```
CI=true pnpm install --frozen-lockfile
# Lockfile passes supply-chain policies; Already up to date; exit 0
pnpm typecheck
# tsc --noEmit; exit 0
pnpm lint
# eslint; exit 0
pnpm test
# Test Files 2 passed (2); Tests 20 passed (20); exit 0
pnpm build
# Compiled successfully; Finished TypeScript; static pages 4/4; exit 0
git diff --check
# no output; exit 0
```

The HEVC fallback test alters a sample-description codec label; it tests the
fallback policy only and is not an actual HEVC bitstream playback fixture.
