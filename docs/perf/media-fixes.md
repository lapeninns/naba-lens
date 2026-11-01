# Media processing memory: fix 5 of the performance baseline

Scope: `docs/perf/baseline.md` section 7, fix 5 ("Unbounded sharp concurrency and 40 MP HEIC memory"). In-process work in `lib/media`; no stack, no migration.

## 1. Summary

| Target (baseline 7.5) | Before | After |
| --- | ---: | ---: |
| Peak RSS with 10 simultaneous 12 MP JPEG finalises: at most 1 GiB | 1,139 MiB | **497 MiB** |
| Throughput not worse than today (10 at once, per item) | 49.0 ms | 48.0 ms |
| 16 simultaneous 12 MP JPEGs, peak RSS | 1,589 MiB | 520 MiB |
| 10 simultaneous 40 MP JPEGs (the pixel limit), peak RSS | 2,809 MiB | 342 MiB |
| 39 MP HEIC, peak RSS (reported, not changed) | 593 MiB | 595 MiB |
| 1 39 MP HEIC + 10 simultaneous 12 MP JPEGs, peak RSS | 1,643 MiB | 915 MiB |

- Peak memory no longer grows with the number of callers: it is about 500 MiB from 4 to 16 simultaneous 12 MP decodes.
- Sequential JPEG and PNG time is equal or a little lower, and CPU per image drops by 24 to 36%.
- HEIC is unchanged (same worker, same queue); its 39 MP peak of about 595 MiB is the libheif WASM decode, which this change does not touch.
- Derivatives are equivalent: same dimensions, format, alpha and orientation; pixels within the tolerance in section 4.

## 2. What changed

- `lib/media/index.ts`: the derivatives are no longer made from a full-size raw RGBA buffer.
  - The decode resizes from the encoded input (`sequentialRead`, `failOn: "warning"`, `limitInputPixels`, `.rotate()` all kept), so JPEG and WebP shrink while decoding and PNG streams rows.
  - One decode produces the preview-size pixels (1600 px bounding box). The preview WebP is encoded from them and the thumbnail (480 px) is resized from the same pixels.
  - Width and height come from the header (`metadata()`, with `autoOrient` dimensions when the EXIF orientation turns the image), so they are still the oriented size of the original.
  - The avatar derivative resizes (cover, 256 px) straight from the encoded input.
- `lib/media/gate.ts` (new): a FIFO concurrency gate. Callers wait for a slot in arrival order, at most `heicTimeoutMs`, then get `decoder_busy` (already retried by finalise and the profile route). The HEIC queue in `lib/media/heic.ts` now uses the same gate with its own limit; its behaviour is unchanged and its existing tests pass untouched.
- `lib/config/media.ts`: `maxImageConcurrency: 6` for JPEG, PNG and WebP decodes (and avatars) per process.
  - Six is where more parallel decodes stopped adding throughput on this machine (sharp runs its own thread pool). In three tuning runs each (not kept), the batch of ten took 512 to 550 ms with 4 slots, 477 to 487 ms with 6 and 532 to 544 ms with 8; a batch of sixteen took 700 to 733, 752 to 770 and 765 ms. Peak RSS was about 500 MiB with all three, so the choice only affects throughput.
  - On a 2 vCPU function six slots do not limit throughput; they bound memory when many requests arrive at once.
- HEIC does not take an image slot: it has its own worker and queue, and holding an image slot while waiting for the HEIC slot would let a HEIC backlog starve JPEG finalises.

## 3. Measurements

Method: `node --import tsx tests/perf/media-bench.mjs --label -before-N|-after-N` (Baseline's benchmark, one child process per scenario and, new, one per concurrency level so each peak belongs to that level alone). Peak RSS is the process `maxRSS` (`getrusage`), idle about 80 MiB. Three runs of each, alternating before and after, median shown. Raw files: `docs/perf/raw/media/media-bench-before-{1,2,3}.json` and `media-bench-after-{1,2,3}.json`.

The `before` runs use a copy of `lib/` from `225cb4f` run from a scratch directory (the `revision` field in those files reports the checkout it was started from, `225cb4f`, for both); `after` is this branch.

Machine: local macOS laptop, Apple M5 Pro (18 cores, 64 GiB), Node 24.16.0. Other agents shared it: the 1-minute load average at the start of the six runs was 6.7 to 11.5, so absolute numbers are noisy by 5 to 10%; the paired runs are comparable with each other, not with a 2 vCPU function.

### Sequential, one process per input

| Input | wall p50 ms before / after | CPU ms per op before / after | peak RSS MiB before / after |
| --- | ---: | ---: | ---: |
| JPEG 12 MP (4032x3024) | 177 / 169 | 268 / 191 | 381 / 236 |
| JPEG 8 MP (3264x2448) | 150 / 145 | 216 / 164 | 314 / 228 |
| PNG 12 MP | 119 / 112 | 210 / 135 | 371 / 215 |
| HEIC 12 MP | 365 / 368 | 578 / 583 | 402 / 409 |
| HEIC 39 MP | 757 / 751 | 1,170 / 1,159 | 593 / 595 |

Videos (probe only, no sharp) are unchanged: 0.2 to 0.3 ms, 81 to 82 MiB.

### Concurrent callers in one process (one process per level)

| Input | concurrent | batch p50 ms before / after | per item ms before / after | peak RSS MiB before / after (range, 3 runs) | failures |
| --- | ---: | ---: | ---: | ---: | ---: |
| JPEG 12 MP | 1 | 175 / 169 | 175 / 169 | 315 / 200 (197 to 216) | 0 |
| JPEG 12 MP | 2 | 183 / 173 | 91.5 / 86.5 | 505 / 292 (274 to 305) | 0 |
| JPEG 12 MP | 4 | 210 / 187 | 52.5 / 46.7 | 895 / 421 (383 to 446) | 0 |
| JPEG 12 MP | 8 | 412 / 429 | 51.5 / 53.6 | 1,210 / 464 (454 to 464) | 0 |
| JPEG 12 MP | 10 | 490 / 480 | 49.0 / 48.0 | 1,139 / 497 (482 to 523) | 0 |
| JPEG 12 MP | 16 | 797 / 755 | 49.8 / 47.2 | 1,589 / 520 (499 to 543) | 0 |
| PNG 12 MP | 1 | 122 / 113 | 122 / 113 | 310 / 201 (196 to 203) | 0 |
| PNG 12 MP | 4 | 150 / 131 | 37.4 / 32.8 | 888 / 393 (389 to 401) | 0 |
| PNG 12 MP | 10 | 338 / 326 | 33.8 / 32.6 | 1,137 / 431 (422 to 441) | 0 |
| HEIC 39 MP | 1 | 747 / 756 | 747 / 756 | 565 / 578 (571 to 583) | 0 |
| HEIC 39 MP | 4 | 3,048 / 3,024 | 762 / 756 | 603 / 601 (594 to 605) | 0 |
| HEIC 12 MP | 1 | 368 / 370 | 368 / 370 | 379 / 390 (375 to 394) | 0 |
| HEIC 12 MP | 2 | 737 / 746 | 368 / 373 | 398 / 384 (383 to 393) | 0 |
| HEIC 12 MP | 4 | 1,472 / 1,472 | 368 / 368 | 408 / 407 (401 to 417) | 0 |
| HEIC 12 MP | 8 | 2,971 / 2,955 | 371 / 369 | 417 / 411 (409 to 426) | 0 |

Reading the table:

- Throughput is equal within noise. The one cell where `after` is slower is 8 JPEGs at once (51.5 against 53.6 ms per item, 4%), inside the run-to-run spread on a loaded machine (load average 7 to 11); every other JPEG and PNG cell is equal or faster.
- HEIC concurrency stays serial (`maxHeicConcurrency: 1`), so its times and memory are the same before and after.

### The pixel limit case: 40 MP JPEG (8000x5000, 10 MiB)

One extra check, run once per cell from a file, in a clean process each (`maxRSS`, p50 of 3 batches):

| concurrent | wall p50 ms before / after | peak RSS MiB before / after |
| ---: | ---: | ---: |
| 1 | 223 / 141 | 477 / 213 |
| 4 | 312 / 151 | 1,573 / 314 |
| 10 | 700 / 386 | 2,809 / 342 |

Ten simultaneous 40 MP finalises needed 2.8 GiB before, more than the default 2 GiB function; they now peak at 342 MiB.

## 4. Equivalence of the derivatives

`tests/media/derivatives-equivalence.test.ts` keeps the previous implementation (decode to oriented raw RGBA, then resize) as the oracle and compares the library's output with it for generated inputs:

- JPEG: 12 MP, 3 MP (below the shrink threshold), 300x200 (never enlarged), EXIF orientations 3, 6 and 8, Display P3 profile, greyscale, CMYK.
- PNG: 12 MP, partial transparency, 16-bit, palette, EXIF-rotated.
- WebP: 8 MP, with transparency, EXIF-rotated, animated (first frame).
- The 40 MP limit: 8000x5000 is accepted and one more row gives `pixel_limit`, the same as the oracle.
- HEIC fixtures (12 MP and 39 MP): dimensions, format and derivative sizes (the HEIC path is unchanged).

For each, `preview`, `thumb` and the avatar must have identical format (WebP), width, height, alpha and orientation, and no EXIF. Pixels are compared as RGBA:

| Measure | Limit | Worst observed |
| --- | ---: | ---: |
| mean absolute difference per sample (0 to 255) | 2 | 1.41 (transparent WebP avatar); 1.38 (partially transparent PNG thumbnail) |
| share of samples off by more than 24 levels | 1% | 0.09% |

Typical values are 0 for previews that need no shrink and 0.4 to 0.7 for thumbnails and avatars (a resize from 1600 px instead of the full image, or a JPEG DCT shrink). The `reference` implementation lives in the test and is not used by the app.

Behaviour that is deliberately unchanged: size and type checks, MIME checks, `failOn: "warning"` (a corrupt or truncated file is still `corrupt_media`), `limitInputPixels` (`pixel_limit`), the 10 s sharp timeout (`decode_timeout`), EXIF auto-orientation, metadata stripping (every existing test, including the GPS/XMP/ICC and polyglot tests, passes unchanged), and the HEIC worker.

## 5. `decoder_busy` for JPEG, PNG and WebP

The gate adds a wait that ordinary images did not have before. It does not add a way to fail at the loads measured here.

**Queue wait.** `heicTimeoutMs` is 15,000 ms. One 12 MP finalise validation in the same process, many callers at once, 5 batches each (worst single call, which is its queue wait plus its own decode of about 0.2 s):

| simultaneous | worst call before / after | median of the 5 worst, after | `decoder_busy` or other failures |
| ---: | ---: | ---: | ---: |
| 16 | 941 / 801 ms | 787 ms | 0 |
| 32 | 1,670 / 1,572 ms | 1,548 ms | 0 |
| 64 | 3,446 / 3,084 ms | 3,052 ms | 0 |

Callers were already waiting before the change, in sharp's thread pool; the gate moves that wait to a visible FIFO and the totals are the same. A caller only gets `decoder_busy` when it waits 15 s for a slot, which on this machine is a backlog of about 300 12 MP decodes in one process (an estimate for a 2 vCPU function, not measured: roughly 60 to 100).

**One `decoder_busy`, end to end** (nothing here changed, HEIC already behaved this way):

1. `processImage` rejects with `decoder_busy`; `validateMedia` returns `{ok:false, error:"decoder_busy"}`.
2. `lib/server/media/finalise.ts` (`validateStored`) retries once after a 1 s pause (`BUSY_RETRIES = 1`). Each attempt can wait one full queue deadline, so the worst case is about 31 s plus the decode, inside `HEIC_FINALISE_WORST_CASE_MS` (46 s), which `tests/unit/finalise-budget.test.ts` keeps at or under 60 s, half of the 120 s Server Action `maxDuration`. An image attempt needs at most one queue wait plus a decode of at most the 10 s sharp timeout, so it stays within the same bound.
3. If it is still busy, finalise puts the row back to `failed` (the bytes stay in Storage) and answers `503`, "The server is busy processing photos. Try again." Nothing terminal happens: the original is not deleted.
4. The server action returns that to the browser; `app/_media/use-media-uploader.ts` throws it, and `lib/upload/uploader.ts` reports `finalise_failed` with `retryable: true`.
5. **The client does not retry by itself.** The dialog shows the row as "Failed" with that message and a per-file Retry button. Choosing Retry (or the same file after a reload) reserves the same asset, finds the stored bytes and finalises again without uploading anything. So a staff member sees an error and one tap fixes it, not a silent delay. I have not changed the client; an automatic retry there would be a separate decision.

`tests/media/image-gate.test.ts` covers this: 16 and 32 simultaneous 12 MP validations all succeed; with one slot and a 1 ms deadline the second caller gets `decoder_busy` and the next call succeeds; the gate never exceeds its limit, serves in arrival order and releases its slot when the work throws. The route-level path (503, row back to `failed`, Retry resumes) is covered by the existing finalise and upload-recovery suites, which need a stack.

## 6. HEIC running next to a busy image gate

One 39 MP HEIC (`synthetic-39mp.heic`) validated at the same time as 12 MP JPEGs in one process, 3 batches, `maxRSS`:

| Mix | peak RSS MiB before / after | batch p50 ms before / after | failures |
| --- | ---: | ---: | ---: |
| 1 HEIC alone | 575 / 584 | 709 / 728 | 0 |
| 1 HEIC + 6 JPEG | 1,381 / 826 | 814 / 820 | 0 |
| 1 HEIC + 10 JPEG | 1,608 to 1,643 / 865 to 915 | 815 to 819 / 777 to 862 | 0 |
| 2 HEIC + 10 JPEG (second HEIC queues) | 1,538 / 886 | 1,560 / 1,483 | 0 |

The worst case, a HEIC decode plus a saturated image gate, peaks at 915 MiB (including the 80 MiB idle process), under the 1 GiB target; it was 1.6 GiB before. HEIC does not take an image slot, so a HEIC backlog cannot starve JPEG decodes.

## 7. What did not change

- **`failOn`.** It is `"warning"` before and after. It is set once in `decodeOptions` and passed to both the header read and the resizing decode. The HEIC worker never used it.
- **The 40 MP check.** `limitInputPixels` (40,000,000) is the same option on both sharp calls. sharp checks it against the original width times height when it opens the input, before any pixel is decoded, in `metadata()` and in the pipeline alike. Checked directly: 8000x5000 opens, 8000x5001 fails with "Input image exceeds pixel limit" in about 0.2 to 2.7 ms for PNG and for an EXIF-rotated JPEG, and `errorCode` maps it to `pixel_limit`. In the new code the header read runs first, so an over-limit file is rejected before the resizing decode starts. The check is on the stored orientation's dimensions, as before.
- Size and type checks, MIME checks, the 10 s sharp timeout, EXIF rotation, metadata stripping and the HEIC worker are as before; the existing suites pass unchanged.

## 8. Not changed, and what remains

- **HEIC memory.** A 39 MP HEIC peaks at about 595 MiB (80 MiB idle) because libheif decodes the whole image to RGBA inside its WASM heap before sharp sees it. HEIC cannot shrink on load, and the decoder only exposes full-size frames. The queue of one keeps it from compounding (section 6).
- **Real hardware.** This ran on a laptop. The 2 vCPU, 2 GiB Vercel function should be re-measured by whoever owns the deployment; the expectation is the same shape (flat memory, throughput bound by CPU).
- **Thumbnail source.** Thumbnails are resized from the preview-size pixels, not from the original, which is what the table in section 4 measures.
