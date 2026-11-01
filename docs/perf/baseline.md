# Catalogue and media performance baseline

Workstream 3, phase 1 (baseline). Nothing in `app/`, `components/`, `lib/` or `supabase/migrations/` was changed to produce these numbers. The harness is in `tests/perf/`; raw results are in `docs/perf/raw/`.

## 1. Summary

The catalogue and media paths are fast at today's volume (50 media, 2 venues) and stay fast at 221k media for everything that is a plain indexed read. Four things do not scale:

| # | What | current | expected (75k) | high (221k) | Kind |
| --- | --- | ---: | ---: | ---: | --- |
| 1 | Admin library label filters through `library_assets` (category, labelled, unlabelled, rare item, text search) | 9 ms (category) | 1.2 s (category), 0.35 s (labelled), search with no match times out at 8 s | 3.3 s (category), 1.1 s (labelled), search with no match times out at 8 s | defect |
| 2 | `getMenuVersion` (menu version page, and the venue menu page when it has open suggestions) | 0.13 s | 2.6 s | 18.6 s, 60 sequential requests | defect |
| 3 | Library filter options for one venue (`/admin?venue=`) | 80 ms | 0.27 s | 0.54 s | defect, smaller |
| 4 | Admin library cursor pages | 4 ms | 36 ms at 90% depth | 111 ms at 90% depth | defect, smaller |

Items 1 to 3 cost the same per label row regardless of the 24-row page, because the database reads the whole labels table on every call and runs a `SECURITY DEFINER` RLS function once per row. Items 1 and 2 reach the 8 s API statement timeout between the expected and high volumes (no-match search already at expected, `getMenuVersion` page at high). Details, evidence and a ranked fix list are in sections 6 and 7.

Fast and flat at every volume: first library page (6 to 7 ms), venue, staff, type and date filters, staff portfolio (first page 4 ms, 90% depth 14 ms at the heaviest uploader), label summaries, `getLabellingCatalogue` for realistic menus (85 ms for 350 items), menu import and activation up to 600 items, thumbnail and preview routes (6 to 7 ms), video stream (first byte 35 to 40 ms). Media processing has no CPU problem; its risk is memory under concurrency (section 5.3).

## 2. Revision, machine and settings

| Item | Value |
| --- | --- |
| Revision measured | `40c4005 + the harness commit that adds this file` on branch `ws3/baseline`. The harness files are the only addition; application code is identical to `ws/tech-debt-ws3` at `40c4005`. |
| Date | 1 November 2026 |
| Machine | **Local macOS laptop** (Apple M5 Pro, 18 cores, 64 GiB), Node 24.16.0. Other agents' stacks and builds shared it. The 1-minute load average was 3 to 9 during the runs (each result file records it); the first database pass at current volume started at 7.9 and ended at 8.7, so it is mildly contended. All other passes started below 8. |
| Database | Local Supabase stack `spare6` (Docker, PostgreSQL 17.6, Supabase CLI stack), the journey fixture world plus the generated PERF data |
| Database settings (from `SHOW`) | `shared_buffers` 128MB, `effective_cache_size` 128MB, `work_mem` 4MB, `maintenance_work_mem` 64MB (512MB in the loading session), `max_parallel_workers_per_gather` 2, `random_page_cost` 4, `max_connections` 100. The handover note said shared_buffers was 160 MB; `SHOW` says 128 MB and this document uses what `SHOW` reports. |
| API timeouts | Through the API (PostgREST roles): `statement_timeout` 8 s (3 s for anon), `lock_timeout` 8 s. Direct psql as `postgres` has none. |
| App | `next build` and `next start -p 3646 -H 127.0.0.1` of this worktree (production build, Next.js 16.4.2, Turbopack), build took 12.7 s |
| Storage | Local Storage, file backend |
| Not measured | Hosted Supabase (S3-backed Storage, pooler, network latency), Vercel functions and cold starts, real browsers |

**The absolute numbers are for this laptop and this database configuration.** A 128 MB buffer pool against a 1.2 GB data set means the high volume does not fit in cache, which is deliberate. Compare volumes with each other, not with a hosted project. Network latency to a hosted database adds to every sequential round trip, so paths that make many requests in a row (`getMenuVersion`: 60) will look worse in production than here.

No `could not resize shared memory segment` error occurred in any run, so the `max_parallel_workers_per_gather=0` workaround was never needed. pnpm 11.17.0 was used for measuring; lint and typecheck were run with pnpm 10.30.1 (section 8).

## 3. Data volumes and assumptions

All data is synthetic. Venues are `PERF Venue NN`, people are `perf-*@perf.nabalens.test`, dish names are generated. Nothing comes from real venue media or real staff. `tests/perf/generate.mjs` writes straight to the stack database as `postgres` with user triggers off (CHECK and UNIQUE constraints still apply), purges the previous PERF rows, compacts the tables (`VACUUM FULL`, so a smaller volume is not loaded into files sized for a larger one), loads the volume, then runs `VACUUM (ANALYZE)`. The random draws use a fixed seed; row ids come from `gen_random_uuid()`.

| Volume | Media | Source |
| --- | --- | --- |
| current | 50 media, 2 venues | production today, as stated in the assignment |
| expected | 75,050 media | `docs/archive-capacity.md`, Expected scenario at 24 months |
| high | 221,150 media | same document, High scenario at 24 months |

Assumptions (each is a parameter in `tests/perf/generate.sql` or `generate.mjs`):

- **Venues and staff.** 2, 8 and 10 venues; 6, 60 and 100 staff plus 2 admins (`docs/INFRASTRUCTURE.md`: at most 100 staff across 10 venues). Venue size follows a Zipf-like curve: the largest venue holds 31% of the media at high volume (67,927 assets). Within a venue the upload weight follows rank^-0.9. 15% of staff are low-activity, 3% are deactivated and 5% moved venue part-way through the window, so `media_assets.venue_id` differs from their current venue. The heaviest uploader has 15,703 assets at high volume, the median 1,362.
- **Time.** Uploads are spread over 24 months (3 at current) with density growing linearly, in batches of 1 to 10 files by one person, minutes apart.
- **Media mix.** Video share 20%, 10% and 15% (current, expected, high). Photos: 45% JPEG, 40% HEIC, 8% PNG, 7% WebP; 2.8, 5.5 and 15 MB at 35, 55 and 10%; 8, 12 and 24 MP. Videos: 19.5, 80 and 209.7 MB at 50, 35 and 15%; 720p to 4K; 8 to 120 s. These follow `docs/archive-capacity.md`. 98.5% of rows are `ready`, 1.5% `failed`, 6 are `uploading`, and 0.5% of ready rows have a deletion tombstone. Photos have `thumbnail_path` and `preview_path`; videos have neither (the pipeline makes no video poster).
- **Archive receipts.** One receipt per ready asset, manifest about 650 bytes.
- **Labels.** 55% of ready, live assets are labelled (1 to 4 menu items, mean 1.4, 1 or 2 content types, 15% with a note); 10% of those carry content types only. A further 4% of assets have a withdrawn label row (`has_labels = false`). Item popularity is Zipf-like; 8% of label items point at items no longer on the active menu. About 1% of labelled assets have a missing-item suggestion, 40% of them open.
- **Menus.** One active version per venue plus 11 retired versions at the two larger volumes (one new version about every two months; 1 at current) and a draft in every second venue. Active menus have 80 to 200 items (350 at the largest venue; the product limit is 2,000), 8 to 12 sections, variants on every fourth item. Separate test venues hold generated menus of 50, 150, 600 and 2,000 items for the import and activation measurements.
- **Not modelled:** weekday effects, real photo content (derivative sizes in section 5.4 come from a smooth synthetic image), duplicate uploads and real label wording.

#### Data volumes as generated

| Row counts (PERF rows only) | current | expected | high |
| --- | ---: | ---: | ---: |
| media_assets | 50 | 75,050 | 221,150 |
| media_archive_receipts | 48 | 75,044 | 221,144 |
| media_labels | 24 | 42,066 | 125,084 |
| media_label_items | 30 | 59,519 | 176,784 |
| media_label_events | 23 | 40,722 | 121,022 |
| menu_item_suggestions | 0 | 384 | 1,238 |
| menu_versions | 5 | 100 | 125 |
| menu_sections | 48 | 1,002 | 1,250 |
| menu_items | 656 | 1,778 | 2,120 |
| menu_entries | 1,162 | 16,960 | 20,206 |
| menu_entry_variants | 871 | 12,709 | 15,147 |
| profiles | 8 | 62 | 102 |
| venues | 2 | 8 | 10 |

| Shape | current | expected | high |
| --- | ---: | ---: | ---: |
| staff / venues | 5 / 2 | 60 / 8 | 100 / 10 |
| assets per person, min / median / max | 3 / 8 / 25 | 18 / 866 / 7,080 | 23 / 1,362 / 15,703 |
| largest venue, assets | 38 | 25,043 | 67,927 |
| original bytes (sum) | 0.00 TB | 0.45 TB | 1.53 TB |

| Table + indexes on disk | current | expected | high |
| --- | ---: | ---: | ---: |
| media_archive_receipts | 208 kB | 163 MB | 482 MB |
| media_assets | 256 kB | 81 MB | 233 MB |
| media_label_items | 128 kB | 18 MB | 54 MB |
| media_labels | 96 kB | 10 MB | 31 MB |
| media_label_events | 80 kB | 10096 kB | 29 MB |
| menu_entries | 1136 kB | 11 MB | 13 MB |


## 4. Method

| Harness file | What it does |
| --- | --- |
| `tests/perf/generate.mjs`, `generate.sql`, `purge.sql` | the large-library generator (section 3) |
| `tests/perf/volume-info.mjs` | row counts, sizes, spread and the database settings of a volume |
| `tests/perf/explain.mjs` | `EXPLAIN (ANALYZE, BUFFERS)` of the statements PostgREST sends, run as `authenticated` with the person's JWT claims so RLS applies. Statement shapes were captured from `pg_stat_statements` on the same stack. Plans are in `docs/perf/raw/<volume>/explain/`. |
| `tests/perf/db-bench.mjs` | calls the app's own server functions (`listLibrary`, `listOwnMedia`, `getLabellingCatalogue`, `libraryLabelFilterOptions`, `getMenuVersion`, ...) as signed-in PERF people through PostgREST, so RLS and the 8 s statement timeout apply. Every HTTP request is counted and timed; non-2xx bodies are kept. |
| `tests/perf/refresh-bench.mjs` | the admin gallery's refresh loop and several admins at once |
| `tests/perf/menu-bench.mjs` | import parse, validate, match, diff; draft create, save and activate through the real RPCs |
| `tests/perf/media-bench.mjs` | sharp, HEIC worker and video probe time, CPU and peak RSS; concurrency. One child process per row so peak RSS belongs to that row. |
| `tests/perf/delivery-bench.mjs` | thumbnail, preview and stream routes, signed Storage URLs, cache headers |
| `tests/perf/ttfb-bench.mjs` | page and API response time from `next start`; first-load JS per route |
| `tests/perf/report.mjs` | renders `docs/perf/raw` into the tables below |
| `tests/perf/run-db.sh`, `run-rest.sh` | one volume end to end (generate, measure) |

Order per volume: generate, volume facts, EXPLAIN, app-function bench (read only); then, after regenerating the same volume, refresh, delivery, page timings, and last the menu bench (it activates menus, so it changes the data).

Repetitions: 3 warm-up and 20 timed runs per database path (a path whose first run takes over 3 s gets 1 warm-up and 8 runs), 3 warm-up and 20 timed runs per page (same rule). p50 and p95 are nearest-rank percentiles of the timed runs, so with 20 runs p95 is the second-slowest run. Media rows are 10 to 15 runs, concurrency rows 3 to 4 batches. EXPLAIN is a single run on a warm cache.

Sign-in uses the same magic-link token path as `tests/load/run.mjs`. The database-path bench calls the app's server functions in-process with the same Supabase client calls the pages make, so it excludes Next.js overhead; the page timings in section 5.5 include it.

"TTFB" and "complete" in the page tables are server response times seen by a Node client, not browser paint. These pages stream (`loading.tsx`), so TTFB is always about 5 to 10 ms; **the complete time is the one that includes the queries.**

## 5. Results

### 5.1 Admin library, staff portfolio and labelling paths

The "wall time" is the app function (`listLibrary` and so on), including the label-summary reads it makes for the page (4 requests per page: the page, `media_labels`, `media_label_details`, open suggestions).

#### Admin library feed and filters: p50 / p95 ms (wall time of the app function)

| Path | current | expected | high | requests (high) |
| --- | ---: | ---: | ---: | ---: |
| first page, no filter | 7.1 / 9.3 | 6.3 / 9.6 | 7.4 / 10.7 | 4 |
| cursor page at 10% depth | 5.8 / 6.6 | 10.8 / 12.2 | 23 / 28.6 | 4 |
| cursor page at 50% depth | 5 / 5.9 | 24.2 / 29.5 | 83 / 112 | 4 |
| cursor page at 90% depth | 3.8 / 4.7 | 35.7 / 47.6 | 111 / 139 | 4 |
| venue filter (largest) | 4 / 5.7 | 6.2 / 7.2 | 6 / 7.5 | 4 |
| venue (largest), cursor at 50% | 4.7 / 6.3 | 12.8 / 18.2 | 22 / 26.7 | 4 |
| venue (largest), cursor at 90% | 3.9 / 6.9 | 19.8 / 25.3 | 37 / 45.6 | 4 |
| venue filter (smallest) | 3.9 / 4.9 | 5.1 / 6.6 | 6.3 / 7.2 | 4 |
| staff filter (heaviest uploader) | 5.5 / 6.6 | 5.6 / 7.3 | 5.1 / 6.6 | 4 |
| staff (heaviest), cursor at 50% | 6.2 / 7.6 | 7.2 / 9.1 | 10.9 / 15.1 | 4 |
| staff (heaviest), cursor at 90% | 3.8 / 4.6 | 7.8 / 8.3 | 14.4 / 17.5 | 4 |
| staff filter (lightest) | 3.6 / 4.3 | 4.4 / 4.6 | 5.6 / 9.3 | 4 |
| type = video | 4.7 / 6.2 | 4.8 / 7.3 | 5.2 / 7.7 | 4 |
| type = image | 4 / 4.9 | 5.8 / 7.6 | 5 / 6.3 | 4 |
| venue + staff + type | 3.9 / 4.8 | 5.7 / 7.8 | 4.8 / 7.9 | 4 |
| date range, last 7 days | 4.7 / 5.2 | 5.6 / 7.7 | 6.5 / 8.2 | 4 |
| date range, last 90 days | 4.3 / 5.7 | 6.3 / 9 | 5.9 / 7.5 | 4 |
| category = curries (library_assets) | 9.5 / 10.9 | 1,188 / 1,251 | 3,259 / 3,278 | 4 |
| category = curries, cursor at 50% | 8.7 / 9.7 | 1,220 / 1,389 | 3,692 / 4,164 | 4 |
| venue (largest) + category | 21.6 / 29 | 1,199 / 1,260 | 3,550 / 4,426 | 4 |
| item filter, popular item | 11.8 / 18.1 | 9.2 / 10.9 | 12.7 / 16.6 | 4 |
| item filter, rare item | 12.6 / 14.8 | 84.6 / 123 | 269 / 320 | 4 |
| item + variant filter | 5.6 / 8.9 | 29.3 / 32.5 | 43.8 / 54.2 | 4 |
| content type = dish | 5.7 / 7.1 | 5.8 / 7.2 | 7.3 / 8.7 | 4 |
| labels = labelled | 6.5 / 7.2 | 327 / 374 | 1,067 / 1,243 | 4 |
| labels = unlabelled | 7.1 / 11.5 | 349 / 389 | 1,096 / 1,181 | 4 |
| search q=tikka | 13.6 / 20.1 | 15.3 / 17.1 | 17.1 / 20.2 | 4 |
| search q=chicken (very common) | 6.2 / 7.8 | 72.7 / 88.2 | 53.7 / 65.8 | 4 |
| search q=sunday (notes) | 6.2 / 7 | 274 / 333 | 126 / 146 | 4 |
| search q=zzzqq (no match) | 5.3 / 6.1 | **7,954 / 8,022, 4/8 failed** | **8,015 / 8,022, 8/8 failed** | 1 |
| search q=tikka + venue (largest) | 8.9 / 10.8 | 53.4 / 60 | 43.7 / 45.3 | 4 |
| filter options, venue (largest) | 80.3 / 142 | 274 / 293 | 542 / 626 | 7 |
| filter options, venue (smallest) | 46.3 / 56.4 | 63.1 / 68.9 | 84.5 / 94.8 | 6 |
| filter options (venues + staff) | 1.8 / 3 | 1.1 / 1.3 | 1.3 / 1.8 | 2 |


#### Staff portfolio, labelling and `library_assets` as staff: p50 / p95 ms (wall time of the app function)

| Path | current | expected | high | requests (high) |
| --- | ---: | ---: | ---: | ---: |
| portfolio first page (heaviest) | 5.6 / 7.6 | 5 / 5.5 | 4.3 / 4.8 | 4 |
| portfolio cursor 50% (heaviest) | 4.8 / 6.2 | 6.7 / 8.4 | 9.1 / 10.7 | 4 |
| portfolio cursor 90% (heaviest) | 5.6 / 8.8 | 11.6 / 15.8 | 14 / 21 | 4 |
| portfolio first page (median) | 9.9 / 15.2 | 9.8 / 15.1 | 4.2 / 4.8 | 4 |
| portfolio cursor 50% (median) | 17.3 / 26.2 | 7 / 9 | 6.8 / 8 | 4 |
| portfolio first page (lightest) | 9.6 / 17 | 5.4 / 7.9 | 4.9 / 7.2 | 4 |
| getLabellingCatalogue (staff, own venue) | 173 / 244 | 87.6 / 106 | 85.6 / 104 | 4 |
| getAssetLabelContext (10 assets, staff) | 6.6 / 9.1 | 4.9 / 7.3 | 4.6 / 5.9 | 4 |
| library_assets as staff, category (RLS plan) | 8.3 / 11.7 | 852 / 927 | 2,720 / 2,818 | 1 |
| library_assets as staff, venue + category | 7.5 / 9.9 | 959 / 1,178 | 2,938 / 3,402 | 1 |


#### Menu admin reads: p50 / p95 ms (wall time of the app function)

| Path | current | expected | high | requests (high) |
| --- | ---: | ---: | ---: | ---: |
| getLabellingCatalogue (admin, largest menu) | 126 / 172 | 86.9 / 97.8 | 84.9 / 96.2 | 4 |
| getLabellingCatalogue (admin, smallest venue) | 54.5 / 69.4 | 40.4 / 51.4 | 28.2 / 37.3 | 4 |
| listMenuVenues | 68 / 83.1 | 129 / 161 | 129 / 147 | 3 |
| getVenueMenuOverview (largest venue) | 41.7 / 48.7 | 36.2 / 40.3 | 36.8 / 42.2 | 5 |
| getMenuVersion, active (largest venue) | 125 / 151 | 2,640 / 2,877 | 18,610 / 18,871 | 60 |
| getMenuVersion, retired (largest venue) | 103 / 199 | 2,671 / 3,073 | 18,429 / 20,095 | 63 |
| getMenuVersion, active (smallest venue) | 69.3 / 91.6 | 142 / 185 | 522 / 634 | 11 |


#### Errors seen by the app functions

| Volume | Path | Error (count) |
| --- | ---: | ---: |
| expected | search q=zzzqq (no match) | 500 {"code":"57014","details":null,"hint":null,"message":"canceling statement due to statement timeout"} (4) |
| high | search q=zzzqq (no match) | 500 {"code":"57014","details":null,"hint":null,"message":"canceling statement due to statement timeout"} (8) |


**Gallery refresh and concurrency.** `app/_media/media-gallery.tsx` re-reads every loaded page, one cursor page at a time, every 15 s while the tab is visible, under a 10 s deadline (`REFRESH_TIMEOUT_MS`). Each page is 4 requests.

#### Admin gallery foreground refresh: k cursor pages read one after another, p50 / p95 ms

| Feed, pages loaded | current | expected | high |
| --- | ---: | ---: | ---: |
| unfiltered feed, 1 page | 6.5 / 9.4 | 7.8 / 8.4 | 9.2 / 25.4 |
| unfiltered feed, 5 pages | 18.6 / 21.9 | 24.4 / 27.8 | 26 / 28.6 |
| unfiltered feed, 20 pages | 12.9 / 13.5 | 88.5 / 90.3 | 90.6 / 101 |
| unfiltered feed, 50 pages | 15.8 / 18 | 284 / 314 | 236 / 260 |
| largest venue, 1 page | 6.1 / 8.4 | 4.2 / 4.2 | 4.5 / 5.5 |
| largest venue, 5 pages | 10.2 / 11.1 | 23.9 / 36.7 | 21.8 / 28.7 |
| largest venue, 20 pages | 8.4 / 11.6 | 137 / 161 | 158 / 183 |
| largest venue, 50 pages | 11 / 15.7 | 274 / 306 | 264 / 297 |


#### Several admins at once, per-request p50 / p95 ms

| Path, concurrent admins | current | expected | high |
| --- | ---: | ---: | ---: |
| first page x1 | 4.1 / 5.6 | 4.4 / 5.2 | 5.1 / 5.7 |
| first page x4 | 8.2 / 10.5 | 6.1 / 7.5 | 6.7 / 9.7 |
| first page x8 | 10.3 / 13.2 | 14 / 17.5 | 10 / 12.4 |
| category = curries x1 | 12.1 / 12.8 | 1,164 / 1,193 | 3,519 / 4,010 |
| category = curries x4 | 10.8 / 12.5 | 1,303 / 1,324 | 3,734 / 3,894 |
| category = curries x8 | 12.6 / 15 | 1,692 / 1,743 | 3,996 / 4,080 |
| labels = labelled x1 | 7.6 / 9 | 363 / 368 | 991 / 991 |
| labels = labelled x4 | 6.7 / 7.7 | 387 / 389 | 1,099 / 1,104 |
| labels = labelled x8 | 10 / 12.7 | 449 / 460 | 1,235 / 1,346 |


The slow label filters were not made slower by up to 8 concurrent admins (this laptop has 18 cores, so each query had its own core; a smaller database instance would queue). They are slow on their own.

### 5.2 EXPLAIN (ANALYZE, BUFFERS)

#### EXPLAIN (ANALYZE, BUFFERS) execution time, ms (single run, warm cache)

| Statement | current | expected | high | seq scans (high) |
| --- | ---: | ---: | ---: | ---: |
| admin-feed-first | 0.5 | 0.6 | 0.4 | - |
| admin-feed-cursor-10pct | 0.4 | 6.7 | 18.4 | - |
| admin-feed-cursor-50pct | 0.3 | 19.4 | 94.3 | - |
| admin-feed-cursor-90pct | 0.3 | 33.1 | 123 | - |
| admin-venue-first | 0.4 | 0.4 | 0.6 | - |
| admin-venue-cursor-90pct | 0.3 | 12.5 | 32.5 | - |
| admin-staff-first | 0.4 | 0.5 | 0.5 | - |
| admin-staff-cursor-90pct | 0.4 | 2.5 | 14.2 | - |
| admin-type-video | 0.4 | 0.8 | 0.5 | - |
| admin-category-curries | 5.1 | 889 | 2,615 | media_label_items |
| admin-category-curries-cursor-50pct | 7.7 | 879 | 2,598 | media_label_items |
| admin-labelled | 1.2 | 274 | 768 | media_labels |
| admin-unlabelled | 1.2 | 276 | 753 | media_labels |
| admin-content-dish | 1.1 | 1.5 | 1.3 | - |
| admin-item-popular | 1 | 5.7 | 9.4 | - |
| admin-item-rare | 1.3 | 103 | 267 | - |
| admin-search-tikka | 4 | 8 | 15.5 | - |
| admin-search-nomatch | 3.7 | 6,795 | 20,252 | - |
| staff-heaviest-library-assets-category | 3.9 | 634 | 2,026 | media_label_items |
| staff-heaviest-library-assets-venue-category | 3.7 | 618 | 2,168 | media_label_items |
| staff-heaviest-portfolio-first | 0.8 | 0.5 | 0.5 | - |
| staff-heaviest-portfolio-cursor-90pct | 0.9 | 5.6 | 16.8 | - |
| label-summaries-media-labels-24 | 1 | 1.3 | 1.7 | - |
| label-summaries-details-24 | 4.1 | 4 | 4.6 | - |
| label-summaries-details-24-staff | 3.8 | 3.6 | 3.9 | - |
| label-summaries-suggestions-24 | 0.1 | 0.5 | 0.5 | - |
| menu-version-label-items-page1 | 2.4 | 11.6 | 16.8 | - |
| menu-version-label-items-page30 | 1.8 | 129 | 383 | media_label_items |
| menu-version-label-items-count | 1.7 | 128 | 369 | media_label_items |
| filter-options-items-with-labels | 3.9 | 165 | 395 | - |
| catalogue-entries-staff | 123 | 80.4 | 77.8 | - |
| catalogue-entries-admin | 74 | 56.1 | 55.6 | - |
| staff-lightest-library-assets-content-dish | n/a | 36.1 | 108 | - |
| staff-median-library-assets-content-dish | n/a | 5.3 | 8.4 | - |
| staff-lightest-library-assets-category | n/a | 530 | 1,905 | media_label_items |
| staff-lightest-portfolio-first | n/a | 0.6 | 0.5 | - |


What the plans show (full plans in `docs/perf/raw/high/explain/`):

- **`admin-category-curries`** (3.4 s at high). `library_assets` is inlined, but each label EXISTS becomes a hashed `SubPlan` that seq-scans `media_label_items` (177k rows, 1.4 s with `Filter: private.can_read_asset_labels(asset_id)` evaluated per row) and a second subplan joins every active menu entry, section and label (162k rows, 1.7 s). The 25-row `Limit` does not help, because the hash is built before the first row. Buffers: 2.06M shared hits.
- **`admin-labelled` / `admin-unlabelled`** (0.9 and 1.0 s): hashed `SubPlan` over `media_labels` (125k rows, `Filter: has_labels AND private.can_read_asset_labels(asset_id)`).
- **`admin-search-nomatch`** (22.8 s in psql, 8 s cancelled through the API): a `Join Filter` of four EXISTS over every ready asset: 219,660 outer rows, each running index probes into `media_labels`, `media_label_items`, `menu_entries` (176,784 loops, each a `Bitmap Heap Scan` with `ILIKE` and the RLS function `staff_can_read_menu_version`), `menu_item_suggestions`. A query that matches nothing has to visit every asset.
- **`admin-item-rare`** (0.49 s): `Index Only Scan` on `media_label_items_tuple_key` probed 170,883 times (once per ready asset in feed order) until 25 matches are found; cost depends on how far down the feed the rare item's assets are.
- **`menu-version-label-items-page30`** (450 ms; page 1 is 16 ms): `Seq Scan on media_label_items` with the per-row RLS function, then `Sort`, because there is no index on `media_label_items(venue_id)`. Each of the 55 pages repeats the scan and sort, offset by 1,000.
- **Cursor pages** (`admin-feed-cursor-*`): `Index Scan using media_assets_ready_feed_idx` with the `created_at < X OR (created_at = X AND id < Y)` condition as a **filter**, not an index bound, so the scan starts at the newest row and discards everything before the cursor: 123 ms at 90% depth at high.
- **Staff calling `library_assets`** (the app only calls it as admin; measured because the assignment asked): the plan recorded in `docs/menus-data-model.md` (Seq Scan plus Sort on `media_assets`) no longer applies at volume. The planner now uses `media_assets_ready_feed_idx` with the RLS predicate `(uploader_id = uid AND is_active_staff) OR (is_active_admin AND ready)` as a filter, so a staff member with 62 assets walks the whole global feed: `Rows Removed by Filter: 212,184`, 108 ms for a content-type filter and 1.9 s for a category filter at high. The staff portfolio itself (`listOwnMedia`) adds an explicit `uploader_id` predicate and uses `media_assets_uploader_feed_idx` (0.6 ms), so this only matters if staff ever get label filters on the portfolio.

### 5.3 Menu import, activation and media processing

#### Menu import: parse and validate, p50 / p95 ms (pure CPU, one core)

| Items / format | file size | p50 / p95 ms |
| --- | ---: | ---: |
| 50 / json | 9.9 KiB | 0.2 / 0.3 |
| 50 / csv | 5.5 KiB | 0.3 / 0.7 |
| 150 / json | 28.9 KiB | 0.8 / 0.8 |
| 150 / csv | 16.5 KiB | 0.9 / 1.3 |
| 600 / json | 116 KiB | 1.4 / 1.9 |
| 600 / csv | 67 KiB | 3.4 / 4.5 |
| 2000 / json | 385 KiB | 4.6 / 6 |
| 2000 / csv | 223 KiB | 10.7 / 11.7 |


#### Menu import: match and diff against the active menu, p50 ms (pure CPU)

| Items | Case | match | diff | uncertain | added | changed | removed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 50 | same keys, edited 10% | 0.1 | 0 | 0 | 5 | 5 | 5 |
| 50 | all keys changed (worst case) | 0.5 | 0 | 50 | 0 | 0 | 50 |
| 150 | same keys, edited 10% | 0.3 | 0.1 | 0 | 15 | 15 | 15 |
| 150 | all keys changed (worst case) | 4.1 | 0.4 | 150 | 0 | 0 | 150 |
| 600 | same keys, edited 10% | 2.6 | 1.8 | 0 | 60 | 60 | 60 |
| 600 | all keys changed (worst case) | 61.3 | 4 | 600 | 0 | 0 | 600 |
| 2000 | same keys, edited 10% | 14.9 | 12.3 | 0 | 200 | 200 | 200 |
| 2000 | all keys changed (worst case) | 634 | 56.9 | 2000 | 0 | 0 | 2000 |


#### Menu draft and activation through the real RPCs, p50 / p95 ms (per volume)

| Items | Step | current | expected | high |
| --- | ---: | ---: | ---: | ---: |
| 50 | file / document bytes | 9.9 KiB / 12.7 KiB | 9.9 KiB / 12.7 KiB | 9.9 KiB / 12.7 KiB |
|  | create draft (1 run) | 16.8 | 19.3 | 23.2 |
|  | save draft (1 run) | 17.2 | 17.6 | 23.2 |
|  | activate first (1 run) | 4.6 | 4.1 | 4 |
|  | preview against active (same file) | 13.8 / 16.4 | 14.6 / 17.1 | 14.7 / 24 |
|  | preview, edited 10% | 13.3 / 16 | 16 / 17.1 | 12.9 / 20.7 |
|  | preview, all keys changed | 13.2 / 14.8 | 17.1 / 22.7 | 18.9 / 27.2 |
|  | replace cycle: create draft | 14.8 / 15.2 | 16.5 / 26.3 | 18 / 19 |
|  | replace cycle: activate (retires old) | 3.1 / 3.7 | 3.6 / 6.1 | 3.5 / 3.8 |
|  | getLabellingCatalogue (admin) | 15.1 / 16.7 | 14.5 / 15.9 | 15.9 / 18.1 |
|  | getLabellingCatalogue (staff) | 18.5 / 20 | 17.6 / 19.4 | 18.8 / 21.2 |
|  | getMenuVersion | 15.1 / 15.9 | 23 / 23.8 | 69 / 71.4 |
| 150 | file / document bytes | 28.9 KiB / 37.5 KiB | 28.9 KiB / 37.5 KiB | 28.9 KiB / 37.5 KiB |
|  | create draft (1 run) | 29 | 29.6 | 37.1 |
|  | save draft (1 run) | 28.3 | 34.8 | 34.7 |
|  | activate first (1 run) | 2.2 | 3.1 | 2.5 |
|  | preview against active (same file) | 28.3 / 29.4 | 31.3 / 33 | 36.7 / 40.5 |
|  | preview, edited 10% | 27.8 / 28.7 | 30.9 / 33.1 | 34.8 / 39.5 |
|  | preview, all keys changed | 32.9 / 37.7 | 37.6 / 44 | 43.6 / 46.4 |
|  | replace cycle: create draft | 27.1 / 30.1 | 30.5 / 33.3 | 30.3 / 32.7 |
|  | replace cycle: activate (retires old) | 2.9 / 3.2 | 3 / 3.8 | 2.5 / 2.8 |
|  | getLabellingCatalogue (admin) | 31.9 / 32.7 | 30.9 / 31.4 | 34.1 / 43.2 |
|  | getLabellingCatalogue (staff) | 39.2 / 41.7 | 40.1 / 43.1 | 40.4 / 44.4 |
|  | getMenuVersion | 33.2 / 36 | 40.7 / 45.6 | 75.2 / 86.3 |
| 600 | file / document bytes | 116 KiB / 151 KiB | 116 KiB / 151 KiB | 116 KiB / 151 KiB |
|  | create draft (1 run) | 102 | 111 | 106 |
|  | save draft (1 run) | 106 | 111 | 115 |
|  | activate first (1 run) | 3.2 | 2.6 | 2.4 |
|  | preview against active (same file) | 96.6 / 103 | 107 / 122 | 108 / 117 |
|  | preview, edited 10% | 97.3 / 99.4 | 100 / 103 | 108 / 115 |
|  | preview, all keys changed | 160 / 165 | 161 / 168 | 172 / 200 |
|  | replace cycle: create draft | 104 / 110 | 99.6 / 108 | 111 / 146 |
|  | replace cycle: activate (retires old) | 2.5 / 3.3 | 2.5 / 2.9 | 3.1 / 3.6 |
|  | getLabellingCatalogue (admin) | 104 / 105 | 114 / 135 | 117 / 127 |
|  | getLabellingCatalogue (staff) | 136 / 149 | 135 / 149 | 145 / 148 |
|  | getMenuVersion | 117 / 124 | 132 / 186 | 127 / 135 |
| 2000 | file / document bytes | 385 KiB / 501 KiB | 385 KiB / 501 KiB | 385 KiB / 501 KiB |
|  | create draft (1 run) | 365 | 357 | 475 |
|  | save draft (1 run) | 396 | 378 | 466 |
|  | activate first (1 run) | 3.8 | 3.3 | 3.8 |
|  | preview against active (same file) | 862 / 881 | 734 / 794 | 779 / 820 |
|  | preview, edited 10% | 874 / 913 | 728 / 802 | 790 / 879 |
|  | preview, all keys changed | 1,524 / 1,548 | 1,360 / 1,412 | 1,407 / 1,452 |
|  | replace cycle: create draft | 353 / 366 | 351 / 380 | 382 / 415 |
|  | replace cycle: activate (retires old) | 3.1 / 3.9 | 2.8 / 3.1 | 3.2 / 3.4 |
|  | getLabellingCatalogue (admin) | 810 / 827 | 987 / 1,043 | 835 / 881 |
|  | getLabellingCatalogue (staff) | 1,134 / 1,395 | 1,155 / 1,332 | 1,165 / 1,257 |
|  | getMenuVersion | 903 / 922 | 789 / 854 | 832 / 841 |


#### Activation on the largest real venue (labels attached)

| Volume | venue assets | draft from active ms | activate ms |
| --- | ---: | ---: | ---: |
| current | 37 | 125, 115, 121 | 2.8, 3.2, 2.6 |
| expected | 24,881 | 132, 123, 122 | 2.6, 2.8, 2.1 |
| high | 67,682 | 144, 133, 158 | 2.7, 2.9, 3.2 |


Activation itself is 2 to 5 ms and does not depend on menu size or on labels. The cost of a large menu is in creating and saving the draft (document write, about 0.18 ms per item), in the import preview (it loads the active menu, parses, matches and diffs: 0.75 s at 2,000 items, 1.4 s when no source key matches), and in reading the catalogue back (`getLabellingCatalogue` 0.85 s for admin and 1.1 s for staff at 2,000 items). A realistic menu (150 items) takes 30 to 45 ms for each of these. The 2,000-item JSON test file is 385 KiB, under the 1 MiB import limit; a menu with long descriptions will be larger and slower.

The `getLabellingCatalogue` figures are not volume dependent (they do not read labels). Staff are slower than admin because `menu_entries` and `menu_entry_variants` have a staff policy that calls `private.staff_can_read_menu_version(version_id)` for every row (`supabase/migrations/20261030120000_menu_catalogue.sql:464-477` and `567-577`).

#### Media processing: sequential, one process per row

| Input | size | wall p50 / p95 ms | CPU ms per op | peak RSS MiB (idle) |
| --- | ---: | ---: | ---: | ---: |
| JPEG 12 MP (4032x3024) | 5.2 MiB | 189 / 204 | 281 | 368 (80) |
| JPEG 8 MP (3264x2448) | 2.7 MiB | 157 / 162 | 222 | 313 (81) |
| PNG 12 MP (synthetic-12mp.png, 2.4 MiB) | 2.4 MiB | 125 / 128 | 215 | 361 (80) |
| HEIC 12 MP (synthetic-12mp.heic) | 0.3 MiB | 386 / 398 | 597 | 397 (81) |
| HEIC 39 MP (synthetic-39mp.heic) | 1 MiB | 783 / 799 | 1,188 | 583 (80) |
| video MP4 tiny (synthetic.mp4) | 0 MiB | 0.2 / 0.3 | 0.3 | 81 (80) |
| video MOV tiny (synthetic.mov) | 0 MiB | 0.2 / 0.3 | 0.3 | 81 (80) |
| video WebM tiny (synthetic.webm) | 0 MiB | 0.1 / 0.3 | 0.2 | 81 (80) |
| video HEVC MOV (review-hevc.mov) | 0 MiB | 0.2 / 0.3 | 0.3 | 81 (80) |
| video MP4 20 MiB, moov at end | 18.5 MiB | 0.2 / 0.3 | 0.3 | 81 (80) |
| video MP4 200 MiB, moov at end | 200 MiB | 0.2 / 0.3 | 0.3 | 81 (80) |


#### Media processing: concurrent callers in one process

| Input | concurrent | batch p50 / p95 ms | per item ms | peak RSS MiB | failures |
| --- | ---: | ---: | ---: | ---: | ---: |
| JPEG 12 MP | 1 | 176 / 177 | 176 | 305 | 0 |
| JPEG 12 MP | 2 | 185 / 188 | 92.6 | 502 | 0 |
| JPEG 12 MP | 4 | 207 / 275 | 51.8 | 877 | 0 |
| JPEG 12 MP | 8 | 412 / 452 | 51.6 | 1302 | 0 |
| JPEG 12 MP | 16 | 817 / 828 | 51.1 | 1619 | 0 |
| HEIC 12 MP | 1 | 376 / 379 | 376 | 390 | 0 |
| HEIC 12 MP | 2 | 754 / 755 | 377 | 390 | 0 |
| HEIC 12 MP | 4 | 1,385 / 1,460 | 346 | 398 | 0 |
| HEIC 12 MP | 8 | 2,732 / 2,838 | 341 | 411 | 0 |
| video 200 MiB probe | 1 | 0.3 / 0.3 | 0.3 | 80 | 0 |
| video 200 MiB probe | 4 | 0.4 / 0.6 | 0.1 | 80 | 0 |
| video 200 MiB probe | 8 | 0.5 / 1.6 | 0.1 | 80 | 0 |


Notes: the HEIC fixtures are smooth synthetic images and decode faster than camera HEIC files (`docs/runtime-sizing.md` measured about 0.9 s per 12 MP iPhone-like HEIC with the `sips` fixture); the relative figures (queue, memory) are what matters. The video probe reads only the head and the `moov` box and does no transcoding, poster or thumbnail work, so its CPU cost is below a millisecond even for 200 MiB; its real cost in the app is the Range reads from Storage (`docs/runtime-sizing.md`: about 0.7 s per finalise, dominated by Storage). Peak RSS is for the whole Node process, including the HEIC worker thread.

### 5.4 Delivery

#### Delivery: route time to the 302 and signed Storage GET, p50 / p95 ms

| Route | current route | current storage GET | expected route | expected storage GET | high route | high storage GET |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| thumbnail route, admin | 8.4 / 11.8 | 2.6 / 5.8 | 7.1 / 9.8 | 2.1 / 3 | 6.4 / 8.5 | 1.8 / 2.4 |
| thumbnail route, staff (owner) | 6.4 / 7.8 | 2 / 3.5 | 6.7 / 8.8 | 2 / 2.8 | 6.5 / 8.1 | 1.7 / 2.3 |
| preview route, admin | 7.2 / 10.1 | 2.5 / 3.7 | 6.5 / 8.7 | 2.5 / 3.5 | 6.4 / 9.1 | 2.2 / 3.1 |
| preview route, staff (owner) | 6 / 12.5 | 2.2 / 2.5 | 6.3 / 9.3 | 2.4 / 4.3 | 6.4 / 8.8 | 2.2 / 3.3 |

| Path | current | expected | high |
| --- | ---: | ---: | ---: |
| 24 thumbnails of one gallery page, 6 parallel, admin (wall ms) | 15.2 / 17.1 | 70.6 / 91.2 | 60.3 / 67.3 |
| 24 thumbnails of one gallery page, 6 parallel, staff (owner) (wall ms) | 14.1 / 16.6 | 64.7 / 88.1 | 61.8 / 71.5 |
| authorisation only (signDerivative, in process) | 2.5 / 3.3 | 2.3 / 2.9 | 2.4 / 2.6 |
|   of which asset read | 1.1 | 1 | 1 |
|   of which sign call | 1.2 | 1.1 | 1.2 |

Derivative sizes: thumbnail 27.8 KiB, preview 105 KiB (from the smooth synthetic 12 MP image).

Route response headers: `{"cache-control":"private, no-store","x-content-type-options":"nosniff","referrer-policy":"strict-origin-when-cross-origin"}`. Signed Storage response: `{"status":200,"bytes":28448,"cache-control":null,"content-type":"image/webp","etag":"\"05338f31b801e6596b6c5c91a0f98605\"","last-modified":"Sun, 01 Nov 2026 09:05:25 GMT","accept-ranges":"bytes","content-length":"28448"}`.

| Video stream, 20 MiB original | current | expected | high |
| --- | ---: | ---: | ---: |
| first 1 MiB (TTFB p50 / p95 ms) | 38.5 / 41.8 | 37.3 / 40.3 | 35.3 / 41.5 |
| seek to 10 MiB (TTFB p50 / p95 ms) | 37.6 / 40.3 | 36.2 / 43.6 | 34.8 / 41.3 |
| open-ended from 0 (first byte only counted) (TTFB p50 / p95 ms) | 43.9 / 50.9 | 48.5 / 57.4 | 43.6 / 54.3 |

Stream response headers: `{"status":206,"cache-control":"private, no-store","content-type":"video/mp4","content-range":"bytes 0-1048575/19897168","accept-ranges":"bytes","content-length":"1048576","etag":"\"7ad7244a7b3ee0089212aa7b0fe6e945\""}`.


### 5.5 Rendering from `next build` and `next start`

#### Page and API response time from `next start`: complete / TTFB p50, complete p95 (ms)

| Route | current | expected | high | HTML bytes (high) |
| --- | ---: | ---: | ---: | ---: |
| admin library /admin | 10.8 / 5.2, p95 13.4 | 10.8 / 4.9, p95 11.9 | 10.6 / 4.6, p95 11.9 | 115,116 |
| admin library, largest venue | 76.1 / 6.2, p95 80.5 | 266 / 7, p95 307 | 551 / 6.6, p95 583 | 198,979 |
| admin library, category filter | 14 / 5, p95 16 | 1,096 / 6.2, p95 1,166 | 3,125 / 6.6, p95 3,491 | 122,709 |
| admin library, venue + category filter | 77.2 / 7, p95 86 | 1,110 / 7, p95 1,162 | 3,494 / 6.7, p95 3,713 | 206,224 |
| admin library, search q=tikka | 15.7 / 6.1, p95 20.7 | 20.6 / 5.2, p95 22 | 24.6 / 5.3, p95 30.2 | 121,632 |
| admin menus list | 57.5 / 6.5, p95 66.9 | 103 / 6.4, p95 112 | 116 / 6.5, p95 123 | 70,271 |
| admin menus, largest venue | 34 / 7.3, p95 43.3 | 2,148 / 7.9, p95 2,300 | 15,917 / 9, p95 16,881 | 1,305,268 |
| admin menu version (largest venue, active) | 88.6 / 6, p95 112 | 2,051 / 6.5, p95 2,112 | 15,409 / 7.6, p95 16,757 | 197,124 |
| admin menu version (smallest venue, active) | 45.5 / 5.9, p95 52.7 | 109 / 6.2, p95 120 | 491 / 8.1, p95 631 | 87,912 |
| admin staff list | 20.6 / 6.1, p95 40.2 | 29.4 / 6.2, p95 33.6 | 43.1 / 7.4, p95 52.9 | 761,203 |
| admin staff member (heaviest) | 32.1 / 6.6, p95 51.9 | 29.7 / 5.8, p95 31.4 | 34.1 / 6.4, p95 38.9 | 84,243 |
| staff portfolio (heaviest) | 13.2 / 6.5, p95 18.6 | 10 / 4.5, p95 12.1 | 17.2 / 7.7, p95 22 | 72,476 |
| staff portfolio (median) | 12.7 / 6.4, p95 16.3 | 10.2 / 4.5, p95 11.6 | 12.6 / 5.7, p95 16.7 | 72,900 |
| JSON /api/library | 8.1 / 8, p95 12.1 | 7.9 / 7.8, p95 9.6 | 14.7 / 14.6, p95 17.8 | 19,608 |
| JSON /api/library?category=curries | 11 / 10.9, p95 12.3 | 1,112 / 1,112, p95 1,289 | 3,331 / 3,331, p95 3,585 | 24,267 |
| JSON /api/portfolio (heaviest) | 7.2 / 7.1, p95 9.5 | 8.3 / 8.2, p95 11.5 | 8.4 / 8.3, p95 13.9 | 17,851 |


#### First-load client assets per route (same build at every volume)

| Route | JS files | JS raw KiB | JS gzip KiB | JS brotli KiB | CSS raw KiB | HTML KiB (largest volume) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| login | 11 | 1,023 | 319 | 270 | 86.3 | 11.5 |
| admin library | 13 | 1,047 | 328 | 278 | 86.3 | 112 |
| admin menus list | 12 | 1,024 | 320 | 270 | 86.3 | 68.6 |
| admin menus, venue | 13 | 1,043 | 326 | 276 | 86.3 | 1,275 |
| admin menu version | 13 | 1,046 | 327 | 277 | 86.3 | 193 |
| admin staff list | 12 | 1,042 | 326 | 275 | 86.3 | 743 |
| staff portfolio | 13 | 1,366 | 412 | 348 | 86.3 | 70.8 |


Client JS is the same build at every volume and does not grow with data; HTML does, but only for the pages that embed whole documents (`/admin/menus/<venue>`: 1.3 MB at high because it loads the active menu to offer suggestion links; `/admin/staff`: 743 KiB at 100 staff). Server RSS of `next start` stayed between 261 and 433 MiB across the page runs. The first-load JS is about 1 MiB raw (320 to 330 KiB gzip) on every route including `/login`, and 1.37 MiB on `/staff` (upload code).

## 6. What grows with volume, and how

| Path | Growth | Evidence |
| --- | --- | --- |
| `library_assets` label filters (category, labelled, unlabelled, rare item, text search) | linear in label rows, independent of page size; text search with no match visits every asset | 1.2 s then 3.3 s (category) for 3x the media; no-match search 8.8 s then 22.8 s |
| `getMenuVersion` | linear in the venue's label items, one request per 1,000 rows, each a seq scan plus sort | 0.13 s, 2.6 s, 18.6 s; 6, 25 and 60 requests |
| `libraryLabelFilterOptions` (venue filter on the library page) | linear in label items of the venue | 80, 274, 542 ms |
| Library cursor pages | linear in depth (rows scanned before the cursor) | 90% depth: 4, 36, 111 ms |
| Gallery refresh | sum of the above for every loaded page, per open tab, every 15 s | 50 loaded pages: 284 ms at expected, 236 ms at high (the feed pages are cheap; with a label filter active each page costs 1 to 3 s, so three loaded pages already exceed the 10 s refresh deadline, an inference from the per-page times above) |
| Menu import match | quadratic in items (`old.find` per item, `candidates.filter` with a regex per candidate) | all-keys-changed: 4 ms at 150, 60 ms at 600, 623 ms at 2,000 |
| JPEG decode memory | linear in concurrent decodes, no limit in code | 305 MiB for 1, 877 MiB for 4, 1,619 MiB for 16 |
| HEIC | linear queue behind one worker | 8 queued: 2.7 s |

Not growing (within noise): first page of every filter that uses the feed indexes, staff portfolio, label summaries, `getLabellingCatalogue` (depends on menu size, not on media), menu activation, signed-URL authorisation (about 2.4 ms) and delivery routes.

## 7. Candidate fixes, ranked

Ranking is by evidence of user-visible harm at the high volume, then by closeness to the 8 s timeout. Targets are for the high volume (221k media) on this same harness and stack settings. Nothing below was changed. Effort: S is under a day, M a few days, L about a week or more. Migrations on catalogue or media tables need one named owner (contracts section 9).

### 1. `library_assets` label filters read the whole labels table (defect)

- **Evidence.** Category 3.3 s p50 (4.2 s p95 at depth) at high, 1.2 s at expected; labelled 1.1 s; unlabelled 1.1 s; rare item 0.27 s; text search with no match is cancelled at 8 s (57014) in 4 of 8 runs at expected and 8 of 8 at high, and takes 22.8 s without a timeout. Flat in page size; per-row RLS function calls dominate (2.06M buffer hits for one category query). Extrapolating the category filter linearly crosses 8 s at about 560k media (an estimate from two points).
- **Likely cause.**
  - `public.library_assets` is a single SELECT with 6 optional EXISTS predicates, `supabase/migrations/20261030120100_media_labels.sql:782-881`. When the caller's RLS applies, PostgreSQL turns the uncorrelated parts into hashed SubPlans that scan the entire table first (`:814-831` category, `:839-849` label state, `:850-880` text search).
  - RLS on `media_labels` and `media_label_items` calls `private.can_read_asset_labels(asset_id)`, a `SECURITY DEFINER` function that is not inlined and costs a lookup per row (`:204-222`, policies `:306-309`). It is evaluated for every row of the table in the hashed scan.
  - The category branch joins every entry of every active version of every venue (`:820-830`); the search branch applies `ILIKE '%…%'` with no trigram index to item names, snapshot names, entry names and aliases (`:857-875`), per asset.
  - The app calls it from `lib/server/media/library.ts:405` (`listLibrary`), reached from `/admin`, `/api/library` and `/admin/staff/[id]`.
- **Target.** p95 at most 250 ms at high for category, labelled, unlabelled, rare item, text search (match and no match), single-venue variants; no seq scan of `media_labels` or `media_label_items` in the plan; no 57014 at 500k media. Same numbers at expected or better.
- **Effort.** M to L: needs a migration (restructure the function or replace it with a join-based query, make the label RLS cheap for the admin case, add an index or stored search text for the text search) plus the plan evidence at all three volumes. One migration owner.

### 2. `getMenuVersion` pages through every label item of the venue (defect)

- **Evidence.** 18.6 s p50 at high for the largest venue (60 sequential requests), 2.6 s at expected, 0.13 s at current. The version page (`/admin/menus/versions/<id>`) took 15.4 s and `/admin/menus/<venue>` 15.9 s (1.3 MB HTML) at high; the venue page calls `getMenuVersion` whenever the venue has an open suggestion. In production each of the 60 round trips adds network latency on top.
- **Likely cause.** `lib/server/menus/index.ts:535-545` selects `item_id` of every `media_label_items` row for the venue, 1,000 per request ordered by `id` with `OFFSET` (`selectAll`, `:105-118`), only to count labels per item (`countByItem`, `lib/server/menus/document.ts:117`, used at `index.ts:563`). Each page is a seq scan plus sort (no `media_label_items(venue_id)` index) with the RLS function per row: 17 ms for page 1, 450 ms for page 30 at high. The venue page reaches it at `app/admin/menus/[venueId]/page.tsx:104-111`.
- **Target.** `getMenuVersion` p95 at most 500 ms at high for any venue; `/admin/menus/<venue>` at most 300 ms; one database round trip for the counts. Request count independent of label volume.
- **Effort.** S to M: a grouped count (RPC or view with `count(*) group by item_id`, optionally an index on `(venue_id, item_id)`), and the same for the venue page's option list. The RPC needs a migration.

### 3. Library filter options for a venue read all of its labelled items (defect, smaller)

- **Evidence.** `libraryLabelFilterOptions` 542 ms p50 at high (7 requests) for the largest venue, 274 ms at expected. It is on the critical path of `/admin?venue=<id>`: 551 ms complete at high versus 6 ms for the feed itself.
- **Likely cause.** `lib/server/media/library-labels.ts:97-120` embeds `media_label_items!inner` under every `menu_items` and `menu_variants` row of the venue (an inner join into the RLS-protected label table, one `LATERAL ... LIMIT 1` per item), to find the newest snapshot name of each labelled item.
- **Target.** p95 at most 150 ms at high for the largest venue; page `/admin?venue=` complete time within 2x of the feed itself.
- **Effort.** S to M: one query that returns only the labelled item and variant ids (distinct), or a small summary table; same migration owner as fixes 1 and 2.

### 4. Library cursor condition cannot use the index (defect, smaller)

- **Evidence.** First page 7 ms; page at 50% depth 83 ms and at 90% depth 111 ms at high (36 ms at expected); the filtered feeds are cheaper (venue 90%: 37 ms, heaviest staff 90%: 14 ms) because the filter narrows the index scan. EXPLAIN: 123 ms and `Index Scan` over the ready feed with the cursor as a filter. The 15 s refresh re-reads all loaded pages, so a tab that has scrolled 20 pages costs 90 ms per refresh and 50 pages 236 to 284 ms.
- **Likely cause.** `lib/server/media/library.ts:306-309` sends `or(created_at.lt.X, and(created_at.eq.X, id.lt.Y))`; PostgreSQL treats it as a filter, so the index scan starts at the newest row and discards everything newer than the cursor.
- **Target.** Cursor page p95 at most 25 ms at any depth at high; refresh of 50 loaded pages at most 150 ms.
- **Effort.** S: a row-value comparison `(created_at, id) < (X, Y)` through a small RPC or view, or a two-step query. No schema change needed.

### 5. Unbounded sharp concurrency and 40 MP HEIC memory (observation, risk)

- **Evidence.** A 12 MP JPEG decode takes 190 ms and about 225 to 290 MiB of RSS above the 80 MiB idle process; 4 at once 877 MiB, 8 at once 1.3 GiB, 16 at once 1.6 GiB (throughput flat at about 50 ms per image from 4 concurrent up). A 39 MP HEIC (near the 40 MP limit) peaks at 583 MiB. HEIC decodes are serialised (`maxHeicConcurrency: 1`, `lib/config/media.ts:49`), 340 to 380 ms each here. `docs/runtime-sizing.md` measured 1.29 GiB RSS with 10 staff finalising at once.
- **Likely cause.** `lib/media/index.ts:93-104` decodes the full image into a raw RGBA buffer (about 48 MB at 12 MP, 160 MB at 40 MP) before resizing (`:122-142`), and nothing limits how many finalise calls decode at once in a process; only the HEIC path has a queue.
- **Target.** Peak RSS at most 1 GiB with 10 simultaneous 12 MP finalises (the default 2 GiB Vercel function leaves headroom); throughput not worse than today.
- **Effort.** S: a small semaphore around `decodedImage`, or sharp's `sequentialRead` and a shrink-on-load resize (`resize` from the encoded input rather than from raw RGBA, `failOn` kept). Not a defect today: no failures were observed locally, and this laptop is not a 2 GiB function.

### 6. Large-menu import and catalogue cost (observation at product limits)

- **Evidence.** At 2,000 items (the product maximum): import preview 0.75 s, 1.4 s if all source keys changed; match alone 623 ms; draft create 0.36 to 0.48 s; `getLabellingCatalogue` 0.85 s (admin) and 1.1 s (staff). At realistic sizes (150 items) every step is under 50 ms, and activation is 2 to 5 ms at any size.
- **Likely cause.** `lib/menus/import/matching.ts`: `old.find` per incoming item (`:63`), `candidates.filter` calling `nameKey` (Unicode normalise plus two regex replaces) per candidate per item (`:75-76`), and `old.find` per row in the diff (`:168`) are all O(items squared). The staff catalogue read is slower than admin's because of the per-row `staff_can_read_menu_version` policy call (`20261030120000_menu_catalogue.sql:567-577`).
- **Target.** Preview at most 300 ms and `getLabellingCatalogue` at most 400 ms (staff and admin) at 2,000 items; no change at 150 items.
- **Effort.** S: index the base items by source key and by normalised name in maps; for the catalogue, make the staff policy check once per version instead of per row.

### 7. Thumbnails are never cached by the browser (observation, decision needed)

- **Evidence.** Thumbnail and preview routes answer 302 in 6 to 7 ms p50 at every volume (authorisation 2.4 ms: asset read 1.0 ms plus sign call 1.2 ms), with `Cache-Control: private, no-store`. The signed Storage URL has a new token per request and the Storage response carried no `Cache-Control` in this local stack (an ETag only), although derivatives are uploaded with `cacheControl: 60` (`lib/server/media/finalise.ts:363`). A 24-tile page is therefore 24 authorisations plus 24 Storage GETs every time it is shown or refreshed: 61 to 71 ms here. Derivative sizes from the smooth synthetic image: thumbnail 28 KiB, preview 105 KiB; real photos will be larger.
- **Likely cause.** Deliberate: `app/api/media/_respond.ts:22-34` and `lib/server/media/access.ts:28-32` keep every private media response uncached so each load re-authorises (`docs/media-routes.md`); the redirect target changes per request.
- **Target.** None proposed without a product and security decision. If revisited: repeat gallery view needs no thumbnail Storage GETs for tiles already loaded, and the route p95 stays at most 15 ms.
- **Effort.** M, and it changes a documented security property. Cost is proportional to page views, not to library size.

### 8. Page weight (observation)

- **Evidence.** About 1.0 MiB raw JS (320 to 330 KiB gzip) first-load on every route, 1.37 MiB (412 KiB gzip) on `/staff`; HTML of `/admin/staff` is 743 KiB for 100 staff (about 7 KiB per person) and `/admin/menus/<venue>` is 1.3 MB at high volume.
- **Likely cause.** Not investigated beyond the sizes: a shared base bundle on every route (including `/login`), and per-row client UI (dialogs, forms) rendered in the staff list. The 1.3 MB venue page comes from fix 2's `getMenuVersion` call plus the active document passed to the client.
- **Target.** No growth of first-load JS per route; `/admin/staff` HTML at most 250 KiB at 100 staff; `/admin/menus/<venue>` HTML at most 150 KiB at high.
- **Effort.** M.

### 9. Other observations (no action proposed)

- Videos have no poster or thumbnail (`thumbnail_path` is null for every video), so the library shows no preview tile for them until played. The stream route is fast (first byte 35 to 40 ms for any Range).
- `media_archive_receipts` is the largest table: 482 MB at high (about 2.2 KB per receipt with its indexes), twice `media_assets` (233 MB). Relevant for backup and restore size (`docs/backup-restore.md`), not for any path measured here.
- The staff plan of `library_assets` (section 5.2) walks the whole feed for a sparse uploader; harmless until the portfolio uses label filters.
- Fast paths worth protecting when fixing the above: `listOwnMedia` (explicit `uploader_id` predicate), the feed index plans with venue, staff, type and date filters, and the label summary reads (about 5 ms per page).

## 8. What was not measured, and checks

Not measured:

- **Hosted Supabase, Vercel functions and real network latency.** Everything ran on one laptop against a local stack. Cold starts, function memory limits and pooler behaviour are unknown. Paths with many sequential requests (fix 2) are worse remotely.
- **Browser behaviour:** hydration, paint, scroll and image decode. Only server response times and transferred JS are reported.
- **Real photo and video content.** Derivative sizes and HEIC decode time come from smooth synthetic images; camera content decodes slower (`docs/runtime-sizing.md`).
- **Video transcoding, poster generation and upload end to end** (the app does not transcode; upload and finalise under load are in `docs/runtime-sizing.md`, not repeated here).
- **Volumes beyond 221k media** (the "Stress" scenario in `docs/archive-capacity.md`) and long-lived database effects (autovacuum, bloat after deletes); each volume was freshly loaded and vacuumed.
- **Text search with realistic wording:** the generated notes and names are short and repetitive.
- The `max_parallel_workers_per_gather=0` workaround: the shared-memory error did not occur.
- A variation in p95 between runs should be expected: several results (for example `q=chicken` at expected versus high) differ by more than the volume would explain, which is noise from a shared laptop.

Checks run on this branch: `pnpm lint` and `pnpm typecheck` with pnpm 10.30.1 (results in the hand-over). `package.json`, `pnpm-lock.yaml` and `pnpm-workspace.yaml` are byte-identical to `ws/tech-debt-ws3`.

## 9. Reproducing

```sh
git worktree add ../nabalens-techdebt-agents/ws3-baseline -b ws3/baseline ws/tech-debt-ws3
pnpm install --frozen-lockfile
export PERF_STACK=spare6                      # default; spare7, spare8 and the other workstream stacks work too
source /tmp/nabalens-ws/$PERF_STACK/env.sh   # local stack only; the scripts refuse any other target

sh tests/perf/run-db.sh current|expected|high 20 docs/perf/raw          # generate, EXPLAIN, app-function bench
node --import tsx tests/perf/media-bench.mjs                             # media processing, no database
pnpm exec next build && pnpm exec next start -p "$(node tests/perf/stack-config.mjs app-port)" -H 127.0.0.1 &   # for the rest
sh tests/perf/run-rest.sh current|expected|high docs/perf/raw           # refresh, delivery, TTFB, menu bench
node tests/perf/report.mjs --out tables.md                              # tables from docs/perf/raw
```

`tests/perf/generate.mjs --purge` removes all PERF rows. The generator writes with `session_replication_role = replica` as `postgres`; it never touches the fixture world, and refuses any target other than the API and database ports of the `PERF_STACK` workstream stack (`node tests/perf/stack-config.mjs` prints them; they come from `scripts/ci/stack.mjs`).
