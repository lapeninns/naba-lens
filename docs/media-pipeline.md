# Media pipeline

Server-only pure functions live in lib/media. No storage or Supabase dependency.
JPEG, PNG and WebP use sharp with strict decode warnings, a 40 MP pixel ceiling,
auto orientation, WebP output without source metadata, 1600px preview and 480px
thumbnail bounding boxes. Avatar output is a cropped 256px square.

HEIC/HEIF brands are recognised but processing fails with typed
unsupported_heic_decoder. RELEASE BLOCKER: no deployable HEVC decoder has been
proved, no synthetic 12 MP HEIC benchmark has run, and no deployment memory/time
claim is made. Never mark HEIC ready on this implementation.

Dependency setup is blocked: pnpm install --frozen-lockfile and pnpm add sharp
both fail ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION on nine existing lock entries.
The policy was not bypassed. sharp is currently only a transitive lock dependency
(0.35.5); integration must add it directly using pnpm once policy permits.
No vitest harness is installed. Image functions remain unverified until then.

Size-only validation is a reservation check, never content approval: it returns
bytes_required. Declared MIME must match detected content (image/heif aliases
image/heic). Filename never establishes type. Decoder failures prevent readiness.

Video probing checks container metadata, not full codec bitstream integrity.
A successful probe cannot prove every media packet is decodable. Native ffmpeg
and universal video transcoding are outside this pipeline. Physical phones,
serverless deployment and actual browser codec playback are untested.

The shared lib/config/media.ts was created as the explicitly requested ownership
exception; foundation should preserve the same exported MEDIA_LIMITS names.

probeVideo accepts Uint8Array, a local file path, or VideoRangeSource
{size, read(offset,length)}. ISO-BMFF reads box headers and skips mdat by length,
so tail moov is found without downloading 200 MiB. Limits: 4 MiB per read and
16 MiB total metadata. Oversized metadata fails probe_limit. WebM reads initial
metadata within 4 MiB and requires a cluster marker. It returns codec identifiers
and likelyBrowserPlayable; this is a conservative hint, not browser capability
negotiation. Container tests and malicious-input fuzzing remain required.

Validation attempted: pnpm typecheck, pnpm lint, pnpm test, pnpm build all
exit 1 at automatic install, with the same minimum release age policy failure.
Direct node node_modules/typescript/bin/tsc --noEmit exits 2:
lib/media/index.ts(1,19): TS2307 Cannot find module 'sharp'.
