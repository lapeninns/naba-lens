# Workstream 3 after-measurements: Catalogue and Media Performance

Measured by the Baseline agent on stack `spare6`, with the same harness and the same stack settings as `docs/perf/baseline.md`. Every number here comes from `tests/perf/` run against the integrated fixes. The figures in the agents' own reports (`library-fixes.md`, `menus-fixes.md`, `media-fixes.md`) are repeated only to compare with mine.

## 1. Summary

- **Targets met at the high volume (221k media): fixes 1, 2, 5 and 6, and the cursor part of fix 4.** Every library filter that took 1 to 8 s now answers in 2 to 47 ms p95; `getMenuVersion` on the largest venue went from 18.9 s to 24 ms; 10 simultaneous 12 MP finalises peak at 424 to 491 MiB instead of 1.1 GiB; 2,000-item import preview went from 0.8 to 1.4 s down to 55 to 69 ms. No request failed anywhere (all four volumes, all benches). The 500k volume answers without a timeout.
- **Targets not met:**
  - Refresh of 50 loaded gallery pages at most 150 ms (fix 4): 228 / 238 ms unfiltered and 220 / 251 ms for the largest venue (baseline 236 / 260 and 264 / 297). The cursor pages are fast (about 4.5 ms each); the refresh makes 50 of them one after another. This was not changed by the fix.
  - `/admin?venue=` page within 2x of the feed itself (fix 3, "3b"): **not met as written**. The page takes 54 / 64 ms and the feed query 5 ms. In absolute terms the page went from 551 ms to 54 ms. The filter options themselves are met (41.5 ms p95 against 150). The 2x target was not attainable for any page: the unfiltered `/admin` page already takes 16 ms against 6.4 ms for its feed call alone (2.5x; 10.6 against 7.4 ms before), because the page adds authentication, the venue and staff lists, rendering and the HTTP response. Library's reading (2.3x the unfiltered page) is a note, not a pass.
- **Slower but within target (accepted; none is a 7.9 protected fast path):** common-term text search. `q=tikka` runs in 22.7 ms in the database against 4.2 ms with the old function called the way the app called it, and the app function takes 29 ms against 17 ms. The same for `tikka` in the largest venue (42 ms against 13 ms) and for the popular-item filter (31 ms against 12.7 ms). Details in section 4 ("Slower but within target").
- **Indexes:** the 8 new trigram / GIN indexes cost no measurable write time on label save or finalise and about 10% on creating a 2,000-item menu draft (section 7).
- **Not measured:** finalise memory on a 2 vCPU function, hosted Supabase, browsers, real photos, the deferred items 7.7, 7.8 and 7.9. See section 10.

## 2. Revision, machine, settings

- Integrated head `575fc4e` (branch `ws3/catalogue-media-performance`: Library, Menus and Media fixes; 14 migrations, the latest `20261101110000`). The app under test was **built from `ws3-baseline` at `fb110c9`**, which is `575fc4e` plus only files under `tests/perf/` (no change to `app/`, `components/`, `lib/` or migrations). `package.json`, `pnpm-lock.yaml` and `pnpm-workspace.yaml` are identical to `575fc4e`.
- `next build` exit 0, then `next start -p 3646` (production build) for the page and API timings. Function and database timings run in-process against the local Supabase API, as in the baseline.
- Machine: Apple M5 Pro, 18 cores, 64 GiB, macOS (Darwin 27.0.0), node v24.16.0, Postgres 17.6 (aarch64) with `shared_buffers` 128MB, `effective_cache_size` 128MB, `work_mem` 4MB, unchanged from the baseline run.
- **Load.** This is a shared laptop. The baseline ran at load 4 to 6; the after-runs ran at 5 to 8 (each raw file records the load at start and end). Where a result is borderline the load is noted. Where a path did not change, the effect of load is visible: the unfiltered `/admin` page at high took 10.6 ms in the baseline (load 4) and 16.2 and 16.9 ms in two after-runs (load 8), although its code and the feed function (7.4 ms before, 6.4 after) did not get slower.
- Volumes: `current`, `expected`, `high` (221k media) and `xl500k` (500k media, added by the Library work and now in `generate.mjs`). The generator is not byte-reproducible: counts at `current` and `expected` are identical to the baseline run; at `high` two small tables differ by 4 rows (`media_label_items` 176,784 in the baseline, 176,788 here; `menu_item_suggestions` 1,238 and 1,237), and against the Library agent's `high` by 7 to 16 rows (`media_labels` 125,097 against 125,084). Row counts of `media_assets` and the receipts are equal. The differences are below 0.1%.

## 3. Method

- Same actors, targets and repetitions as `baseline.md` (section 4 there). Each volume is loaded with `tests/perf/generate.mjs`, then `tests/perf/run-after.sh <volume> docs/perf/after-raw` runs: app function timings (`db-bench`), `EXPLAIN (ANALYZE, BUFFERS)` of the old statements and of `library_page` (`library-explain`), library bad-case shapes (`library-bad-cases`), gallery refresh and concurrent admins (`refresh-bench`), pages and API from `next start` (`ttfb-bench`), delivery routes (`delivery-bench`), menu import and catalogue by menu size (`menu-bench`) and the archived-heavy venue (`menus-archived-bench`). At `high` it also runs the index write-cost A/B (`index-cost`). Media processing is measured in-process without a stack (`media-bench`), three runs.
- `tests/perf/compare.mjs` renders before and after side by side from `docs/perf/raw` (baseline) and `docs/perf/after-raw`. The full tables are in section 11.
- Raw data: `docs/perf/after-raw/<volume>/`, plus `docs/perf/after-raw/media/` and repeats in `docs/perf/after-raw-checks/` (portfolio cursor x3, a second page run at high, the second data load at high).
- **Same-call-shape rule.** The app calls `library_assets` through PostgREST, which passes arguments as values from a `json_to_record` row, not as constants. With constant arguments the planner chooses a different plan for the old function that is seconds slower (2.1 s for `tikka` at high against 6 to 8 ms in the app's shape). A first version of my old-against-new search comparison used constants; its old-function numbers (2 to 3 s) were wrong for what the app did and are not used anywhere. It was rerun in the app's shape (section 4). The `REF library_assets` rows in `library-bad-cases.json` call the old function with constants; see section 3a. The baseline `db-bench` numbers are the before-figures.

## 3a. The old function in the app's call shape (corrects the `REF library_assets` rows)

`library-bad-cases.mjs` times the old `library_assets` as a reference ("REF" rows, quoted in `library-fixes.md`) by calling it with literal arguments. PostgREST does not: it passes the arguments as values of a `json_to_record` row. The planner treats these differently. With literals the old function builds hashed subplans over all of `media_labels` / `media_label_items`; in the app's shape it walks the feed index and probes each row. For `tikka` at high that is 2.1 s with literals and 6 to 8 ms in the app's shape (the app function takes 17 ms). So the REF rows are not what the app ran, and a statement such as "faster than the old function in every shape" must be checked against the app's shape.

`tests/perf/old-new-shapes.mjs` does that: the old function in the exact statement PostgREST sends (the form `explain.mjs` captured), against `library_page`, as the signed-in admin with RLS, in the data shapes `library-bad-cases.mjs` builds. Each scenario is one transaction that reshapes the data, times old, new, old, new (3 warm-ups, 10 timed runs each, so two rounds per side), and rolls back (checked afterwards: 221,172 assets, 121,026 labelled, as before). It runs at `high` only: `xl500k` was no longer loaded when this was asked. p50 / p95 ms in the database, round 1 and round 2, load about 6 (`after-raw/high/old-new-shapes.json`):

| Shape (high, admin) | old, app shape | new `library_page` | new slower than old? |
| --- | ---: | ---: | --- |
| control: labelled (natural) | 757.6 / 800.4 and 757.2 / 804.1 | 0.3 / 0.3 and 0.3 / 0.3 | no |
| control: unlabelled (natural) | 764.8 / 810 and 750.8 / 820.1 | 0.2 / 0.2 and 0.2 / 0.3 | no |
| control: category | 2,335 / 2,668 and 2,405 / 2,552 | 3.4 / 4 and 3.3 / 3.8 | no |
| control: search `tikka` | 3.8 / 4.4 and 3.5 / 3.8 | 22 / 23.1 and 21.4 / 22 | **yes, 6x (about 18 ms)** |
| unlabelled, none unlabelled | 1,604 / 1,680 and 1,593 / 1,748 | 24.1 / 25.7 and 22.8 / 25.9 | no |
| unlabelled, only the oldest 5,000 unlabelled | 1,564 / 1,897 and 1,585 / 1,629 | 214 / 238 and 202 / 211 | no |
| labelled, only the oldest 5,000 labelled | 155 / 189 and 160 / 168 | 73.9 / 78.8 and 71.6 / 90.6 | no |
| labelled, none labelled | 130.5 / 137 and 126 / 130 | 25 / 25.5 and 25.8 / 28.7 | no |
| labelled, only 200 labelled | 24.7 / 36.8 and 22.4 / 24.8 | 9 / 10.8 and 8.5 / 8.9 | no |

**In none of the four reshaped label-state shapes is the new function slower than the old one in the app's shape**, nor in the labelled / unlabelled / category controls: it is 2x to 2,500x faster. The only shape where the new function is slower is text search for a common word (`tikka`), already reported in section 4. The literal-argument REF rows in `library-bad-cases.json` (for example "unlabelled, nothing unlabelled": 1,527 ms REF at high) are close to the app-shape numbers here (1,593 to 1,604 ms) for the label-state shapes, so for these shapes the REF rows were a fair stand-in. They are not for search: `tikka` as admin is 2.1 s with literals and 3.5 to 3.8 ms in the app's shape. I did not re-measure the staff REF rows (`staff search 'tikka' (library_assets, reference)` and the like) in the app's shape.

## 4. Targets, one row each

p95 in ms at the high volume unless noted; "baseline" and "mine" are `tests/perf` app-function timings on `spare6`; "agent" is the number the fix owner reported on their own stack. The baseline column is my baseline (p50 / p95 where it fits).

### Fix 1: `library_assets` label filters (Library). Target p95 at most 250 ms

| Path | baseline | agent after | my after | verdict |
| --- | ---: | ---: | ---: | --- |
| category = curries | 3,259 / 3,278 | 24.2 | 11.1 | met |
| category, cursor at 50% | 3,692 / 4,164 | 23.2 | 12.4 | met |
| venue (largest) + category | 3,550 / 4,426 | 27.4 | 9.5 | met |
| labels = labelled | 1,067 / 1,243 | 9.5 | 6.9 | met |
| labels = unlabelled | 1,096 / 1,181 | 4.9 | 4.3 | met |
| item filter, rare item | 269 / 320 | 14 | 6.5 | met |
| search `tikka` | 17.1 / 20.2 | 110.4 | 31.8 | met (slower than baseline) |
| search `chicken` | 53.7 / 65.8 | 76.8 | 28.2 | met (slower in the database) |
| search `sunday` | 126 / 146 | 76.9 | 35.1 | met |
| search no match (`zzzqq`) | 8,015 / 8,022, 8 of 8 failed (57014) | 4.2 | 2.5 | met |
| `tikka` + venue (largest) | 43.7 / 45.3 | 85.9 | 46.9 | met |
| plan: no seq scan of `media_labels` / `media_label_items` | seq scans of both | none | none in the natural shapes at all volumes; see below | met, with two exceptions |
| no 57014 at 500k | n/a | none | none (no failure in any bench at 500k) | met |

- The natural plans of `library_page` (`explain-library-page/`) use no seq scan of a label table at `expected`, `high` and `xl500k`. Exceptions: the label-state helper reads `media_labels` in a seq scan when no asset is unlabelled (34 ms at high, 104 ms at 500k, Library reports 45 and 217 ms) and the category candidate helper reads `media_label_items` at 500k (1.2 ms). Both are in shapes the data does not have naturally.
- Text search is slower than before for common words, same call shape, same stack, same minute, 2 rounds x 20 runs (`after-raw/high/search-reference.json`, admin as signed in, p50 / p95 in the database):

| Search | old function (app's call shape) | `library_page` |
| --- | ---: | ---: |
| `tikka` | 4.2 / 4.5 and 5.6 / 10 | 22.7 / 24.2 and 22.8 / 24.5 |
| `tikka` in the largest venue | 13.3 / 13.8 and 13.4 / 14.5 | 42.1 / 43.2 and 41.4 / 42.4 |
| `chicken` | 17.6 / 18.7 and 17.2 / 20.4 | 27.2 / 28.6 and 26.5 / 27.7 |
| `chicken` in the largest venue | 22 / 25.4 and 20.4 / 21 | 30.3 / 32.7 and 30.5 / 31.2 |
| `sunday` | 38 / 41.7 and 35.8 / 36.7 | 21.6 / 23.8 and 19.8 / 21.1 |
| `sunday` in the largest venue | 34.8 / 35.8 and 34.1 / 35.1 | 21.6 / 24.2 and 20.1 / 21.3 |
| `zzzqq` (no match) | 7,092 / 7,150 and 7,312 / 7,570 | 0.5 / 1 and 0.5 / 0.8 |
| `zzzqq` in the largest venue | 2,029 / 2,140 and 2,146 / 2,163 | 0.5 / 0.7 and 0.5 / 1.4 |

  A word that matches many assets early in the feed was fast with the old function, because the feed walk found 25 matches after about 170 rows. The new function reads up to 3,000 candidate ids first, which costs about 20 ms however early the matches are. Rare words and no-match searches are the cases the old function could not do. The loss is 15 to 30 ms on three searches; the target is 250.
- The popular-item filter went from 12.7 / 16.6 (p50 / p95) to 31 / 33.5 ms at high, 9.2 to 13.7 at expected, and is flat at 500k (9.9 / 11.2); the Library agent reports 17.5 / 20.5. Same cause: item candidates are collected before the walk.
- Text search at 500k for staff (no-match `library_page`) is slow: 1.5 / 1.9 s for `zzzqq` and 1.7 / 1.9 s for the 2-character `qz` in `library-bad-cases` (Library reports 2.6 s p50 and 7.2 s p95 for `qz`, and 1.9 / 2.1 s for `zzzqq`). The app never calls the staff path with a search, so no page does this today. Admin 1 to 2 character searches at 500k: 1 char 207 / 234 ms (`q`), 2 chars 82 to 463 ms (`ch`, `qz`); both under the 8 s limit.

### Slower but within target

Accepted: each is far under the 250 ms target, and none is a 7.9 protected fast path (`listOwnMedia`, the feed index filters, label summaries). All numbers are mine, high volume, p50 / p95 ms.

| Path | before | after | cause |
| --- | ---: | ---: | --- |
| `tikka` search, in the database, old function in the app's call shape against `library_page` (section 4) | 4.2 / 4.5 | 22.7 / 24.2 | candidate ids read first (up to 3,000) |
| `tikka` search, app function (`db-bench`) | 17.1 / 20.2 | 29.2 / 31.8 | same |
| `/admin?q=tikka` page (`next start`) | 24.6 / 30.2 | 34.5 / 44 (39.9 / 42.8 on a repeat) | same, plus load |
| `tikka` + largest venue, in the database | 13.3 / 13.8 | 42.1 / 43.2 | same |
| `tikka` + largest venue, app function | 43.7 / 45.3 | 45.8 / 46.9 | |
| `chicken`, in the database | 17.6 / 18.7 | 27.2 / 28.6 | same |
| `chicken`, app function | 53.7 / 65.8 | 25.2 / 28.2 | faster as an app function |
| popular-item filter, app function | 12.7 / 16.6 | 31 / 33.5 | item candidates collected before the walk |

At `expected` the same two app functions are 1.4x and 1.5x slower (`tikka` 15.3 to 21.6, popular item 9.2 to 13.7); at `current` nothing is slower.

### Fix 3: filter options (Library)

| Path | baseline | agent after | my after | verdict |
| --- | ---: | ---: | ---: | --- |
| filter options, largest venue, p95 at most 150 | 542 / 626 | 43.8 / 68.7 | 38.1 / 41.5 | met |
| filter options, smallest venue | 84.5 / 94.8 | 16.5 / 25.1 | 13.6 / 17.4 | met |
| `/admin?venue=` page within 2x of the feed itself | 551 ms page, 6 ms feed (92x) | 49.1 ms: 2.3x the unfiltered page, 6x the feed query | 54 / 63.9 ms (and 56.6 / 79.5 on a repeat): 3.3x the unfiltered page (16.2), 10x the feed query (5.2) | **not met** |

**3b is not met as written** (page 54 ms against a 5 ms feed query, 10x). Absolute change: 551 ms to 54 ms, 10 times faster. The page without a venue is already 2.5x its own feed call (16.2 against 6.4 ms; 1.4x in the baseline at lower load), so the 2x target was not attainable for any page. Alternative reading, for the record and not counted as met: against the unfiltered page my run is 3.3x (the unfiltered page rose with load, see section 2) and Library's is 2.3x. The page makes 7 requests: the feed, the filter options (38 ms by themselves) and the venue lists.

### Fix 4: cursor condition (Library)

| Path | baseline | agent after | my after | verdict |
| --- | ---: | ---: | ---: | --- |
| cursor at 10 / 50 / 90% depth, p95 at most 25 | 28.6 / 112 / 139 | 9.8 / 9.5 / 10.4 | 9.1 / 5.9 / 6.9 | met |
| venue (largest) cursor at 90% | 45.6 | 8.3 | 6.6 | met |
| refresh of 50 loaded pages, at most 150 (unfiltered feed) | 236 / 260 | 331 / 367 | 228 / 238 (500k: 241 / 258) | **not met** |
| refresh of 50 loaded pages (largest venue) | 264 / 297 | 270.7 / 319.6 | 220 / 251 | **not met** |
| refresh of 20 / 5 pages (unfiltered) | 90.6 / 26 | n/a | 91.5 / 29.3 | unchanged |

Each loaded page costs about 4.5 ms (4 requests, 1.1 ms each); the refresh pays for 50 of them sequentially. The cursor fix cannot make that fast; the refresh would need to run pages in parallel or to read fewer pages. Not met; follow-up.

### Fix 2: `getMenuVersion` label counts (Menus). Target p95 at most 500 ms, venue page at most 300 ms

| Path | baseline | agent after | my after | verdict |
| --- | ---: | ---: | ---: | --- |
| `getMenuVersion`, active, largest venue | 18,610 / 18,871 | 28.2 | 22.9 / 24.2 | met |
| `getMenuVersion`, retired, largest venue | 18,429 / 20,095 | 27.9 | 23.9 / 26.8 | met |
| `getMenuVersion`, smallest venue | 522 / 634 | 20.6 | 14.2 / 16.1 | met |
| archived-heavy venue (2,000 active, 3,000 archived items) | not measured | 535 to 638 first pass, 289 to 384 after paging | 215 / 235 (500k: 216 / 231) | met |
| `/admin/menus/<venue>` page | 15,917 / 16,881 | 60.3 / 70.2 | 44.1 / 47.9 | met |
| requests per `getMenuVersion` (largest, active / retired) | 60 / 63 | 6 | 6 / 9 at every volume | met (independent of label volume) |

The Menus agent's archived-heavy numbers are first pass; mine are warm repeats (n = 12), so they are not the same measurement. The page HTML of the venue page is 1,275 KiB before and 1,243 KiB after (7.8, deferred, target 150 KiB).

### Fix 6: import matching and the staff catalogue policy (Menus). Target preview at most 300 ms, catalogue at most 400 ms at 2,000 items

| Path (2,000 items, high) | baseline | agent after | my after | verdict |
| --- | ---: | ---: | ---: | --- |
| import preview, same file | 779 / 820 | 54 to 67 | 55.6 / 69.2 | met |
| preview, edited 10% | 790 / 879 | n/a | 59.9 / 62.5 | met |
| preview, all keys changed | 1,407 / 1,452 | 54 to 67 | 58.7 / 63.5 | met |
| matching alone, all keys changed (CPU) | 627 | n/a | 4.1 | met |
| `getLabellingCatalogue`, admin | 835 / 881 | 28 to 34 | 26.3 / 27.5 | met |
| `getLabellingCatalogue`, staff | 1,165 / 1,257 | 30 to 37 | 30.3 / 32.5 | met |
| archived-heavy venue, catalogue admin / staff (p50 / p95) | n/a | 83 to 107 / 199 to 242 | 76.4 / 80.9 and 194.9 / 234.3 | met |
| 150 items: no change | preview 36.7, catalogue 34.1 | n/a | preview 9.7, catalogue 5.7 | met (faster) |

### Fix 5: sharp decode concurrency (Media). Target peak RSS at most 1 GiB with 10 simultaneous 12 MP finalises

| Case (in-process, no stack) | baseline | agent after | my after (3 runs) | verdict |
| --- | ---: | ---: | ---: | --- |
| 10 x 12 MP JPEG at once, peak RSS MiB | 1,139 (three runs 1,102 to 1,161) | 497 | 440, 491, 424 | met |
| per item ms at 10 at once | 48.9 to 50.7 | 48.0 | 48.8, 48.1, 45.7 | met (not worse) |
| 16 at once, peak RSS MiB | 1,589 | 520 | 468, 455, 457 | met |
| 8 at once | 1,302 | n/a | 475, 449, 431 | met |
| 39 MP HEIC, 4 at once (serial, unchanged) | 603 | 595 | 599, 571, 566 | unchanged |
| single 12 MP JPEG decode wall p50 / CPU per op | 189 / 281 ms | n/a | 163 / 183 ms | faster |
| 39 MP HEIC single | 783 ms / 583 MiB | n/a | 729 ms / 560 MiB | unchanged |

The process now gates image decoding (`maxImageConcurrency: 6`); `decoder_busy` after 15 s is not exercised by these benches. Memory on a 2 vCPU Vercel function is for the deployment owner to measure.

### 7.9 Fast paths that must not regress

| Path | baseline | my after | verdict |
| --- | ---: | ---: | --- |
| staff portfolio first page, heaviest (p50 / p95) | 4.3 / 4.8 | 4 / 4.4 | held |
| staff portfolio cursor 90% heaviest | 14 / 21 | 10.7 / 13.1 | held (section 5) |
| admin feed first page | 7.4 / 10.7 | 6.4 / 9 | held |
| venue, staff, type and date filters (every row of the table) | 4.8 to 7.3 | 4 to 7.3 | held (ratios 0.77x to 1.1x) |
| label summaries (`getAssetLabelContext`, 10 assets) | 4.6 / 5.9 | 3.3 / 3.6 | held |
| `/api/library`, `/api/portfolio` JSON | 14.7 / 8.4 | 7.9 / 7.1 | held |
| unfiltered `/admin` page | 10.6 / 11.9 | 16.2 / 20.3 and 16.9 / 24.2 | slower at high only; see section 2 (load) |

## 5. Staff portfolio cursor at 90% depth

The Library agent saw 12.4 ms before and 16.7 / 24.3 after (46.5 / 58.1 at 500k). Nothing in the code of `listOwnMedia` or of the portfolio query changed. Repeats on `spare6`, the same data, p50 / p95:

| Run | p50 / p95 ms | load at start |
| --- | ---: | ---: |
| baseline (`raw/high`) | 14 / 21 | about 4 to 5 |
| after run | 10.7 / 13.1 | 7.5 |
| repeat 1 | 10.6 / 14.7 | 6.6 |
| repeat 2 | 13.6 / 15.5 | 6.6 |
| repeat 3 | 12.8 / 15.5 | 6.5 |
| `EXPLAIN` execution time | 16.8 before, 10.8 after | |

**Verdict: no regression.** The spread between runs is larger than any difference between before and after. At 500k the staff portfolio at 90% is 32.7 / 37 ms for me and 46.5 / 58.1 for Library; the heaviest uploader there has 35,972 assets and the plan walks the uploader's feed index, which is linear in depth. There is no 500k baseline.

## 6. `/admin?q=tikka`: which number was wrong

The page took 24.6 ms at high in my baseline, and the Library agent measured 117.8 ms after the fix and 105 / 107 ms for "the same app function before the fix, on spare7". Mine, on `spare6`:

| Measurement | before | after |
| --- | ---: | ---: |
| app function `search q=tikka` (`db-bench`), p50 / p95 | 17.1 / 20.2 | 29.2 / 31.8 |
| `EXPLAIN` of the old statement in the app's shape | 15.5 | 6.7 (`library_page`) |
| old function in the app's shape, in the database (search-reference) | 4.2 to 6.4 | |
| `library_page` in the database (search-reference) | | 22.7 to 22.8 |
| page from `next start` (`ttfb-bench`), p50 / p95 | 24.6 / 30.2 | 34.5 / 44, and 39.9 / 42.8 on a repeat |

**My baseline number was right.** On my stack the old function ran in 4 to 6 ms in the database and 17 ms as an app function, and it reproduces on a re-run, four ways, with the old function still installed. What I cannot reproduce is the Library agent's 105 ms "before"; I cannot say what made their run slow (their data has a different spread of `tikka` matches: they report about 760 probes per page and 57 ms in the database where I see 6.7 to 14 ms), so their "not a regression of the function" conclusion is not supported on my stack. On `spare6` the app function is 1.7x slower after the fix (17 to 29 ms) and the page 1.4x to 1.6x (24.6 to 34.5 to 39.9 ms), partly load (section 2). Both are far below 250 ms.

## 7. Index write cost

`index-cost.mjs` drops the 8 trigram / GIN indexes of the library migration at high, times writes, and recreates them from the migration text (verified: `indexDefinitionsRestored` is true, `pg_indexes` identical). Three phases (with, without, restored), p50 / p95 ms; load 5.3 to 6.2 throughout (`after-raw/high/index-cost.json`):

| Write | with indexes | without | restored |
| --- | ---: | ---: | ---: |
| label save (n = 40) | 6.8 / 11 | 5.5 / 7.8 | 5.6 / 6.8 |
| finalise, one 12 MP JPEG through `finaliseUpload` (n = 6) | 230.3 / 275.5 | 227.8 / 232.4 | 228 / 264.9 |
| create menu draft, 2,000 items (n = 4) | 341.7 / 476.5 | 308.9 / 359.8 | 324.4 / 342.9 |
| activate menu, 2,000 items (n = 4) | 3.5 / 4.1 | 2.9 / 3.5 | 3.2 / 3.2 |

Label saves and finalises differ by 1 to 2 ms, inside the spread between "without" and "restored", so the cost is not measurable here. A 2,000-item draft is about 10% slower with the indexes (342 against 309 ms; the restored phase, which has the indexes, took 324 ms), with n = 4. Rebuilding all 8 indexes took 29 to 281 ms each, 0.8 s in all, as plain `CREATE INDEX` (takes a write lock on the table while it runs; Library reports about 60 MB of index and the same). Index sizes at high: the 8 trigram / GIN indexes are 36.6 MiB (item name 10.3, section name 6.2, note 5.1, menu entry name 5.0, variant name 4.3, content types 3.2, aliases 2.3, suggestions 0.2); the other four new btree indexes are 21.0 MiB. The first run of this probe measured no finalise at all, because its staff actor had no venue ("uploads are paused"); that is fixed in `index-cost.mjs` and the table above is the rerun.

## 8. 500k side by side

Library reported 500k on `spare7`; I ran the same volume (`xl500k`) on `spare6`. The row counts are equal for `media_assets` (500,000), receipts (499,994) and the menu tables; the label tables differ by less than 0.1% (`media_labels` 282,015 against 282,242; `media_label_items` 398,519 against 398,431; `media_label_events` 273,253 against 273,246; `menu_item_suggestions` 2,696 against 2,694). Load average (1 minute) at the start of the db-paths run: mine 7.2 at 500k, 8.1 at high; Library's 6.5 at 500k and 8.7 at high (recorded in the raw files). p50 / p95 ms:

| Path at 500k | mine (`spare6`) | Library (`spare7`) |
| --- | ---: | ---: |
| first page, no filter | 5.5 / 8.4 | 11.8 / 16.3 |
| cursor at 90% depth | 5.2 / 7.8 | 7.2 / 8.8 |
| category = curries | 10.5 / 16.6 | 17.1 / 20.5 |
| venue (largest) + category | 9.7 / 11 | 12.6 / 14.7 |
| labels = labelled | 4.9 / 5.9 | 13.4 / 15.7 |
| labels = unlabelled | 3.3 / 3.5 | 4.7 / 5.1 |
| search `tikka` | 18.1 / 29.4 | 97.2 / 117.4 |
| search `chicken` | 25.9 / 28.4 | 74.1 / 77.9 |
| search `sunday` | 47.8 / 53.3 | 89.5 / 92.6 |
| search no match | 1.9 / 2.7 | 2.6 / 3.7 |
| filter options, largest venue | 36.7 / 43 | 41.6 / 43.2 |
| staff portfolio cursor 90% (heaviest) | 32.7 / 37 | 46.5 / 58.1 |
| refresh of 50 loaded pages, unfiltered | 241 / 258 | n/a in their table |
| admin `qz` (2 chars, no match) | 463 / 469 | 419 / 465 (573 p95 in the largest venue) |
| staff `qz` (`library_page`) | 1,707 / 1,929 | 2,641 / 7,193 |
| `getMenuVersion` archived-heavy | 216 / 231 | n/a |
| pages from `next start`: `/admin`, largest venue, `?q=tikka` | 11.9, 44.3, 27.8 (complete p50) | n/a |

My numbers are lower than Library's on the search and label-state rows by 2 to 5x; both are within target. I cannot attribute the difference (different stack, load, and the label tables differ by a few rows); the pass / fail verdicts are the same on both stacks.

## 9. Limits stated by the agents, checked

| Stated limit | Result |
| --- | --- |
| Library: refresh of 50 pages not met | confirmed (section 4) |
| Library: staff portfolio cursor 90% 16.7 / 24.3 | not reproduced; no regression (section 5) |
| Library: `/admin?q=tikka` 117.8 vs 24.6 | baseline correct; function is 1.7x slower, not a 5x regression (section 6) |
| Library: admin 1 to 2 character search 47 to 573 ms at 500k | 23 to 463 ms here (p50 / p95 of 1 to 2 char searches, `a` 23 / 28 ms to `qz` 463 / 469 ms) |
| Library: plain `CREATE INDEX` write lock | confirmed, 29 to 281 ms each at high (section 7) |
| Library: label-state helper reads `media_labels` (about linear) | seq scan of `media_labels` in the "nothing unlabelled" shape: 34 ms high, 104 ms at 500k |
| Library: `tests/integration/library.test.ts` "combines every venue" fails at high (200-page cap) | not run by me (Harness gate) |
| Menus: `/admin/menus` list page not comparable (61 TEST venues) | the list page is 10.8 / 16 ms against 116 / 123 at high; a listMenuVenues call of 3.8 ms against 129 ms |
| Menus: harness picks the archived venue as "smallest" on reruns | not seen in my runs (same venue at every volume) |
| Media: HEIC 39 MP unchanged at 595 MiB | confirmed (566 to 599) |

## 10. Not measured, deferred

- **Deferred items (not in phase 2), unchanged:** 7.7 thumbnails still answer `302` with `Cache-Control: private, no-store` in 8.5 ms p50; 7.8 page weight (first-load JS 1,024 to 1,047 KiB raw, `/staff` 1,366 KiB, venue page HTML 1,243 KiB at high); 7.9 video posters (not re-checked).
- Finalise memory on a 2 vCPU function; hosted Supabase and real network latency; browser rendering; real photographs and video; production data shapes (text search used generated, repetitive names); long-lived bloat at 500k; the integration, security, lifecycle and journey suites (Harness's gate).
- `tests/integration/library.test.ts` at high volume (Library's finding, not run here).
- Everything runs at one host load that varied from 4 to 8; results within about 30% of each other should not be ranked.

## 11. Full tables

The tables below are generated by `tests/perf/compare.mjs` (`before` is `docs/perf/raw`, `after` is `docs/perf/after-raw`).

### App functions at current: p50 / p95 ms (before = baseline)

Load average at start: before 7.9 8.6 7, after 7.1 8.9 8.5. Revisions: before 40c4005, after fb110c9.

#### Admin library feed and filters

| Path | before | after | p50 ratio | requests before / after |
| --- | ---: | ---: | ---: | ---: |
| first page, no filter | 7.1 / 9.3 | 4.8 / 7.5 | 0.68x | 4 / 4 |
| cursor page at 10% depth | 5.8 / 6.6 | 4.5 / 5 | 0.78x | 4 / 4 |
| cursor page at 50% depth | 5 / 5.9 | 3.9 / 6.5 | 0.78x | 4 / 4 |
| cursor page at 90% depth | 3.8 / 4.7 | 3.8 / 6.6 | 1x | 4 / 4 |
| venue filter (largest) | 4 / 5.7 | 3.7 / 4 | 0.93x | 4 / 4 |
| venue (largest), cursor at 50% | 4.7 / 6.3 | 3.5 / 3.8 | 0.74x | 4 / 4 |
| venue (largest), cursor at 90% | 3.9 / 6.9 | 3 / 3.6 | 0.77x | 4 / 4 |
| venue filter (smallest) | 3.9 / 4.9 | 3 / 3.8 | 0.77x | 4 / 4 |
| staff filter (heaviest uploader) | 5.5 / 6.6 | 3.9 / 4.1 | 0.71x | 4 / 4 |
| staff (heaviest), cursor at 50% | 6.2 / 7.6 | 3.7 / 4.1 | 0.6x | 4 / 4 |
| staff (heaviest), cursor at 90% | 3.8 / 4.6 | 3.4 / 4.4 | 0.89x | 4 / 4 |
| staff filter (lightest) | 3.6 / 4.3 | 3.1 / 3.5 | 0.86x | 4 / 4 |
| type = video | 4.7 / 6.2 | 5.3 / 6.4 | 1.1x | 4 / 4 |
| type = image | 4 / 4.9 | 3.5 / 4 | 0.88x | 4 / 4 |
| venue + staff + type | 3.9 / 4.8 | 3.3 / 3.8 | 0.85x | 4 / 4 |
| date range, last 7 days | 4.7 / 5.2 | 3.6 / 4.6 | 0.77x | 4 / 4 |
| date range, last 90 days | 4.3 / 5.7 | 3.6 / 4.5 | 0.84x | 4 / 4 |
| category = curries (library_assets) | 9.5 / 10.9 | 3.9 / 5.3 | 0.41x | 4 / 4 |
| category = curries, cursor at 50% | 8.7 / 9.7 | 4.2 / 11 | 0.48x | 4 / 4 |
| venue (largest) + category | 21.6 / 29 | 3.9 / 4.5 | 0.18x | 4 / 4 |
| item filter, popular item | 11.8 / 18.1 | 3.3 / 4.4 | 0.28x | 4 / 4 |
| item filter, rare item | 12.6 / 14.8 | 3.3 / 4 | 0.26x | 4 / 4 |
| item + variant filter | 5.6 / 8.9 | 3.2 / 3.7 | 0.57x | 4 / 4 |
| content type = dish | 5.7 / 7.1 | 3.7 / 4.3 | 0.65x | 4 / 4 |
| labels = labelled | 6.5 / 7.2 | 4.2 / 4.7 | 0.65x | 4 / 4 |
| labels = unlabelled | 7.1 / 11.5 | 3.6 / 4 | 0.51x | 4 / 4 |
| search q=tikka | 13.6 / 20.1 | 3.6 / 4 | 0.26x | 4 / 4 |
| search q=chicken (very common) | 6.2 / 7.8 | 3.6 / 5.5 | 0.58x | 1 / 4 |
| search q=sunday (notes) | 6.2 / 7 | 1.7 / 1.8 | 0.27x | 1 / 1 |
| search q=zzzqq (no match) | 5.3 / 6.1 | 1.5 / 1.7 | 0.28x | 1 / 1 |
| search q=tikka + venue (largest) | 8.9 / 10.8 | 3.7 / 4.4 | 0.42x | 4 / 4 |
| filter options, venue (largest) | 80.3 / 142 | 20.8 / 28.7 | 0.26x | 6 / 6 |
| filter options, venue (smallest) | 46.3 / 56.4 | 11.7 / 13.1 | 0.25x | 5 / 6 |
| filter options (venues + staff) | 1.8 / 3 | 1 / 1 | 0.56x | 2 / 2 |

#### Staff portfolio and labelling

| Path | before | after | p50 ratio | requests before / after |
| --- | ---: | ---: | ---: | ---: |
| portfolio first page (heaviest) | 5.6 / 7.6 | 3.3 / 4.2 | 0.59x | 4 / 4 |
| portfolio cursor 50% (heaviest) | 4.8 / 6.2 | 3.2 / 3.7 | 0.67x | 4 / 4 |
| portfolio cursor 90% (heaviest) | 5.6 / 8.8 | 2.7 / 3.5 | 0.48x | 4 / 4 |
| portfolio first page (median) | 9.9 / 15.2 | 2.9 / 3.4 | 0.29x | 4 / 4 |
| portfolio cursor 50% (median) | 17.3 / 26.2 | 2.9 / 3.3 | 0.17x | 4 / 4 |
| portfolio first page (lightest) | 9.6 / 17 | 2.8 / 3 | 0.29x | 4 / 4 |
| getLabellingCatalogue (staff, own venue) | 173 / 244 | 6.7 / 7.3 | 0.039x | 4 / 5 |
| getAssetLabelContext (10 assets, staff) | 6.6 / 9.1 | 2.7 / 2.9 | 0.41x | 4 / 4 |
| library_assets as staff, category (RLS plan) | 8.3 / 11.7 | 3.2 / 3.6 | 0.39x | 1 / 1 |
| library_assets as staff, venue + category | 7.5 / 9.9 | 3.3 / 3.7 | 0.44x | 1 / 1 |

#### Menu admin reads

| Path | before | after | p50 ratio | requests before / after |
| --- | ---: | ---: | ---: | ---: |
| getLabellingCatalogue (admin, largest menu) | 126 / 172 | 6.1 / 7.6 | 0.048x | 4 / 5 |
| getLabellingCatalogue (admin, smallest venue) | 54.5 / 69.4 | 4.7 / 6.3 | 0.086x | 4 / 5 |
| listMenuVenues | 68 / 83.1 | 2.4 / 2.7 | 0.035x | 3 / 3 |
| getVenueMenuOverview (largest venue) | 41.7 / 48.7 | 2.3 / 2.9 | 0.055x | 4 / 4 |
| getMenuVersion, active (largest venue) | 125 / 151 | 7.3 / 8.2 | 0.058x | 6 / 6 |
| getMenuVersion, retired (largest venue) | 103 / 199 | 8.8 / 10.9 | 0.086x | 9 / 9 |
| getMenuVersion, active (smallest venue) | 69.3 / 91.6 | 5 / 5.4 | 0.072x | 6 / 6 |

### App functions at expected: p50 / p95 ms (before = baseline)

Load average at start: before 7.1 8.2 7, after 5.6 8 8.2. Revisions: before 40c4005, after fb110c9.

#### Admin library feed and filters

| Path | before | after | p50 ratio | requests before / after |
| --- | ---: | ---: | ---: | ---: |
| first page, no filter | 6.3 / 9.6 | 7.1 / 9.3 | 1.1x | 4 / 4 |
| cursor page at 10% depth | 10.8 / 12.2 | 5.7 / 6.3 | 0.53x | 4 / 4 |
| cursor page at 50% depth | 24.2 / 29.5 | 5.4 / 5.8 | 0.22x | 4 / 4 |
| cursor page at 90% depth | 35.7 / 47.6 | 4.9 / 5.4 | 0.14x | 4 / 4 |
| venue filter (largest) | 6.2 / 7.2 | 5 / 5.5 | 0.81x | 4 / 4 |
| venue (largest), cursor at 50% | 12.8 / 18.2 | 5.1 / 5.9 | 0.4x | 4 / 4 |
| venue (largest), cursor at 90% | 19.8 / 25.3 | 4.7 / 5 | 0.24x | 4 / 4 |
| venue filter (smallest) | 5.1 / 6.6 | 4.2 / 4.5 | 0.82x | 4 / 4 |
| staff filter (heaviest uploader) | 5.6 / 7.3 | 4.9 / 5.7 | 0.88x | 4 / 4 |
| staff (heaviest), cursor at 50% | 7.2 / 9.1 | 4.5 / 5.7 | 0.63x | 4 / 4 |
| staff (heaviest), cursor at 90% | 7.8 / 8.3 | 4.4 / 4.8 | 0.56x | 4 / 4 |
| staff filter (lightest) | 4.4 / 4.6 | 4.2 / 4.5 | 0.95x | 4 / 4 |
| type = video | 4.8 / 7.3 | 4.5 / 4.9 | 0.94x | 4 / 4 |
| type = image | 5.8 / 7.6 | 4.1 / 4.7 | 0.71x | 4 / 4 |
| venue + staff + type | 5.7 / 7.8 | 4.8 / 5.2 | 0.84x | 4 / 4 |
| date range, last 7 days | 5.6 / 7.7 | 4.5 / 5.1 | 0.8x | 4 / 4 |
| date range, last 90 days | 6.3 / 9 | 4.5 / 6.1 | 0.71x | 4 / 4 |
| category = curries (library_assets) | 1,188 / 1,251 | 9 / 10.1 | 0.0076x | 4 / 4 |
| category = curries, cursor at 50% | 1,220 / 1,389 | 9.6 / 10.8 | 0.0079x | 4 / 4 |
| venue (largest) + category | 1,199 / 1,260 | 9.4 / 12.1 | 0.0078x | 4 / 4 |
| item filter, popular item | 9.2 / 10.9 | 13.7 / 13.9 | 1.5x | 4 / 4 |
| item filter, rare item | 84.6 / 123 | 4 / 4.4 | 0.047x | 4 / 4 |
| item + variant filter | 29.3 / 32.5 | 7.2 / 7.5 | 0.25x | 4 / 4 |
| content type = dish | 5.8 / 7.2 | 6.3 / 6.7 | 1.1x | 4 / 4 |
| labels = labelled | 327 / 374 | 6.1 / 7.9 | 0.019x | 4 / 4 |
| labels = unlabelled | 349 / 389 | 4.1 / 4.6 | 0.012x | 4 / 4 |
| search q=tikka | 15.3 / 17.1 | 21.6 / 23.1 | 1.4x | 4 / 4 |
| search q=chicken (very common) | 72.7 / 88.2 | 21 / 22.9 | 0.29x | 4 / 4 |
| search q=sunday (notes) | 274 / 333 | 14.7 / 15.1 | 0.054x | 4 / 4 |
| search q=zzzqq (no match) | **7,954 / 8,022, 4/8 failed** | 2.3 / 2.5 | 0.00029x | 1 / 1 |
| search q=tikka + venue (largest) | 53.4 / 60 | 37.7 / 39.7 | 0.71x | 4 / 4 |
| filter options, venue (largest) | 274 / 293 | 37.2 / 39.8 | 0.14x | 7 / 7 |
| filter options, venue (smallest) | 63.1 / 68.9 | 17.6 / 21.8 | 0.28x | 6 / 6 |
| filter options (venues + staff) | 1.1 / 1.3 | 1.1 / 1.2 | 1x | 2 / 2 |

#### Staff portfolio and labelling

| Path | before | after | p50 ratio | requests before / after |
| --- | ---: | ---: | ---: | ---: |
| portfolio first page (heaviest) | 5 / 5.5 | 4.7 / 5.1 | 0.94x | 4 / 4 |
| portfolio cursor 50% (heaviest) | 6.7 / 8.4 | 6.3 / 7.6 | 0.94x | 4 / 4 |
| portfolio cursor 90% (heaviest) | 11.6 / 15.8 | 7.1 / 7.5 | 0.61x | 4 / 4 |
| portfolio first page (median) | 9.8 / 15.1 | 4.4 / 4.8 | 0.45x | 4 / 4 |
| portfolio cursor 50% (median) | 7 / 9 | 4.5 / 5.1 | 0.64x | 4 / 4 |
| portfolio first page (lightest) | 5.4 / 7.9 | 4.2 / 4.6 | 0.78x | 4 / 4 |
| getLabellingCatalogue (staff, own venue) | 87.6 / 106 | 8.5 / 10.7 | 0.097x | 4 / 5 |
| getAssetLabelContext (10 assets, staff) | 4.9 / 7.3 | 3.6 / 3.8 | 0.73x | 4 / 4 |
| library_assets as staff, category (RLS plan) | 852 / 927 | 765 / 872 | 0.9x | 1 / 1 |
| library_assets as staff, venue + category | 959 / 1,178 | 747 / 858 | 0.78x | 1 / 1 |

#### Menu admin reads

| Path | before | after | p50 ratio | requests before / after |
| --- | ---: | ---: | ---: | ---: |
| getLabellingCatalogue (admin, largest menu) | 86.9 / 97.8 | 7.1 / 9.8 | 0.082x | 4 / 5 |
| getLabellingCatalogue (admin, smallest venue) | 40.4 / 51.4 | 5.7 / 7.8 | 0.14x | 4 / 5 |
| listMenuVenues | 129 / 161 | 3.4 / 4.3 | 0.026x | 3 / 3 |
| getVenueMenuOverview (largest venue) | 36.2 / 40.3 | 5.2 / 5.9 | 0.14x | 5 / 5 |
| getMenuVersion, active (largest venue) | 2,640 / 2,877 | 13 / 15.2 | 0.0049x | 25 / 6 |
| getMenuVersion, retired (largest venue) | 2,671 / 3,073 | 14.2 / 18.1 | 0.0053x | 28 / 9 |
| getMenuVersion, active (smallest venue) | 142 / 185 | 11.5 / 12.7 | 0.081x | 8 / 6 |

### App functions at high: p50 / p95 ms (before = baseline)

Load average at start: before 7.6 7.2 6.9, after 8.1 7.5 7.9. Revisions: before 40c4005, after fb110c9.

#### Admin library feed and filters

| Path | before | after | p50 ratio | requests before / after |
| --- | ---: | ---: | ---: | ---: |
| first page, no filter | 7.4 / 10.7 | 6.4 / 9 | 0.86x | 4 / 4 |
| cursor page at 10% depth | 23 / 28.6 | 7.3 / 9.1 | 0.32x | 4 / 4 |
| cursor page at 50% depth | 83 / 112 | 5.3 / 5.9 | 0.064x | 4 / 4 |
| cursor page at 90% depth | 111 / 139 | 5.4 / 6.9 | 0.049x | 4 / 4 |
| venue filter (largest) | 6 / 7.5 | 5.2 / 6.2 | 0.87x | 4 / 4 |
| venue (largest), cursor at 50% | 22 / 26.7 | 6 / 6.9 | 0.27x | 4 / 4 |
| venue (largest), cursor at 90% | 37 / 45.6 | 5.5 / 6.6 | 0.15x | 4 / 4 |
| venue filter (smallest) | 6.3 / 7.2 | 5.4 / 5.8 | 0.86x | 4 / 4 |
| staff filter (heaviest uploader) | 5.1 / 6.6 | 4.6 / 5.4 | 0.9x | 4 / 4 |
| staff (heaviest), cursor at 50% | 10.9 / 15.1 | 4.3 / 5.4 | 0.39x | 4 / 4 |
| staff (heaviest), cursor at 90% | 14.4 / 17.5 | 4 / 4.6 | 0.28x | 4 / 4 |
| staff filter (lightest) | 5.6 / 9.3 | 4.8 / 5.5 | 0.86x | 4 / 4 |
| type = video | 5.2 / 7.7 | 5.3 / 6.8 | 1x | 4 / 4 |
| type = image | 5 / 6.3 | 5.3 / 6 | 1.1x | 4 / 4 |
| venue + staff + type | 4.8 / 7.9 | 5 / 7.3 | 1x | 4 / 4 |
| date range, last 7 days | 6.5 / 8.2 | 5 / 6.3 | 0.77x | 4 / 4 |
| date range, last 90 days | 5.9 / 7.5 | 4.8 / 5.6 | 0.81x | 4 / 4 |
| category = curries (library_assets) | 3,259 / 3,278 | 9.7 / 11.1 | 0.003x | 4 / 4 |
| category = curries, cursor at 50% | 3,692 / 4,164 | 10.1 / 12.4 | 0.0027x | 4 / 4 |
| venue (largest) + category | 3,550 / 4,426 | 9.1 / 9.5 | 0.0026x | 4 / 4 |
| item filter, popular item | 12.7 / 16.6 | 31 / 33.5 | 2.4x | 4 / 4 |
| item filter, rare item | 269 / 320 | 5.8 / 6.5 | 0.022x | 4 / 4 |
| item + variant filter | 43.8 / 54.2 | 7.9 / 10.1 | 0.18x | 4 / 4 |
| content type = dish | 7.3 / 8.7 | 6.6 / 9.9 | 0.9x | 4 / 4 |
| labels = labelled | 1,067 / 1,243 | 6 / 6.9 | 0.0056x | 4 / 4 |
| labels = unlabelled | 1,096 / 1,181 | 4.1 / 4.3 | 0.0037x | 4 / 4 |
| search q=tikka | 17.1 / 20.2 | 29.2 / 31.8 | 1.7x | 4 / 4 |
| search q=chicken (very common) | 53.7 / 65.8 | 25.2 / 28.2 | 0.47x | 4 / 4 |
| search q=sunday (notes) | 126 / 146 | 32.1 / 35.1 | 0.26x | 4 / 4 |
| search q=zzzqq (no match) | **8,015 / 8,022, 8/8 failed** | 2 / 2.5 | 0.00025x | 1 / 1 |
| search q=tikka + venue (largest) | 43.7 / 45.3 | 45.8 / 46.9 | 1x | 4 / 4 |
| filter options, venue (largest) | 542 / 626 | 38.1 / 41.5 | 0.07x | 7 / 7 |
| filter options, venue (smallest) | 84.5 / 94.8 | 13.6 / 17.4 | 0.16x | 6 / 6 |
| filter options (venues + staff) | 1.3 / 1.8 | 1.2 / 1.3 | 0.92x | 2 / 2 |

#### Staff portfolio and labelling

| Path | before | after | p50 ratio | requests before / after |
| --- | ---: | ---: | ---: | ---: |
| portfolio first page (heaviest) | 4.3 / 4.8 | 4 / 4.4 | 0.93x | 4 / 4 |
| portfolio cursor 50% (heaviest) | 9.1 / 10.7 | 8.5 / 13.2 | 0.93x | 4 / 4 |
| portfolio cursor 90% (heaviest) | 14 / 21 | 10.7 / 13.1 | 0.76x | 4 / 4 |
| portfolio first page (median) | 4.2 / 4.8 | 4.3 / 5.4 | 1x | 4 / 4 |
| portfolio cursor 50% (median) | 6.8 / 8 | 4.5 / 5 | 0.66x | 4 / 4 |
| portfolio first page (lightest) | 4.9 / 7.2 | 4.6 / 5 | 0.94x | 4 / 4 |
| getLabellingCatalogue (staff, own venue) | 85.6 / 104 | 7.2 / 8.6 | 0.084x | 4 / 5 |
| getAssetLabelContext (10 assets, staff) | 4.6 / 5.9 | 3.3 / 3.6 | 0.72x | 4 / 4 |
| library_assets as staff, category (RLS plan) | 2,720 / 2,818 | 2,552 / 2,638 | 0.94x | 1 / 1 |
| library_assets as staff, venue + category | 2,938 / 3,402 | 2,462 / 2,551 | 0.84x | 1 / 1 |

#### Menu admin reads

| Path | before | after | p50 ratio | requests before / after |
| --- | ---: | ---: | ---: | ---: |
| getLabellingCatalogue (admin, largest menu) | 84.9 / 96.2 | 7.3 / 7.7 | 0.086x | 4 / 5 |
| getLabellingCatalogue (admin, smallest venue) | 28.2 / 37.3 | 5 / 5.8 | 0.18x | 4 / 5 |
| listMenuVenues | 129 / 147 | 3.8 / 5 | 0.029x | 3 / 3 |
| getVenueMenuOverview (largest venue) | 36.8 / 42.2 | 5.4 / 6.3 | 0.15x | 5 / 5 |
| getMenuVersion, active (largest venue) | 18,610 / 18,871 | 22.9 / 24.2 | 0.0012x | 60 / 6 |
| getMenuVersion, retired (largest venue) | 18,429 / 20,095 | 23.9 / 26.8 | 0.0013x | 63 / 9 |
| getMenuVersion, active (smallest venue) | 522 / 634 | 14.2 / 16.1 | 0.027x | 11 / 6 |

### Admin gallery foreground refresh: k pages one after another, p50 / p95 ms

| Volume | Feed | Pages | before | after | requests |
| --- | ---: | ---: | ---: | ---: | ---: |
| current | unfiltered feed | 1 | 6.5 / 9.4 | 6.1 / 7.1 | 4 / 4 |
| current | unfiltered feed | 5 | 18.6 / 21.9 | 11.3 / 13.3 | 12 / 12 |
| current | unfiltered feed | 20 | 12.9 / 13.5 | 11 / 11.7 | 12 / 12 |
| current | unfiltered feed | 50 | 15.8 / 18 | 10.8 / 12 | 12 / 12 |
| current | largest venue | 1 | 6.1 / 8.4 | 3.8 / 4.1 | 4 / 4 |
| current | largest venue | 5 | 10.2 / 11.1 | 7.4 / 8 | 8 / 8 |
| current | largest venue | 20 | 8.4 / 11.6 | 7.3 / 7.4 | 8 / 8 |
| current | largest venue | 50 | 11 / 15.7 | 7.6 / 9.5 | 8 / 8 |
| expected | unfiltered feed | 1 | 7.8 / 8.4 | 7.4 / 8.6 | 4 / 4 |
| expected | unfiltered feed | 5 | 24.4 / 27.8 | 26.9 / 27.4 | 20 / 20 |
| expected | unfiltered feed | 20 | 88.5 / 90.3 | 96.5 / 100 | 80 / 80 |
| expected | unfiltered feed | 50 | 284 / 314 | 232 / 328 | 200 / 200 |
| expected | largest venue | 1 | 4.2 / 4.2 | 4.4 / 5.3 | 4 / 4 |
| expected | largest venue | 5 | 23.9 / 36.7 | 24.7 / 26.2 | 20 / 20 |
| expected | largest venue | 20 | 137 / 161 | 102 / 115 | 80 / 80 |
| expected | largest venue | 50 | 274 / 306 | 225 / 251 | 200 / 200 |
| high | unfiltered feed | 1 | 9.2 / 25.4 | 9.4 / 26.8 | 4 / 4 |
| high | unfiltered feed | 5 | 26 / 28.6 | 29.3 / 30.4 | 20 / 20 |
| high | unfiltered feed | 20 | 90.6 / 101 | 91.5 / 112 | 80 / 80 |
| high | unfiltered feed | 50 | 236 / 260 | 228 / 238 | 200 / 200 |
| high | largest venue | 1 | 4.5 / 5.5 | 5.5 / 5.5 | 4 / 4 |
| high | largest venue | 5 | 21.8 / 28.7 | 24.4 / 30.2 | 20 / 20 |
| high | largest venue | 20 | 158 / 183 | 95.3 / 104 | 80 / 80 |
| high | largest venue | 50 | 264 / 297 | 220 / 251 | 200 / 200 |

### Several admins at once, per-request p50 / p95 ms

| Volume | Path | before | after |
| --- | ---: | ---: | ---: |
| current | first page x1 | 4.1 / 5.6 | 4 / 4.3 |
| current | first page x4 | 8.2 / 10.5 | 6.1 / 15.2 |
| current | first page x8 | 10.3 / 13.2 | 8 / 11.4 |
| current | category = curries x1 | 12.1 / 12.8 | 4.6 / 4.6 |
| current | category = curries x4 | 10.8 / 12.5 | 5.5 / 6.7 |
| current | category = curries x8 | 12.6 / 15 | 8.1 / 11.4 |
| current | labels = labelled x1 | 7.6 / 9 | 4.4 / 4.7 |
| current | labels = labelled x4 | 6.7 / 7.7 | 5.7 / 6.9 |
| current | labels = labelled x8 | 10 / 12.7 | 8.1 / 9.5 |
| expected | first page x1 | 4.4 / 5.2 | 4.4 / 4.9 |
| expected | first page x4 | 6.1 / 7.5 | 6.1 / 7.2 |
| expected | first page x8 | 14 / 17.5 | 10.4 / 13.7 |
| expected | category = curries x1 | 1,164 / 1,193 | 9.3 / 9.5 |
| expected | category = curries x4 | 1,303 / 1,324 | 10.4 / 11.8 |
| expected | category = curries x8 | 1,692 / 1,743 | 14.1 / 16.4 |
| expected | labels = labelled x1 | 363 / 368 | 5.2 / 5.2 |
| expected | labels = labelled x4 | 387 / 389 | 7.3 / 7.8 |
| expected | labels = labelled x8 | 449 / 460 | 11.3 / 14.5 |
| high | first page x1 | 5.1 / 5.7 | 4.2 / 5.6 |
| high | first page x4 | 6.7 / 9.7 | 5.9 / 7.1 |
| high | first page x8 | 10 / 12.4 | 10.5 / 14.3 |
| high | category = curries x1 | 3,519 / 4,010 | 13.6 / 14.9 |
| high | category = curries x4 | 3,734 / 3,894 | 12.3 / 12.9 |
| high | category = curries x8 | 3,996 / 4,080 | 16.3 / 18.7 |
| high | labels = labelled x1 | 991 / 991 | 5.8 / 5.8 |
| high | labels = labelled x4 | 1,099 / 1,104 | 6.8 / 7.6 |
| high | labels = labelled x8 | 1,235 / 1,346 | 10.4 / 13.8 |

### Pages and API from `next start`: complete time p50 / p95 ms

| Volume | Route | before | after | HTML KiB before / after |
| --- | ---: | ---: | ---: | ---: |
| current | admin library /admin | 10.8 / 13.4 | 11.4 / 13.5 | 110 / 110 |
| current | admin library, largest venue | 76.1 / 80.5 | 29 / 31.1 | 175 / 175 |
| current | admin library, category filter | 14 / 16 | 11.1 / 11.9 | 62.2 / 67.8 |
| current | admin library, venue + category filter | 77.2 / 86 | 31.4 / 34.6 | 124 / 127 |
| current | admin library, search q=tikka | 15.7 / 20.7 | 11.7 / 14.5 | 62.6 / 70.4 |
| current | admin menus list | 57.5 / 66.9 | 8.3 / 9.4 | 43 / 43 |
| current | admin menus, largest venue | 34 / 43.3 | 9.9 / 10.8 | 50 / 50 |
| current | admin menu version (largest venue, active) | 88.6 / 112 | 15.3 / 16.2 | 173 / 173 |
| current | admin menu version (smallest venue, active) | 45.5 / 52.7 | 12.5 / 14.3 | 105 / 105 |
| current | admin staff list | 20.6 / 40.2 | 19.6 / 21.6 | 118 / 118 |
| current | admin staff member (heaviest) | 32.1 / 51.9 | 24 / 26.1 | 87.2 / 86.6 |
| current | staff portfolio (heaviest) | 13.2 / 18.6 | 10.4 / 12.1 | 80 / 79.4 |
| current | staff portfolio (median) | 12.7 / 16.3 | 9.6 / 10.9 | 40.8 / 41.9 |
| current | JSON /api/library | 8.1 / 12.1 | 8 / 14 | 16.5 / 17.1 |
| current | JSON /api/library?category=curries | 11 / 12.3 | 8 / 8.8 | 2.1 / 4 |
| current | JSON /api/portfolio (heaviest) | 7.2 / 9.5 | 7.4 / 8.3 | 17.5 / 16.9 |
| expected | admin library /admin | 10.8 / 11.9 | 11.2 / 13 | 105 / 105 |
| expected | admin library, largest venue | 266 / 307 | 48.1 / 52.5 | 191 / 191 |
| expected | admin library, category filter | 1,096 / 1,166 | 17.4 / 18.5 | 112 / 111 |
| expected | admin library, venue + category filter | 1,110 / 1,162 | 50.1 / 68.1 | 195 / 195 |
| expected | admin library, search q=tikka | 20.6 / 22 | 29 / 30.9 | 112 / 113 |
| expected | admin menus list | 103 / 112 | 8.9 / 11.7 | 62.3 / 62.3 |
| expected | admin menus, largest venue | 2,148 / 2,300 | 35.1 / 40.2 | 541 / 588 |
| expected | admin menu version (largest venue, active) | 2,051 / 2,112 | 33.7 / 42.5 | 192 / 192 |
| expected | admin menu version (smallest venue, active) | 109 / 120 | 26.6 / 34.9 | 107 / 107 |
| expected | admin staff list | 29.4 / 33.6 | 31.6 / 48.3 | 477 / 477 |
| expected | admin staff member (heaviest) | 29.7 / 31.4 | 27.5 / 32.5 | 82.2 / 83.3 |
| expected | staff portfolio (heaviest) | 10 / 12.1 | 11.6 / 13.5 | 70.4 / 71.4 |
| expected | staff portfolio (median) | 10.2 / 11.6 | 11.7 / 17.3 | 69.5 / 69.4 |
| expected | JSON /api/library | 7.9 / 9.6 | 8 / 8.9 | 18.1 / 18.4 |
| expected | JSON /api/library?category=curries | 1,112 / 1,289 | 14.6 / 17.7 | 23.7 / 23.3 |
| expected | JSON /api/portfolio (heaviest) | 8.3 / 11.5 | 12.4 / 18.1 | 19.8 / 20.7 |
| high | admin library /admin | 10.6 / 11.9 | 16.2 / 20.3 | 112 / 111 |
| high | admin library, largest venue | 551 / 583 | 54 / 63.9 | 194 / 193 |
| high | admin library, category filter | 3,125 / 3,491 | 20.1 / 23.3 | 120 / 118 |
| high | admin library, venue + category filter | 3,494 / 3,713 | 52.6 / 59.3 | 201 / 200 |
| high | admin library, search q=tikka | 24.6 / 30.2 | 34.5 / 44 | 119 / 118 |
| high | admin menus list | 116 / 123 | 10.8 / 16 | 68.6 / 68.6 |
| high | admin menus, largest venue | 15,917 / 16,881 | 44.1 / 47.9 | 1,275 / 1,243 |
| high | admin menu version (largest venue, active) | 15,409 / 16,757 | 31.1 / 34.7 | 193 / 192 |
| high | admin menu version (smallest venue, active) | 491 / 631 | 20.8 / 23.6 | 85.9 / 85.9 |
| high | admin staff list | 43.1 / 52.9 | 33.5 / 36.5 | 743 / 743 |
| high | admin staff member (heaviest) | 34.1 / 38.9 | 25.7 / 27.2 | 82.3 / 82.1 |
| high | staff portfolio (heaviest) | 17.2 / 22 | 10 / 11.4 | 70.8 / 69.7 |
| high | staff portfolio (median) | 12.6 / 16.7 | 10.1 / 11.4 | 71.2 / 71.1 |
| high | JSON /api/library | 14.7 / 17.8 | 7.9 / 9.9 | 19.1 / 18.4 |
| high | JSON /api/library?category=curries | 3,331 / 3,585 | 13.2 / 15.1 | 23.7 / 23.1 |
| high | JSON /api/portfolio (heaviest) | 8.4 / 13.9 | 7.1 / 7.6 | 17.4 / 17.6 |

### Menu import and catalogue by menu size, p50 / p95 ms

| Volume | Items | Step | before | after |
| --- | ---: | ---: | ---: | ---: |
| current | 150 | preview, same file | 28.3 / 29.4 | 6 / 9.8 |
| current | 150 | preview, edited 10% | 27.8 / 28.7 | 5.8 / 6.6 |
| current | 150 | preview, all keys changed | 32.9 / 37.7 | 6.5 / 7.5 |
| current | 150 | getLabellingCatalogue (admin) | 31.9 / 32.7 | 5.3 / 6.6 |
| current | 150 | getLabellingCatalogue (staff) | 39.2 / 41.7 | 5.8 / 7.2 |
| current | 150 | getMenuVersion | 33.2 / 36 | 5.5 / 6.6 |
| current | 150 | activate first (1 run) | 2.2 | 2 |
| current | 150 | create draft (1 run) | 29 | 28.5 |
| current | 2000 | preview, same file | 862 / 881 | 42.8 / 62.2 |
| current | 2000 | preview, edited 10% | 874 / 913 | 40.9 / 45.1 |
| current | 2000 | preview, all keys changed | 1,524 / 1,548 | 41.7 / 53.3 |
| current | 2000 | getLabellingCatalogue (admin) | 810 / 827 | 23.2 / 26.7 |
| current | 2000 | getLabellingCatalogue (staff) | 1,134 / 1,395 | 29.6 / 34.7 |
| current | 2000 | getMenuVersion | 903 / 922 | 35.7 / 37.1 |
| current | 2000 | activate first (1 run) | 3.8 | 2.8 |
| current | 2000 | create draft (1 run) | 365 | 381 |
| expected | 150 | preview, same file | 31.3 / 33 | 12.3 / 12.9 |
| expected | 150 | preview, edited 10% | 30.9 / 33.1 | 9.9 / 10.6 |
| expected | 150 | preview, all keys changed | 37.6 / 44 | 9.2 / 10.6 |
| expected | 150 | getLabellingCatalogue (admin) | 30.9 / 31.4 | 5.4 / 6.8 |
| expected | 150 | getLabellingCatalogue (staff) | 40.1 / 43.1 | 5.6 / 7.4 |
| expected | 150 | getMenuVersion | 40.7 / 45.6 | 9.3 / 10.4 |
| expected | 150 | activate first (1 run) | 3.1 | 3.2 |
| expected | 150 | create draft (1 run) | 29.6 | 38.5 |
| expected | 2000 | preview, same file | 734 / 794 | 52.6 / 55.4 |
| expected | 2000 | preview, edited 10% | 728 / 802 | 54.6 / 58.9 |
| expected | 2000 | preview, all keys changed | 1,360 / 1,412 | 54.3 / 64.9 |
| expected | 2000 | getLabellingCatalogue (admin) | 987 / 1,043 | 23.9 / 26.7 |
| expected | 2000 | getLabellingCatalogue (staff) | 1,155 / 1,332 | 32.2 / 34.2 |
| expected | 2000 | getMenuVersion | 789 / 854 | 59 / 71.8 |
| expected | 2000 | activate first (1 run) | 3.3 | 3.2 |
| expected | 2000 | create draft (1 run) | 357 | 382 |
| high | 150 | preview, same file | 36.7 / 40.5 | 9.7 / 11.5 |
| high | 150 | preview, edited 10% | 34.8 / 39.5 | 10.7 / 11.2 |
| high | 150 | preview, all keys changed | 43.6 / 46.4 | 12 / 14 |
| high | 150 | getLabellingCatalogue (admin) | 34.1 / 43.2 | 5.7 / 6.1 |
| high | 150 | getLabellingCatalogue (staff) | 40.4 / 44.4 | 6.1 / 7.3 |
| high | 150 | getMenuVersion | 75.2 / 86.3 | 11.1 / 11.9 |
| high | 150 | activate first (1 run) | 2.5 | 1.9 |
| high | 150 | create draft (1 run) | 37.1 | 33.8 |
| high | 2000 | preview, same file | 779 / 820 | 55.6 / 69.2 |
| high | 2000 | preview, edited 10% | 790 / 879 | 59.9 / 62.5 |
| high | 2000 | preview, all keys changed | 1,407 / 1,452 | 58.7 / 63.5 |
| high | 2000 | getLabellingCatalogue (admin) | 835 / 881 | 26.3 / 27.5 |
| high | 2000 | getLabellingCatalogue (staff) | 1,165 / 1,257 | 30.3 / 32.5 |
| high | 2000 | getMenuVersion | 832 / 841 | 56.3 / 62.1 |
| high | 2000 | activate first (1 run) | 3.8 | 3.7 |
| high | 2000 | create draft (1 run) | 475 | 416 |

#### Matching alone (pure CPU), p50 ms match / diff

| Volume | Items | Case | before | after |
| --- | ---: | ---: | ---: | ---: |
| current | 50 | same keys, edited 10% | 0.1 / 0 | 0.1 / 0 |
| current | 50 | all keys changed (worst case) | 0.5 / 0 | 0.1 / 0 |
| current | 150 | same keys, edited 10% | 0.3 / 0.1 | 0.2 / 0.1 |
| current | 150 | all keys changed (worst case) | 4.1 / 0.4 | 0.3 / 0 |
| current | 600 | same keys, edited 10% | 2.6 / 1.8 | 0.8 / 0.2 |
| current | 600 | all keys changed (worst case) | 61.3 / 4 | 1.3 / 0.2 |
| current | 2000 | same keys, edited 10% | 14.9 / 12.3 | 2.5 / 0.7 |
| current | 2000 | all keys changed (worst case) | 634 / 56.9 | 4 / 0.6 |
| expected | 50 | same keys, edited 10% | 0.1 / 0 | 0.1 / 0.1 |
| expected | 50 | all keys changed (worst case) | 0.5 / 0 | 0.1 / 0 |
| expected | 150 | same keys, edited 10% | 0.3 / 0.1 | 0.3 / 0.1 |
| expected | 150 | all keys changed (worst case) | 3.6 / 0.2 | 0.4 / 0 |
| expected | 600 | same keys, edited 10% | 2.5 / 1.5 | 0.8 / 0.2 |
| expected | 600 | all keys changed (worst case) | 56 / 3.8 | 1.3 / 0.2 |
| expected | 2000 | same keys, edited 10% | 13.6 / 10.9 | 2.6 / 0.8 |
| expected | 2000 | all keys changed (worst case) | 589 / 52.3 | 4.1 / 0.6 |
| high | 50 | same keys, edited 10% | 0.1 / 0 | 0.1 / 0 |
| high | 50 | all keys changed (worst case) | 0.5 / 0 | 0.1 / 0 |
| high | 150 | same keys, edited 10% | 0.3 / 0.1 | 0.2 / 0.1 |
| high | 150 | all keys changed (worst case) | 4.1 / 0.3 | 0.4 / 0 |
| high | 600 | same keys, edited 10% | 2.6 / 1.4 | 0.8 / 0.2 |
| high | 600 | all keys changed (worst case) | 56.6 / 4 | 1.2 / 0.2 |
| high | 2000 | same keys, edited 10% | 14.3 / 12.1 | 2.5 / 0.8 |
| high | 2000 | all keys changed (worst case) | 627 / 60.4 | 4.1 / 0.6 |

### EXPLAIN (ANALYZE, BUFFERS) execution time, ms

| Volume | Statement | before ms | after ms | seq scans before | seq scans after |
| --- | ---: | ---: | ---: | ---: | ---: |
| current | admin-feed-first | 0.5 | 0.5 | media_assets | media_assets |
| current | admin-feed-cursor-10pct | 0.4 | 0.4 | media_assets | media_assets |
| current | admin-feed-cursor-50pct | 0.3 | 0.4 | media_assets | media_assets |
| current | admin-feed-cursor-90pct | 0.3 | 0.4 | media_assets | media_assets |
| current | admin-venue-first | 0.4 | 0.3 | media_assets | media_assets |
| current | admin-venue-cursor-90pct | 0.3 | 0.3 | media_assets | media_assets |
| current | admin-staff-first | 0.4 | 0.3 | media_assets | media_assets |
| current | admin-staff-cursor-90pct | 0.4 | 0.3 | media_assets | media_assets |
| current | admin-type-video | 0.4 | 0.3 | media_assets | media_assets |
| current | admin-category-curries | 5.1 | 2.1 | media_assets, media_label_items, menu_versions | media_assets, media_label_items, menu_entries, menu_sections, menu_versions |
| current | admin-category-curries-cursor-50pct | 7.7 | 2 | media_assets, media_label_items, menu_versions | media_assets, media_label_items, menu_entries, menu_sections, menu_versions |
| current | admin-labelled | 1.2 | 0.7 | media_assets, media_labels | media_assets, media_labels |
| current | admin-unlabelled | 1.2 | 0.8 | media_assets, media_labels | media_assets, media_labels |
| current | admin-content-dish | 1.1 | 0.7 | media_assets, media_labels | media_assets, media_labels |
| current | admin-item-popular | 1 | 0.6 | media_assets | media_assets |
| current | admin-item-rare | 1.3 | 0.6 | media_assets | media_assets |
| current | admin-search-tikka | 4 | 2.1 | media_assets, media_labels, menu_item_suggestions | media_assets, media_labels, menu_item_suggestions |
| current | admin-search-nomatch | 3.7 | 2.1 | media_assets, media_labels, menu_item_suggestions | media_assets, media_labels, menu_item_suggestions |
| current | staff-heaviest-library-assets-category | 3.9 | 2.1 | media_assets, media_label_items, menu_versions | media_assets, media_label_items, menu_entries, menu_sections, menu_versions |
| current | staff-heaviest-library-assets-venue-category | 3.7 | 2 | media_assets, media_label_items, menu_versions | media_assets, media_label_items, menu_entries, menu_sections, menu_versions |
| current | staff-lightest-library-assets-content-dish | n/a | 0.6 | - | media_assets, media_labels |
| current | staff-median-library-assets-content-dish | n/a | 0.6 | - | media_assets, media_labels |
| current | staff-lightest-library-assets-category | n/a | 1.9 | - | media_assets, media_label_items, menu_entries, menu_sections, menu_versions |
| current | staff-lightest-portfolio-first | n/a | 0.3 | - | media_assets |
| current | staff-heaviest-portfolio-first | 0.8 | 0.4 | media_assets | media_assets |
| current | staff-heaviest-portfolio-cursor-90pct | 0.9 | 0.4 | media_assets | media_assets |
| current | label-summaries-media-labels-24 | 1 | 0.6 | media_labels, media_assets | media_labels, media_assets |
| current | label-summaries-details-24 | 4.1 | 2.8 | media_assets | media_assets |
| current | label-summaries-details-24-staff | 3.8 | 3 | media_assets | media_assets |
| current | label-summaries-suggestions-24 | 0.1 | 0 | menu_item_suggestions, media_assets | menu_item_suggestions, media_assets |
| current | menu-version-label-items-page1 | 2.4 | 1 | media_label_items | media_label_items |
| current | menu-version-label-items-page30 | 1.8 | 1 | media_label_items | media_label_items |
| current | menu-version-label-items-count | 1.7 | 1 | media_label_items | media_label_items |
| current | filter-options-items-with-labels | 3.9 | 2.6 | media_label_items | media_label_items |
| current | catalogue-entries-staff | 123 | 28.6 | - | menu_entries |
| current | catalogue-entries-admin | 74 | 11.4 | - | menu_entries |
| expected | admin-feed-first | 0.6 | 0.4 | - | - |
| expected | admin-feed-cursor-10pct | 6.7 | 5.5 | - | - |
| expected | admin-feed-cursor-50pct | 19.4 | 18.7 | - | - |
| expected | admin-feed-cursor-90pct | 33.1 | 29.8 | - | - |
| expected | admin-venue-first | 0.4 | 0.4 | - | - |
| expected | admin-venue-cursor-90pct | 12.5 | 12.5 | - | - |
| expected | admin-staff-first | 0.5 | 0.4 | - | - |
| expected | admin-staff-cursor-90pct | 2.5 | 2.3 | - | - |
| expected | admin-type-video | 0.8 | 0.7 | - | - |
| expected | admin-category-curries | 889 | 815 | media_label_items, menu_sections | media_label_items, menu_entries, menu_sections |
| expected | admin-category-curries-cursor-50pct | 879 | 851 | media_label_items, menu_sections | media_label_items, menu_entries, menu_sections |
| expected | admin-labelled | 274 | 249 | media_labels | media_labels |
| expected | admin-unlabelled | 276 | 248 | media_labels | media_labels |
| expected | admin-content-dish | 1.5 | 1.4 | - | - |
| expected | admin-item-popular | 5.7 | 7.5 | - | - |
| expected | admin-item-rare | 103 | 113 | - | - |
| expected | admin-search-tikka | 8 | 6.5 | - | - |
| expected | admin-search-nomatch | 6,795 | 2,291 | - | - |
| expected | staff-heaviest-library-assets-category | 634 | 586 | media_label_items, menu_sections | media_label_items, menu_entries, menu_sections |
| expected | staff-heaviest-library-assets-venue-category | 618 | 589 | media_label_items, menu_sections | media_label_items, menu_entries, menu_sections |
| expected | staff-lightest-library-assets-content-dish | 36.1 | 31.5 | - | - |
| expected | staff-median-library-assets-content-dish | 5.3 | 4.8 | - | - |
| expected | staff-lightest-library-assets-category | 530 | 510 | media_label_items, menu_sections | media_label_items, menu_entries, menu_sections |
| expected | staff-lightest-portfolio-first | 0.6 | 0.6 | - | - |
| expected | staff-heaviest-portfolio-first | 0.5 | 0.5 | - | - |
| expected | staff-heaviest-portfolio-cursor-90pct | 5.6 | 5.3 | - | - |
| expected | label-summaries-media-labels-24 | 1.3 | 0.9 | - | - |
| expected | label-summaries-details-24 | 4 | 3.7 | - | - |
| expected | label-summaries-details-24-staff | 3.6 | 3.7 | - | - |
| expected | label-summaries-suggestions-24 | 0.5 | 0.4 | - | - |
| expected | menu-version-label-items-page1 | 11.6 | 11.5 | - | - |
| expected | menu-version-label-items-page30 | 129 | 132 | media_label_items | - |
| expected | menu-version-label-items-count | 128 | 131 | media_label_items | - |
| expected | filter-options-items-with-labels | 165 | 22.9 | - | - |
| expected | catalogue-entries-staff | 80.4 | 31.1 | - | - |
| expected | catalogue-entries-admin | 56.1 | 12 | - | - |
| high | admin-feed-first | 0.4 | 0.5 | - | - |
| high | admin-feed-cursor-10pct | 18.4 | 15 | - | - |
| high | admin-feed-cursor-50pct | 94.3 | 96.9 | - | - |
| high | admin-feed-cursor-90pct | 123 | 103 | - | - |
| high | admin-venue-first | 0.6 | 0.3 | - | - |
| high | admin-venue-cursor-90pct | 32.5 | 34.4 | - | - |
| high | admin-staff-first | 0.5 | 0.4 | - | - |
| high | admin-staff-cursor-90pct | 14.2 | 4.6 | - | - |
| high | admin-type-video | 0.5 | 0.5 | - | - |
| high | admin-category-curries | 2,615 | 2,314 | media_label_items | media_label_items, menu_entries, menu_sections |
| high | admin-category-curries-cursor-50pct | 2,598 | 2,733 | media_label_items | media_label_items, menu_entries, menu_sections |
| high | admin-labelled | 768 | 847 | media_labels | media_labels |
| high | admin-unlabelled | 753 | 746 | media_labels | media_labels |
| high | admin-content-dish | 1.3 | 1.2 | - | - |
| high | admin-item-popular | 9.4 | 9.5 | - | - |
| high | admin-item-rare | 267 | 399 | - | - |
| high | admin-search-tikka | 15.5 | 6.7 | - | - |
| high | admin-search-nomatch | 20,252 | 7,395 | - | - |
| high | staff-heaviest-library-assets-category | 2,026 | 2,145 | media_label_items | media_label_items, menu_entries, menu_sections |
| high | staff-heaviest-library-assets-venue-category | 2,168 | 2,071 | media_label_items | media_label_items, menu_entries, menu_sections |
| high | staff-lightest-library-assets-content-dish | 108 | 104 | - | - |
| high | staff-median-library-assets-content-dish | 8.4 | 9 | - | - |
| high | staff-lightest-library-assets-category | 1,905 | 1,912 | media_label_items | media_label_items, menu_entries, menu_sections |
| high | staff-lightest-portfolio-first | 0.5 | 0.8 | - | - |
| high | staff-heaviest-portfolio-first | 0.5 | 0.5 | - | - |
| high | staff-heaviest-portfolio-cursor-90pct | 16.8 | 10.8 | - | - |
| high | label-summaries-media-labels-24 | 1.7 | 1.1 | - | - |
| high | label-summaries-details-24 | 4.6 | 4.2 | - | - |
| high | label-summaries-details-24-staff | 3.9 | 3.4 | - | - |
| high | label-summaries-suggestions-24 | 0.5 | 0.5 | - | - |
| high | menu-version-label-items-page1 | 16.8 | 14.8 | - | - |
| high | menu-version-label-items-page30 | 383 | 348 | media_label_items | - |
| high | menu-version-label-items-count | 369 | 340 | media_label_items | - |
| high | filter-options-items-with-labels | 395 | 26.9 | - | - |
| high | catalogue-entries-staff | 77.8 | 35.2 | - | - |
| high | catalogue-entries-admin | 55.6 | 14.7 | - | - |

### Media processing: sequential, one process per row

| Input | wall p50 before / after | CPU ms per op before / after | peak RSS MiB before / after |
| --- | ---: | ---: | ---: |
| JPEG 12 MP (4032x3024) | 189 / 165 | 281 / 186 | 368 / 199 |
| JPEG 8 MP (3264x2448) | 157 / 142 | 222 / 163 | 313 / 195 |
| PNG 12 MP (synthetic-12mp.png, 2.4 MiB) | 125 / 108 | 215 / 130 | 361 / 201 |
| HEIC 12 MP (synthetic-12mp.heic) | 386 / 360 | 597 / 550 | 397 / 368 |
| HEIC 39 MP (synthetic-39mp.heic) | 783 / 728 | 1,188 / 1,128 | 583 / 559 |
| video MP4 tiny (synthetic.mp4) | 0.2 / 0.2 | 0.3 / 0.3 | 81 / 82 |
| video MOV tiny (synthetic.mov) | 0.2 / 0.3 | 0.3 / 0.4 | 81 / 82 |
| video WebM tiny (synthetic.webm) | 0.1 / 0.1 | 0.2 / 0.2 | 81 / 82 |
| video HEVC MOV (review-hevc.mov) | 0.2 / 0.2 | 0.3 / 0.3 | 81 / 82 |
| video MP4 20 MiB, moov at end | 0.2 / 0.2 | 0.3 / 0.3 | 81 / 82 |
| video MP4 200 MiB, moov at end | 0.2 / 0.2 | 0.3 / 0.4 | 81 / 82 |

### Media processing: concurrent callers in one process

| Input | concurrent | per item ms before / after | peak RSS MiB before / after | failures after |
| --- | ---: | ---: | ---: | ---: |
| JPEG 12 MP | 1 | 176 / 164 | 305 / 195 | 0 |
| JPEG 12 MP | 2 | 92.6 / 84.1 | 502 / 268 | 0 |
| JPEG 12 MP | 4 | 51.8 / 46.1 | 877 / 438 | 0 |
| JPEG 12 MP | 8 | 51.6 / 52.8 | 1302 / 475 | 0 |
| JPEG 12 MP | 10 | n/a / 48.8 | n/a / 440 | 0 |
| JPEG 12 MP | 16 | 51.1 / 47.9 | 1619 / 468 | 0 |
| PNG 12 MP | 1 | n/a / 108 | n/a / 187 | 0 |
| PNG 12 MP | 4 | n/a / 31.6 | n/a / 398 | 0 |
| PNG 12 MP | 10 | n/a / 32 | n/a / 404 | 0 |
| HEIC 39 MP | 1 | n/a / 740 | n/a / 566 | 0 |
| HEIC 39 MP | 4 | n/a / 723 | n/a / 599 | 0 |
| HEIC 12 MP | 1 | 376 / 358 | 390 / 368 | 0 |
| HEIC 12 MP | 2 | 377 / 365 | 390 / 381 | 0 |
| HEIC 12 MP | 4 | 346 / 354 | 398 / 378 | 0 |
| HEIC 12 MP | 8 | 341 / 359 | 411 / 398 | 0 |
| video 200 MiB probe | 1 | 0.3 / 0.3 | 80 / 81 | 0 |
| video 200 MiB probe | 4 | 0.1 / 0.1 | 80 / 81 | 0 |
| video 200 MiB probe | 8 | 0.1 / 0.2 | 80 / 82 | 0 |
