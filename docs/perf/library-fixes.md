# Library performance fixes (WS3, baseline fixes 1, 3 and 4)

Branch `ws3/library`. Compared against `docs/perf/baseline.md` sections 5.1 and 7 (fixes 1, 3 and 4). Everything was measured on the local stack `spare7` with the harness in `tests/perf/` (`PERF_STACK=spare7`), the same generated volumes as the baseline (current 50 media, expected 75k, high 221k) plus one larger volume generated for this work: **500k media** (`tests/perf/generate.mjs` parameters venues 10, staff 100, admins 2, media 500,000, months 24, video_share 0.15, retired 11; 501,232 media assets with the fixtures). The 500k volume is generated, not extrapolated.

`before` is the code at `7be0acf` (`ws/tech-debt-ws3`, no migration) run on this same stack and volumes, one volume after the other. `after` is this branch with the migration applied by the official reset of spare7 from `ws3-library` at `58064ee` (Harness confirmed the sha256). There is no `before` column at 500k: the old code was not rerun there; the `REF library_assets` rows below call the old function directly (it still exists) in the same shapes and on the same data, and are the old numbers at 500k.

Migration `supabase/migrations/20261101100000_library_label_filters.sql`, sha256 `0812e6a4f1bd4fe106cefa311aabda0b8afee8416520f7acf7f317c0e9d13b0c`.

Raw files: `docs/perf/library-raw/{before,after}/<volume>/` (`db-paths.json`, `refresh-bench.json`, `library-bad-cases.json`, `ttfb.json`, `explain-library-page/*.txt`, `volume.json`). Every result file records the 1-minute load average at its start (tables below repeat it). The machine is a shared laptop: load averages were 4 to 14 during the runs (the 500k bad-case pass ended at 13.8 because another agent was building), so compare within a table, not across.

## Summary against the targets (high volume, 221k media; p95 ms, app function)

| Target                                                                                                         | Result                                                                                                                                                                                                                                                                                                               | Baseline                                                                                                       |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Fix 1: category, labelled, unlabelled, rare item, text search (match and no match), single venue: p95 ≤ 250 ms | category 24.2, venue + category 27.4, labelled 9.5, unlabelled 4.9, rare item 14, popular item 20.5, search `tikka` 110.4, `chicken` 76.8, `sunday` 76.9, no match 4.2, `tikka` + venue 85.9. **Met.**                                                                                                               | category 4,833, labelled 1,237, unlabelled 1,138, rare item 365, no-match search 8,007 (cancelled, 8/8 failed) |
| Fix 1: no sequential scan of `media_labels` or `media_label_items` in the page query                           | `EXPLAIN` of every library_page case at all four volumes: no seq scan of either table (`explain-library-page/`). The label-state helper scans `media_labels` in parallel as a hash join side by design (a set join, see below), and it is the whole-table read only when nothing matches. **Met** for the page query | seq scans of both in category, labelled, unlabelled, search                                                    |
| Fix 1: no 57014 at 500k                                                                                        | None in any admin case at 500k. Staff no-match search reaches 7.2 s p95 for `qz`, close to the 8 s limit (limits section). **Met for admins**                                                                                                                                                                        | no-match search cancelled at expected and high                                                                 |
| Fix 3: filter options p95 ≤ 150 ms (largest venue)                                                             | 68.7 at high, 43.2 at 500k. **Met**                                                                                                                                                                                                                                                                                  | 674 at high                                                                                                    |
| Fix 3: `/admin?venue=` complete time within 2x of the feed                                                     | 49.1 ms p50 at high and 56.8 at 500k, against 551 ms in the baseline. It is 2.3x and 2.5x the same page without a venue (21.2 and 22.7 ms), but 6x the feed query alone (8 ms): the page makes the filter-options reads on top. **Met against the page, not against the feed query alone**                           | 551 ms (91x the feed)                                                                                          |
| Fix 4: cursor page p95 ≤ 25 ms at any depth                                                                    | 9.5 (50%) and 10.4 (90%) at high; 10.1 and 8.8 at 500k; filtered feeds at most 8.3 at high. **Met**                                                                                                                                                                                                                  | 147 and 139 at high                                                                                            |
| Fix 4: refresh of 50 loaded pages ≤ 150 ms                                                                     | largest venue 270.7 p50 / 319.6 p95 at high, 219.5 / 227.8 at 500k; unfiltered 331 / 367 at high. **Not met**, see "Refresh of loaded pages"                                                                                                                                                                         | 285.8 / 307.2 (largest venue), 808 / 962 (unfiltered) at high                                                  |
| Security, RLS, library and privacy suites pass unchanged                                                       | Yes, see "Checks"                                                                                                                                                                                                                                                                                                    |                                                                                                                |

## What changed

| Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Where                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public.library_page(...)`: the admin library feed as one function that returns `setof media_assets` (`SECURITY INVOKER`, `search_path = ''`, EXECUTE for `authenticated` and `service_role` only). It builds one dynamic statement from fixed SQL fragments with values passed through `USING` (no user text is ever concatenated), compares the cursor as a row value `(created_at, id) < ($, $)` so the feed index starts at the cursor instead of at the newest row (fix 4), clamps the page size to 1..25, and escapes `%`, `_` and `\` in search text. RLS still applies to every row it returns because it runs as the caller.                                                                                                                                                                                                                                                                                                                                                                                         | migration, `lib/server/media/library.ts` (`listLibrary` makes every admin library page, filtered or not, one `library_page` call; the staff portfolio, `listOwnMedia`, keeps its own query) |
| Two strategies. **Id list**: for a filter that names label rows by index (item, variant, text, category, content type) the function first asks `private.library_candidate_ids` for the ids of the matching assets, up to `p_candidate_cap` (default 3,000, at most 20,000), and then reads those assets by primary key and sorts them. **Feed walk**: when more assets match than the cap, or the caller is staff, it walks `media_assets_ready_feed_idx` in order and tests each asset with `EXISTS` probes into indexed label tables, and stops after one page. Category and item filters hand the walk an array of menu item ids (`library_candidate_ids('category_items' / 'query_items')`) so each probe is an indexed `item_id = any(...)` lookup.                                                                                                                                                                                                                                                                      | migration                                                                                                                                                                                   |
| `private.library_candidate_ids(kind, item, variant, text, cap)`: `SECURITY DEFINER`, `search_path = ''`, admin only (returns null for staff, inactive admins and signed-out callers, and when more than `cap` rows match). It reads the label tables without per-row RLS, but returns only ids of **ready, non-deleted** assets for an **active admin**, which is exactly what the admin RLS on `media_labels` and `media_label_items` lets an admin read (`private.can_read_asset_labels`). The predicate is duplicated; the comment on `private.can_read_asset_labels` says to change both together and `tests/security/library-candidates.test.ts` fails when they drift (item, variant, note and menu text, category, content type, and the `query_items` and `category_items` menu item ids, compared with what the admin reads through RLS, including deleted, not-ready, other-venue and suggested-name fixtures; the label-state page is compared with the admin's own paged read of labelled and unlabelled assets). | migration, `tests/security/library-candidates.test.ts`                                                                                                                                      |
| `private.library_label_state_page(state, venue, staff, type, from, to, cursor, limit)`: the labelled and unlabelled filters are dense (most assets of a finished library are labelled; "unlabelled" can match few or none), so testing assets one at a time would read the whole feed to return an empty page. This helper, with the same admin-only definer rule, runs the semi-join or anti-join over `media_labels` as one set-based statement with the feed filters and the cursor, and returns only the page's ids; `library_page` reads those ids as the caller.                                                                                                                                                                                                                                                                                                                                                                                                                                                        | migration, same test file (page, cursor, venue and staff filter, null for inactive admin, staff and signed-out)                                                                             |
| Trigram and partial indexes: `pg_trgm` in schema `extensions`; GIN trigram indexes on `media_labels.note`, `media_label_items` item, variant and section names, `menu_entries` name and aliases (through `private.menu_aliases_search_text`) and open `menu_item_suggestions` names; partial btree `media_labels (asset_id) where has_labels`, GIN on `content_types`, and `(item_id, added_at desc, id desc)` and `(variant_id, ...)` indexes on `media_label_items` for the newest-label lookups.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | migration                                                                                                                                                                                   |
| `public.library_labelled_items(venue)` and `library_labelled_variants(venue)`: one `jsonb` document each with the ids and newest snapshot names of the labelled items of a venue (one row, so PostgREST `max_rows` cannot truncate it). Admin only, same rule (`tests/security/library-filters.test.ts` covers them, including a venue with more than 1,000 labelled items). They replace the embedded `media_label_items!inner` read of every menu item (fix 3).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | migration, `lib/server/media/library-labels.ts`                                                                                                                                             |
| Types regenerated from the integrated schema (both WS3 migrations applied) with `supabase gen types`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `lib/db/types.ts`                                                                                                                                                                           |

New index sizes with the high volume loaded (125,555 label rows, 180,682 label items): `media_label_items_item_added_idx` 16 MB, item-name trigram 10 MB, section-name trigram 6.3 MB, variant-name trigram 4.4 MB, `media_labels_note_trgm_idx` 5.3 MB, `media_labels_labelled_idx` 4.9 MB, `media_labels_content_types_idx` 3.2 MB, `menu_entries` name 5.4 MB and aliases 2.3 MB, the rest under 2 MB. About 60 MB for 221k media. Index builds in the migration are plain `CREATE INDEX` (a write lock on those tables while they build); on a production-size catalogue run the migration in a quiet window. `pg_trgm` is available on Supabase hosted projects (`create extension ... with schema extensions`).

No visibility rule changed. Equivalence was checked three ways:

- `tests/security/library-page.test.ts` compares `library_page` with `library_assets` (through RLS, as admin and as staff) for each filter and combination, with paging by cursor across equal timestamps, with hostile query text (`%`, `_`, a backslash, quotes, `'; drop table public.media_assets; --`, and labels whose own text contains `%_` and quotes), and on both strategies (the candidate cap forced to 0, which is always the feed walk, and to its default).
- `tests/security/library-candidates.test.ts` is the drift guard described above.
- `tests/integration/library.test.ts` and `tests/e2e/library.spec.ts`, `filters.spec.ts`, `menus-labels.spec.ts` exercise the same pages through the app.

## Results

Each cell is p50 / p95 in ms: wall time of the app function (`listLibrary` and friends, through PostgREST and RLS), 3 warm-ups then 20 timed runs, p95 by nearest rank. The db-bench labels some entries `library_assets`; they call `listLibrary`, which now calls `library_page`. A `failed` count means requests that returned an error (57014 statement timeout at 8 s).

### Current (50 media)

Load average at start of run: before 7.3 8.5 7.4, after 6.0 6.7 6.7.

| Path                                              | Before p50 / p95 ms | After p50 / p95 ms |
| ------------------------------------------------- | ------------------- | ------------------ |
| first page, no filter                             | 15.1 / 17.9         | 4.8 / 6.2          |
| cursor page at 50% depth                          | 4.4 / 6             | 4.8 / 5.2          |
| cursor page at 90% depth                          | 4.4 / 5.4           | 4.3 / 4.8          |
| venue filter (largest)                            | 3.8 / 4.6           | 4.3 / 5.2          |
| venue (largest), cursor at 90%                    | 2.6 / 2.9           | 3.2 / 3.7          |
| staff filter (heaviest uploader)                  | 3.6 / 4.5           | 3.6 / 4.6          |
| type = video                                      | 3.6 / 4.2           | 3.7 / 4.3          |
| category = curries                                | 329.1 / 375.4       | 6.3 / 10.6         |
| category = curries, cursor at 50%                 | 12.3 / 14.7         | 5.8 / 7.4          |
| venue (largest) + category                        | 4.5 / 5.1           | 6.9 / 9            |
| item filter, popular item                         | 3.5 / 4.3           | 4.1 / 6.2          |
| item filter, rare item                            | 4.4 / 5.4           | 4.5 / 5.4          |
| item + variant filter                             | 3.8 / 4.2           | 4.2 / 6.7          |
| content type = dish                               | 6.3 / 7.1           | 5.7 / 7.4          |
| labels = labelled                                 | 19.9 / 22.5         | 4.9 / 6.3          |
| labels = unlabelled                               | 8 / 8.8             | 4.9 / 5.8          |
| search q=tikka                                    | 388.9 / 428.6       | 7 / 7.7            |
| search q=chicken (very common)                    | 369.3 / 405.3       | 7.7 / 8.3          |
| search q=sunday (notes)                           | 370.7 / 407.1       | 2.4 / 3            |
| search q=zzzqq (no match)                         | 368.3 / 387.7       | 2.2 / 2.5          |
| search q=tikka + venue (largest)                  | 7.2 / 9.2           | 5 / 5.7            |
| filter options, venue (largest)                   | 68.3 / 72.1         | 30.2 / 36.1        |
| filter options, venue (smallest)                  | 35.3 / 37.4         | 15.7 / 18.1        |
| staff: portfolio first page (heaviest, 24 assets) | 4 / 4.7             | 4.6 / 6.7          |
| staff: portfolio cursor 90% (heaviest)            | 2.8 / 5             | 2.9 / 3.3          |
| staff: portfolio first page (median, 7 assets)    | 3.1 / 4             | 3.4 / 4.5          |
| staff: getLabellingCatalogue (staff, own venue)   | 106 / 135.6         | 9.3 / 10.5         |
| staff: getAssetLabelContext (10 assets, staff)    | 3.6 / 5.9           | 2.9 / 3.3          |

### Expected (75,050 media)

Load average at start of run: before 6.4 5.5 5.8, after 7.4 6.9 6.8.

| Path                                                | Before p50 / p95 ms        | After p50 / p95 ms |
| --------------------------------------------------- | -------------------------- | ------------------ |
| first page, no filter                               | 14.1 / 17.6                | 5.4 / 8            |
| cursor page at 50% depth                            | 26 / 29.7                  | 4.8 / 6            |
| cursor page at 90% depth                            | 44.2 / 53.2                | 4.3 / 5.4          |
| venue filter (largest)                              | 5 / 8.3                    | 4.2 / 4.7          |
| venue (largest), cursor at 90%                      | 9.8 / 11.8                 | 4.2 / 4.6          |
| staff filter (heaviest uploader)                    | 5.3 / 6.5                  | 4.2 / 4.6          |
| type = video                                        | 6 / 7.3                    | 3.6 / 4            |
| category = curries                                  | 1,649 / 1,952              | 13.2 / 14.5        |
| category = curries, cursor at 50%                   | 1,687 / 1,993              | 11 / 11.8          |
| venue (largest) + category                          | 2,002 / 2,555              | 10.1 / 11          |
| item filter, popular item                           | 17.1 / 24.6                | 13.5 / 14.5        |
| item filter, rare item                              | 106.5 / 125.3              | 3.9 / 4.4          |
| item + variant filter                               | 39.5 / 57.5                | 6.4 / 7.3          |
| content type = dish                                 | 6.7 / 11.1                 | 5 / 5.4            |
| labels = labelled                                   | 428.7 / 500.3              | 4.4 / 4.9          |
| labels = unlabelled                                 | 453.5 / 532.4              | 3.8 / 4.5          |
| search q=tikka                                      | 397.2 / 477.9              | 72.4 / 74.4        |
| search q=chicken (very common)                      | 497.9 / 686.1              | 53.3 / 57.4        |
| search q=sunday (notes)                             | 747.3 / 1,380              | 15.1 / 16          |
| search q=zzzqq (no match)                           | 8,008 / 8,017 (8/8 failed) | 2.3 / 2.7          |
| search q=tikka + venue (largest)                    | 50.9 / 64.9                | 44.3 / 46.1        |
| filter options, venue (largest)                     | 358.2 / 436.8              | 41 / 49            |
| filter options, venue (smallest)                    | 71.3 / 82.3                | 20.1 / 25.3        |
| staff: portfolio first page (heaviest, 7040 assets) | 5.9 / 8.2                  | 4.2 / 6.3          |
| staff: portfolio cursor 90% (heaviest)              | 12.4 / 18                  | 5.7 / 7.5          |
| staff: portfolio first page (median, 887 assets)    | 5.4 / 9.1                  | 4.2 / 5.3          |
| staff: getLabellingCatalogue (staff, own venue)     | 97.3 / 124.6               | 9 / 11.9           |
| staff: getAssetLabelContext (10 assets, staff)      | 4.9 / 6.9                  | 4.2 / 5.1          |

### High (221,150 media)

Load average at start of run: before 5.6 7.6 7.6, after 8.7 7.3 6.9.

| Path                                                 | Before p50 / p95 ms        | After p50 / p95 ms |
| ---------------------------------------------------- | -------------------------- | ------------------ |
| first page, no filter                                | 19.1 / 24.8                | 9 / 13.3           |
| cursor page at 50% depth                             | 94.6 / 147.1               | 8.1 / 9.5          |
| cursor page at 90% depth                             | 108.9 / 139.2              | 7.7 / 10.4         |
| venue filter (largest)                               | 5.6 / 6.6                  | 6.3 / 8            |
| venue (largest), cursor at 90%                       | 44.4 / 47.5                | 7.3 / 8.3          |
| staff filter (heaviest uploader)                     | 6.7 / 9.3                  | 6.3 / 7.8          |
| type = video                                         | 4.8 / 6.3                  | 6.3 / 8            |
| category = curries                                   | 3,684 / 4,833              | 19.5 / 24.2        |
| category = curries, cursor at 50%                    | 3,792 / 4,727              | 15.6 / 23.2        |
| venue (largest) + category                           | 3,667 / 4,504              | 15.2 / 27.4        |
| item filter, popular item                            | 12.3 / 13.2                | 17.5 / 20.5        |
| item filter, rare item                               | 326.9 / 365.4              | 7.3 / 14           |
| item + variant filter                                | 37.5 / 41.3                | 12.5 / 16          |
| content type = dish                                  | 6.8 / 8.2                  | 9.4 / 11.8         |
| labels = labelled                                    | 1,142 / 1,237              | 5.8 / 9.5          |
| labels = unlabelled                                  | 1,106 / 1,138              | 4.2 / 4.9          |
| search q=tikka                                       | 105 / 107.4                | 88 / 110.4         |
| search q=chicken (very common)                       | 130.1 / 146                | 68.2 / 76.8        |
| search q=sunday (notes)                              | 292.9 / 300.2              | 72.5 / 76.9        |
| search q=zzzqq (no match)                            | 8,007 / 8,007 (8/8 failed) | 3 / 4.2            |
| search q=tikka + venue (largest)                     | 51.9 / 55.3                | 67.6 / 85.9        |
| filter options, venue (largest)                      | 630.1 / 674.3              | 43.8 / 68.7        |
| filter options, venue (smallest)                     | 89.5 / 96                  | 16.5 / 25.1        |
| staff: portfolio first page (heaviest, 15611 assets) | 5 / 6.2                    | 4.4 / 5.2          |
| staff: portfolio cursor 90% (heaviest)               | 12.4 / 15.7                | 16.7 / 24.3        |
| staff: portfolio first page (median, 1454 assets)    | 4.9 / 6                    | 6 / 9.3            |
| staff: getLabellingCatalogue (staff, own venue)      | 90.9 / 109.2               | 10.4 / 16.4        |
| staff: getAssetLabelContext (10 assets, staff)       | 4.9 / 5.8                  | 4.4 / 5.7          |

### 500k media

Load average at start of run: before n/a, after 6.5 7.2 7.0.

| Path                                                 | Before p50 / p95 ms | After p50 / p95 ms |
| ---------------------------------------------------- | ------------------- | ------------------ |
| first page, no filter                                | n/a                 | 11.8 / 16.3        |
| cursor page at 50% depth                             | n/a                 | 7.8 / 10.1         |
| cursor page at 90% depth                             | n/a                 | 7.2 / 8.8          |
| venue filter (largest)                               | n/a                 | 8.6 / 10.4         |
| venue (largest), cursor at 90%                       | n/a                 | 6.1 / 8            |
| staff filter (heaviest uploader)                     | n/a                 | 4.7 / 6            |
| type = video                                         | n/a                 | 4.2 / 5.1          |
| category = curries                                   | n/a                 | 17.1 / 20.5        |
| category = curries, cursor at 50%                    | n/a                 | 13.1 / 14.4        |
| venue (largest) + category                           | n/a                 | 12.6 / 14.7        |
| item filter, popular item                            | n/a                 | 11.9 / 13.3        |
| item filter, rare item                               | n/a                 | 5.8 / 6.3          |
| item + variant filter                                | n/a                 | 8.4 / 9.5          |
| content type = dish                                  | n/a                 | 5.9 / 7.2          |
| labels = labelled                                    | n/a                 | 13.4 / 15.7        |
| labels = unlabelled                                  | n/a                 | 4.7 / 5.1          |
| search q=tikka                                       | n/a                 | 97.2 / 117.4       |
| search q=chicken (very common)                       | n/a                 | 74.1 / 77.9        |
| search q=sunday (notes)                              | n/a                 | 89.5 / 92.6        |
| search q=zzzqq (no match)                            | n/a                 | 2.6 / 3.7          |
| search q=tikka + venue (largest)                     | n/a                 | 32.2 / 48.1        |
| filter options, venue (largest)                      | n/a                 | 41.6 / 43.2        |
| filter options, venue (smallest)                     | n/a                 | 18.1 / 30.4        |
| staff: portfolio first page (heaviest, 35972 assets) | n/a                 | 5.1 / 6.1          |
| staff: portfolio cursor 90% (heaviest)               | n/a                 | 46.5 / 58.1        |
| staff: portfolio first page (median, 3370 assets)    | n/a                 | 6.6 / 7.7          |
| staff: getLabellingCatalogue (staff, own venue)      | n/a                 | 13.2 / 15.7        |
| staff: getAssetLabelContext (10 assets, staff)       | n/a                 | 5.2 / 6.4          |

### Refresh of loaded pages and concurrent admins

The foreground refresh (every 15 s) re-reads all loaded pages one after another. `Pages` is how many pages are loaded; each page is 4 HTTP requests (the page and 3 label-summary reads). Before and after at the volumes where both exist; the before k = 20 cell at high looks low against its neighbours (118.6 p50 with a 282 p95): the before run was noisy, so read the trend, not that cell.

| Volume                  | Feed            | Pages | Before        | After         |
| ----------------------- | --------------- | ----- | ------------- | ------------- |
| Current (50 media)      | unfiltered feed | 1     | 14.7 / 15.2   | 5.9 / 6.3     |
| Current (50 media)      | unfiltered feed | 5     | 81.8 / 91.3   | 22.9 / 23.5   |
| Current (50 media)      | unfiltered feed | 20    | 217.7 / 267.1 | 162.8 / 167.1 |
| Current (50 media)      | unfiltered feed | 50    | 200.3 / 218.7 | 202.9 / 221.3 |
| Current (50 media)      | largest venue   | 1     | 4 / 4.2       | 4.4 / 6       |
| Current (50 media)      | largest venue   | 5     | 8.2 / 10.2    | 8.1 / 8.5     |
| Current (50 media)      | largest venue   | 20    | 8.7 / 9.8     | 7.8 / 8.5     |
| Current (50 media)      | largest venue   | 50    | 13.4 / 13.6   | 7.3 / 7.7     |
| Expected (75,050 media) | unfiltered feed | 1     | 16.4 / 19.6   | 5.6 / 6.5     |
| Expected (75,050 media) | unfiltered feed | 5     | 92.7 / 103.9  | 24.2 / 25     |
| Expected (75,050 media) | unfiltered feed | 20    | 230.1 / 255.5 | 165.8 / 221.5 |
| Expected (75,050 media) | unfiltered feed | 50    | 452.9 / 562.3 | 318 / 395.4   |
| Expected (75,050 media) | largest venue   | 1     | 8.2 / 8.9     | 4.8 / 5       |
| Expected (75,050 media) | largest venue   | 5     | 40.4 / 42.4   | 27.7 / 29.7   |
| Expected (75,050 media) | largest venue   | 20    | 167.6 / 190.1 | 133.4 / 161.1 |
| Expected (75,050 media) | largest venue   | 50    | 385.2 / 445   | 409 / 515.1   |
| High (221,150 media)    | unfiltered feed | 1     | 18.5 / 20.4   | 7.6 / 10.2    |
| High (221,150 media)    | unfiltered feed | 5     | 51.7 / 55.3   | 30.6 / 31.9   |
| High (221,150 media)    | unfiltered feed | 20    | 118.6 / 282.3 | 233.5 / 267.8 |
| High (221,150 media)    | unfiltered feed | 50    | 808.2 / 962.5 | 331 / 367.1   |
| High (221,150 media)    | largest venue   | 1     | 9.7 / 18.3    | 5.3 / 6       |
| High (221,150 media)    | largest venue   | 5     | 39.3 / 48.1   | 25.7 / 27.2   |
| High (221,150 media)    | largest venue   | 20    | 137 / 147.2   | 171 / 202.7   |
| High (221,150 media)    | largest venue   | 50    | 285.8 / 307.2 | 270.7 / 319.6 |
| 500k media              | unfiltered feed | 1     | n/a           | 9.5 / 11.3    |
| 500k media              | unfiltered feed | 5     | n/a           | 44.7 / 50.1   |
| 500k media              | unfiltered feed | 20    | n/a           | 99.6 / 108.7  |
| 500k media              | unfiltered feed | 50    | n/a           | 256.4 / 259.7 |
| 500k media              | largest venue   | 1     | n/a           | 4.5 / 4.6     |
| 500k media              | largest venue   | 5     | n/a           | 20.5 / 24.1   |
| 500k media              | largest venue   | 20    | n/a           | 83.9 / 86.3   |
| 500k media              | largest venue   | 50    | n/a           | 219.5 / 227.8 |

### Concurrent admins on the same filter (ms p50 / p95 of one request)

| Volume                  | Filter             | Admins | Before        | After       |
| ----------------------- | ------------------ | ------ | ------------- | ----------- |
| Current (50 media)      | first page         | 1      | 14.6 / 16.9   | 4.2 / 7     |
| Current (50 media)      | first page         | 4      | 17.6 / 24.4   | 6.4 / 9.7   |
| Current (50 media)      | first page         | 8      | 23.3 / 27.6   | 9.8 / 11.4  |
| Current (50 media)      | category = curries | 1      | 331.5 / 344.6 | 6.9 / 7.3   |
| Current (50 media)      | category = curries | 4      | 348.2 / 353.8 | 9 / 11.9    |
| Current (50 media)      | category = curries | 8      | 369.2 / 407.5 | 11.3 / 16   |
| Current (50 media)      | labels = labelled  | 1      | 20.7 / 21.2   | 6.4 / 6.7   |
| Current (50 media)      | labels = labelled  | 4      | 25.3 / 27.8   | 6.7 / 7.3   |
| Current (50 media)      | labels = labelled  | 8      | 30.8 / 33.4   | 8.8 / 10.3  |
| Expected (75,050 media) | first page         | 1      | 15.5 / 22.5   | 6.8 / 8     |
| Expected (75,050 media) | first page         | 4      | 20.7 / 27.4   | 10.9 / 14.1 |
| Expected (75,050 media) | first page         | 8      | 23.3 / 35.7   | 12 / 24.3   |
| Expected (75,050 media) | category = curries | 1      | 2,561 / 2,628 | 18.3 / 35.8 |
| Expected (75,050 media) | category = curries | 4      | 2,232 / 2,460 | 20.4 / 21.6 |
| Expected (75,050 media) | category = curries | 8      | 2,130 / 2,308 | 22.4 / 26.2 |
| Expected (75,050 media) | labels = labelled  | 1      | 456.3 / 540.9 | 9.5 / 10.8  |
| Expected (75,050 media) | labels = labelled  | 4      | 537.2 / 557   | 10 / 11.8   |
| Expected (75,050 media) | labels = labelled  | 8      | 529.7 / 549.8 | 14.4 / 18.8 |
| High (221,150 media)    | first page         | 1      | 17.3 / 20.9   | 4.6 / 5.4   |
| High (221,150 media)    | first page         | 4      | 25.5 / 30.1   | 6.4 / 8.3   |
| High (221,150 media)    | first page         | 8      | 29.1 / 34.4   | 10.4 / 16.2 |
| High (221,150 media)    | category = curries | 1      | 3,619 / 3,831 | 16.2 / 17.2 |
| High (221,150 media)    | category = curries | 4      | 3,996 / 4,086 | 17.2 / 17.7 |
| High (221,150 media)    | category = curries | 8      | 5,046 / 6,139 | 19.6 / 20.8 |
| High (221,150 media)    | labels = labelled  | 1      | 1,168 / 1,180 | 4.9 / 5     |
| High (221,150 media)    | labels = labelled  | 4      | 1,341 / 1,350 | 6.4 / 7     |
| High (221,150 media)    | labels = labelled  | 8      | 1,357 / 1,410 | 9.4 / 11.7  |
| 500k media              | first page         | 1      | n/a           | 7.5 / 8.9   |
| 500k media              | first page         | 4      | n/a           | 9.4 / 11.2  |
| 500k media              | first page         | 8      | n/a           | 13.4 / 16.8 |
| 500k media              | category = curries | 1      | n/a           | 15.4 / 16.3 |
| 500k media              | category = curries | 4      | n/a           | 19.3 / 21.1 |
| 500k media              | category = curries | 8      | n/a           | 42.7 / 49   |
| 500k media              | labels = labelled  | 1      | n/a           | 19.8 / 27.7 |
| 500k media              | labels = labelled  | 4      | n/a           | 18.7 / 20.3 |
| 500k media              | labels = labelled  | 8      | n/a           | 22.9 / 29.6 |

### Worst cases (DB-side p50 / p95 ms, run inside the database as the signed-in role)

`REF library_assets` rows call the old function directly in the same shape, for comparison. The shapes are built inside rolled-back transactions by `tests/perf/library-bad-cases.mjs`; staff rows run as the heaviest staff member. n = 20 unless an old-function case took more than 2 s (n = 4).

| Case                                                            | Current (50 media) | Expected (75,050 media) | High (221,150 media) | 500k media    |
| --------------------------------------------------------------- | ------------------ | ----------------------- | -------------------- | ------------- |
| admin category (natural)                                        | 0.8 / 1            | 7.2 / 9.1               | 7.6 / 8.4            | 8.2 / 9.4     |
| admin category, cursor 90% of matches                           | 0.7 / 0.9          | 4.2 / 4.7               | 2.8 / 3              | 4.3 / 4.7     |
| admin labelled (natural, 56% labelled)                          | 0.3 / 0.3          | 0.2 / 0.3               | 0.2 / 0.3            | 0.3 / 0.3     |
| admin labelled, cursor 90% of matches                           | 0.3 / 0.3          | 0.3 / 0.4               | 0.3 / 0.3            | 0.3 / 0.3     |
| admin labelled, only 200 assets labelled                        | 0.3 / 0.3          | 1.9 / 2.5               | 3.7 / 4.2            | 29.3 / 38.2   |
| admin labelled, only the oldest 5000 labelled                   | 0.3 / 0.3          | 38.4 / 48.1             | 155.3 / 174.7        | 181.3 / 228.1 |
| admin labelled, nothing labelled                                | 0.2 / 0.2          | 10.5 / 12.5             | 25.5 / 28.7          | 72.2 / 77.5   |
| admin unlabelled (natural)                                      | 0.3 / 0.3          | 0.3 / 0.4               | 0.3 / 0.3            | 0.3 / 0.3     |
| admin unlabelled, only the oldest 5000 unlabelled               | 0.3 / 0.3          | 64.2 / 67               | 97.2 / 114.3         | 222.6 / 235.7 |
| admin unlabelled, nothing unlabelled                            | 0.2 / 0.3          | 13.7 / 14.7             | 35.9 / 42.7          | 112.1 / 170.7 |
| admin unlabelled, nothing unlabelled, in the largest venue      | 0.2 / 0.3          | 13.1 / 14.4             | 27.6 / 35.8          | 54.9 / 60.6   |
| REF library_assets: labelled (natural)                          | 3.9 / 4            | 0.4 / 0.5               | 873.6 / 1,054        | 2,301 / 2,832 |
| REF library_assets: labelled, only the oldest 5000 labelled     | 3.8 / 3.9          | 77.1 / 100.6            | 174.2 / 209.7        | 882.7 / 1,404 |
| REF library_assets: labelled, nothing labelled                  | 0.1 / 0.1          | 62.6 / 78.9             | 171.4 / 199.4        | 610.3 / 667.6 |
| REF library_assets: unlabelled (natural)                        | 3.8 / 4            | 306.7 / 361.1           | 897.7 / 1,127        | 2,063 / 2,138 |
| REF library_assets: unlabelled, only the oldest 5000 unlabelled | 4 / 4.1            | 709.7 / 885.1           | 1,852 / 2,238        | 4,795 / 4,923 |
| REF library_assets: unlabelled, nothing unlabelled              | 9.3 / 9.5          | 675 / 832.5             | 1,777 / 2,482        | 4,511 / 5,228 |
| admin search 'a' (1 char, matches nearly all)                   | 9.7 / 10.2         | 28.4 / 34.8             | 26.9 / 48.9          | 47.2 / 87     |
| admin search 'q' (1 char)                                       | 12.3 / 13.4        | 132 / 148.1             | 171.2 / 194.5        | 254.3 / 282.2 |
| admin search 'ch' (2 chars, common)                             | 11.5 / 11.9        | 126.6 / 155.3           | 102.4 / 105.9        | 113.1 / 154.7 |
| admin search 'qz' (2 chars, no match)                           | 11.8 / 12.1        | 99.2 / 137.9            | 151.3 / 155.3        | 419.2 / 464.7 |
| admin search 'zzzqq' (no match)                                 | 0.5 / 0.5          | 1.6 / 2.1               | 0.5 / 0.5            | 1.4 / 1.5     |
| admin search 'tikka', cursor 90% of matches                     | 1 / 1              | 21.7 / 24.3             | 19 / 19.3            | 14.7 / 32.9   |
| admin search 'tikka' in the largest venue                       | 1 / 1.8            | 43.9 / 46.4             | 49.3 / 51.8          | 25.7 / 50     |
| admin 'qz' (2 chars) in the largest venue                       | 11.8 / 12          | 96.3 / 108.2            | 150.4 / 155.2        | 434.2 / 573   |
| staff category (library_page)                                   | 1.6 / 1.7          | 11 / 15.4               | 8.7 / 11.6           | 11.2 / 17.3   |
| staff category (library_assets, reference)                      | 2.2 / 2.4          | 70.8 / 91.8             | 177.5 / 222.8        | 470 / 543.1   |
| staff search 'tikka' (library_page)                             | 1.9 / 2.1          | 22.3 / 40               | 16.6 / 22.8          | 13 / 16.4     |
| staff search 'tikka' (library_assets, reference)                | 36.3 / 36.8        | 812.4 / 942.2           | 2,177 / 2,321        | 5,001 / 5,490 |
| staff search 'zzzqq' no match (library_page)                    | 1.8 / 2            | 237 / 285.1             | 585.5 / 752.4        | 1,859 / 2,106 |
| staff search 'zzzqq' no match (library_assets, reference)       | 36.6 / 39          | 779.1 / 887.3           | 2,153 / 2,197        | 5,482 / 5,552 |
| staff 'qz' 2 chars (library_page)                               | 1.9 / 1.9          | 246.4 / 313.1           | 537.3 / 553.5        | 2,641 / 7,193 |
| staff content dish (library_page)                               | 0.5 / 0.7          | 1.3 / 2.6               | 1 / 1.1              | 0.9 / 1.4     |
| staff labelled (library_page)                                   | 0.5 / 0.6          | 0.8 / 1.2               | 0.8 / 1.1            | 0.9 / 1.2     |
| staff unlabelled (library_page)                                 | 0.5 / 0.5          | 1.3 / 2.4               | 0.7 / 0.9            | 1.2 / 1.4     |
| staff, lightest, search 'zzzqq' (library_page)                  | 0.4 / 0.4          | 43.1 / 47.7             | 102.8 / 141.9        | 507 / 666.9   |

### Pages from `next start` (`ttfb-bench`), complete time p50 / p95 ms

Production build of this branch (`next start`, port 3647) against spare7; 3 warm-ups and 20 timed requests per route; load average at start 8.5 (high) and 8.4 (500k). The baseline column is copied from `docs/perf/baseline.md` section 5.5 (stack spare6, other code), so it is a reference, not a same-stack before. HTML sizes differ from the baseline too (this branch includes the Menus and Media merges and the fixture world is larger), which is why `/admin` itself went from 10.6 to 21.2 ms: that page is not a library_page cost (the function call is 5 to 9 ms), I did not isolate the rest.

| Route                                  | Baseline high (`baseline.md`, spare6) | After, high   | After, 500k   |
| -------------------------------------- | ------------------------------------- | ------------- | ------------- |
| admin library /admin                   | 10.6 / 11.9                           | 21.2 / 28.6   | 22.7 / 35     |
| admin library, largest venue           | 551 / 582.8                           | 49.1 / 55.9   | 56.8 / 68     |
| admin library, category filter         | 3,125 / 3,491                         | 24 / 26.5     | 30 / 38.6     |
| admin library, venue + category filter | 3,494 / 3,713                         | 60.9 / 69.1   | 58.2 / 70.3   |
| admin library, search q=tikka          | 24.6 / 30.2                           | 117.8 / 123.3 | 118.2 / 134.3 |
| admin staff member (heaviest)          | 34.1 / 38.9                           | 27.5 / 30.7   | 27.8 / 31.8   |
| staff portfolio (heaviest)             | 17.2 / 22                             | 10.7 / 13.2   | 11.8 / 13.9   |
| staff portfolio (median)               | 12.6 / 16.7                           | 11.5 / 15     | 13.2 / 16.4   |
| JSON /api/library                      | 14.7 / 17.8                           | 12.3 / 13.3   | 14.9 / 16.6   |

`/admin?q=tikka` is slower than the baseline figure (24.6 ms at high in `baseline.md`; 117.8 ms here). It is not a regression of the function: the same app function measured 105 / 107 ms before and 88 / 110 ms after on spare7, so the 17 to 25 ms in the baseline run was not reproduced on this stack with the old code either (the old function takes seconds in other shapes of the same search, and I did not find what made the baseline run fast). The search is about 100 ms because `tikka` is common in the generated data: the planner reads up to 3,000 candidate ids and the feed walk probes about 760 assets before it has 25 rows (`explain-library-page/admin-search-tikka.txt`: 57 ms in the database at high, 91 ms at 500k).

## EXPLAIN (ANALYZE, BUFFERS)

`tests/perf/library-explain.mjs` runs each case as the signed-in role (a rolled-back copy of `library_page` whose dynamic statement is wrapped in `EXPLAIN`), plus the label-state statement in its natural shape and in two shapes built inside a rolled-back transaction. Files: `docs/perf/library-raw/after/<volume>/explain-library-page/*.txt`, at all four volumes. Execution time in ms, single warm run:

| Case                                | current | expected |    high |    500k | Plan (high)                                                                                           |
| ----------------------------------- | ------: | -------: | ------: | ------: | ----------------------------------------------------------------------------------------------------- |
| admin-category-curries              |   0.164 |    7.953 |   8.724 |   9.921 | feed index walk, `item_id = any(...)` probes into `media_label_items_tuple_key`                       |
| admin-category-curries-cursor-50pct |   0.103 |    5.218 |   4.414 |   6.909 |                                                                                                       |
| admin-venue-category                |   0.101 |    4.155 |   3.423 |   4.259 |                                                                                                       |
| admin-labelled                      |   0.179 |    0.269 |   0.247 |   0.305 | label-state helper statement is separate; page reads ids by primary key                               |
| admin-unlabelled                    |   0.160 |    0.247 |   0.254 |   0.291 |                                                                                                       |
| admin-item-rare                     |   0.085 |    0.112 |   0.133 |   0.185 |                                                                                                       |
| admin-item-popular                  |   0.096 |    0.518 |   0.651 |  11.911 |                                                                                                       |
| admin-content-dish                  |   0.229 |    1.268 |   0.891 |   2.329 |                                                                                                       |
| admin-search-tikka                  |   0.195 |   80.885 |  57.308 |  90.787 | feed index walk, probes into `media_labels_asset_venue_key` and `media_label_items_tuple_key`         |
| admin-search-chicken                |   0.151 |   56.495 |  44.956 |  60.659 |                                                                                                       |
| admin-search-nomatch                |   0.017 |    0.024 |   0.021 |   0.017 |                                                                                                       |
| admin-feed-cursor-90pct             |   0.356 |    0.580 |   0.399 |   0.405 | `Index Cond: ROW(created_at, id) < ROW(...)` on `media_assets_ready_feed_idx`                         |
| staff-heaviest-category             |   2.012 |   13.045 |  12.263 |  18.924 |                                                                                                       |
| staff-heaviest-search-tikka         |   2.347 |   28.603 |  20.697 |  23.900 |                                                                                                       |
| state-unlabelled-natural            |   0.237 |    0.272 |   0.222 |   0.956 | nested loop anti join, feed index with `media_labels_labelled_idx` probes                             |
| state-labelled-natural              |   0.083 |    0.117 |   0.094 |   0.121 | nested loop semi join, same indexes                                                                   |
| state-unlabelled-none-unlabelled    |   0.182 |   16.525 |  44.890 | 217.113 | parallel hash anti join: feed index only scan against a seq scan of `media_labels` where `has_labels` |
| state-unlabelled-oldest-5000        |   0.064 |   81.214 | 120.815 | 118.486 |                                                                                                       |

The page statements read no label table sequentially at any volume (the bench prints `seq: -` for every library_page case; the one other entry is a seq scan of the small `menu_item_suggestions` table in the staff text search). Seq scans of label tables appear only in the helper statements, and only where the planner prefers them: `state-unlabelled-none-unlabelled` (parallel hash anti join, 45 ms at high and 217 ms at 500k, the case it exists for), `state-unlabelled-oldest-5000` at 500k, and the candidate lookups `candidates-category` (500k, stops after 3,001 matches) and `candidates-search-nomatch` (50 media only).

## Known limits

- **Label-state filters in unusual shapes (fixed in this branch).** The first version walked the feed for "unlabelled" and read the whole library when nothing matched (2.0 s at 221k, 6.6 s at 500k for the only-oldest-5,000-unlabelled shape). The label-state helper replaced it. The worst shapes at 500k are now: unlabelled with nothing unlabelled 112 / 171 ms (60.6 in the largest venue), unlabelled with only the oldest 5,000 unlabelled 223 / 236 ms, labelled with only the oldest 5,000 labelled 181 / 228 ms, labelled with nothing labelled 72 / 78 ms. In each shape the old `library_assets` (the `REF` rows) is 6 to 30 times slower: 5.2 s, 4.9 s, 1.4 s and 0.67 s at 500k. The cost of the set-based plan grows with the label table, not with the shape: about 217 ms for a whole-table anti join at 500k, roughly linear (45 ms at high), so by extrapolation it would reach 1 s at about 2 million assets.
- **Staff with a text search that matches nothing.** The staff walk tests assets one at a time at about 170 µs each. Staff `zzzqq` (no match) at 500k: 1,859 / 2,106 ms (n = 4), against 5,482 / 5,552 ms for the old `library_assets`; a staff member with a few assets hits the same cost per asset of the whole feed they can see (lightest staff 507 / 667 ms). Staff `qz` (2 characters, no match): 2,641 / 7,193 ms at 500k (n = 4) and 537 / 554 ms at high; an earlier dev run at higher load reached 8.1 s, so this case is within noise of the 8 s API limit at 500k. The old function was already worse in this shape (5.5 s for no-match at 500k in this run; in an earlier dev run at higher load the old staff category filter reached the 8 s limit at 500k). **The app does not call this path as staff** (the staff portfolio uses `listOwnMedia`, which has no text search), so the limit is reported, not fixed. No staff category, content, labelled or unlabelled filter is affected (1 to 17 ms).
- **Admin search with 1 or 2 characters.** `a` 47 / 87 ms, `q` 254 / 282 ms, `ch` 113 / 155 ms, `qz` 419 / 465 ms (573 ms in the largest venue) at 500k. A trigram index cannot help with fewer than 3 characters, so the walk tests assets one at a time; all are under the 8 s limit with margin and under 1 s. A minimum search length of 3 would remove the cost; no minimum was added (product decision for the orchestrator's PR notes).
- **Refresh of 50 loaded pages (target not met).** At high the largest venue takes 270.7 ms p50 / 319.6 p95 and the unfiltered feed 331 / 367 ms; at 500k 219.5 / 227.8 and 256.4 / 259.7. Cost breakdown: a refresh reads k pages one after another, 4 requests each (the page and 3 label-summary reads), so 50 pages are 200 sequential requests at about 1.4 ms each (about 5.4 ms per page) through PostgREST, RLS and the app. The page query itself is under 1 ms at any depth (`admin-feed-cursor-90pct`: 0.4 ms at high); the remainder is the 3 label-summary reads and the request overhead of each page. The cursor fix therefore helped deep pages in the database (111 to 7 ms for a 90%-depth page) but cannot bring 200 sequential requests under 150 ms. The change that would is outside this branch's files: read the pages concurrently, or batch the label summaries of all loaded pages into one request per refresh. Left as a follow-up.
- **Staff portfolio cursor.** `listOwnMedia` keeps the `or(created_at.lt, and(created_at.eq, id.lt))` form, which PostgREST cannot express as a row value. For the heaviest staff member (35,972 assets at 500k) the page at 90% depth takes 46.5 / 58.1 ms at 500k and 16.7 / 24.3 ms at high (12.4 / 15.7 before at high). It is not the admin library cursor the fix targets, and the 25 ms target holds for the admin feed and for the portfolio at high; reported as an observation.
- **Concurrency.** 8 admins on the same filter at once (`concurrent` rows): 16.8 ms p95 first page, 49 ms category (high 20.8), 29.6 ms labelled at 500k, no failures.
- **Not measured.** Hosted Supabase (pooler, network latency per request: the 200-request refresh will cost more there), real browsers, and a 500k volume with a different label mix. Text search uses the generated notes and names (short, repetitive), so real wording could shift the 3,000-candidate cap between the two strategies; both are fast (id list: a few ms, walk: 50 to 120 ms for the most common words).
- **spare7 settings.** `shared_buffers` 128 MB, `work_mem` 4 MB, API roles' `statement_timeout` 8 s. The 500k volume does not fit in `shared_buffers`; the first run of a case after a reload is colder than the table values (3 warm-ups are discarded).

## Checks

All on the final branch state (library code at `58064ee`, types regenerated at `9f547b9`), exit code 0 unless noted.

- `pnpm lint` 0; `pnpm typecheck` 0.
- `pnpm test` (unit): 63 files, 636 tests passed.
- `pnpm test:security /tmp/nabalens-ws/spare7`: 16 files, 292 tests passed (includes `library-page` 6, `library-candidates` 11, `library-filters` 15).
- `pnpm test:integration`: 19 files passed, 1 skipped; 206 tests passed, 13 skipped. The 13 skips are `privacy-bundle.test.ts` "finds nothing in this checkout's build" (skipped when `.next/static` does not exist; with the build present it runs 3/3) and the 12 tests of `privacy-runtime.test.ts` (`describe.skipIf(!BASE)`). No library test skips itself.
- Playwright (chromium) `library.spec.ts`, `filters.spec.ts`, `menus-labels.spec.ts`: 10 passed.
- With the **high volume loaded** (222,008 media): `library-filters` 15/15, `library-page` 6/6, `library-candidates` 11/11 passed. `tests/integration/library.test.ts` 11 of 12 passed: "combines every venue x staff x type choice (including cleared)" fails with "feed did not end" because its `allPages` helper follows at most 200 pages (5,000 assets), and the unfiltered feed of 222k assets does not end in 200 pages. A test assumption about data size, as seen by the Menus work too; the same test passes on fixture data, which is how the gate suites above ran.
- `pnpm test:migrations` (upgrade, reset, lint) is run by the harness on its own stack for this branch; not repeated here.

## Reproducing

```sh
export PERF_STACK=spare7; source /tmp/nabalens-ws/spare7/env.sh
sh tests/perf/run-db.sh high 20 docs/perf/library-raw/after        # generate, volume facts, EXPLAIN set, db-bench
node --conditions=react-server --import tsx tests/perf/refresh-bench.mjs --volume high --out docs/perf/library-raw/after
node tests/perf/library-bad-cases.mjs --volume high --n 20 --out docs/perf/library-raw/after
node tests/perf/library-explain.mjs --volume high --out docs/perf/library-raw/after
node tests/perf/ttfb-bench.mjs --volume high --n 20 --out docs/perf/library-raw/after   # needs next start on the stack's app port
```

The 500k volume is `VOLUMES.xl = { venues: 10, staff: 100, admins: 2, media: 500000, months: 24, video_share: 0.15, retired: 11 }` passed to `generate()` in `tests/perf/generate.mjs`; the results are stored under the volume name `xl500k`. `library-bad-cases.mjs` builds its odd shapes (all labelled, nothing labelled, only the oldest 5,000 labelled or unlabelled, only 200 labelled) inside rolled-back transactions.
