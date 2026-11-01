# Menu catalogue performance fixes (WS3, baseline fixes 2 and 6)

Branch `ws3/menus`. Compared against `docs/perf/baseline.md` sections 5.1, 5.3, 5.5 and 7 (fixes 2 and 6). Everything below was measured on the local stack `spare8` with the harness in `tests/perf/` (`PERF_STACK=spare8`), the same generated volumes as the baseline (current 50 media, expected 75k, high 221k).

## What changed

| Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Where                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `public.menu_label_counts(venue)`: one grouped count per venue returned as a single jsonb object `{item id: count}` (a single row, so PostgREST `max_rows` cannot truncate a 2,000-item menu). `SECURITY DEFINER`, `search_path = ''`, `assert_active_admin()` first, EXECUTE only for `authenticated` and `service_role`. It counts label rows of non-deleted `ready` assets, which is exactly what the admin RLS on `media_label_items` returns (`private.can_read_asset_labels`); the migration comment says it must follow that rule and `tests/security/menus-label-counts.test.ts` fails if it drifts. | `supabase/migrations/20261101110000_menu_label_counts.sql`, `lib/server/menus/index.ts` (`getMenuVersion`) |
| Index `media_label_items (venue_id, item_id)`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | same migration                                                                                             |
| Staff read policies on `menu_sections`, `menu_entries` and `menu_entry_variants` ask "may this caller read this version?" once per query (`version_id in (select private.staff_readable_menu_version_ids())`, a hashed subplan) instead of once per row. The helper is defined through `private.staff_can_label_venue`, so the same versions are readable. The old per-row check also ran for admins (the staff and admin policies are OR-ed). `staff_can_read_menu_version` is unchanged.                                                                                                                   | same migration                                                                                             |
| Venue page option list reads only the active document and the archived item ids (`getActiveMenuItems`), not label counts or a diff base.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `lib/server/menus/index.ts`, `app/admin/menus/[venueId]/page.tsx`                                          |
| Import matching and diff use maps (by source key, normalised name, item id) instead of array scans; same matches, same order.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `lib/menus/import/matching.ts`                                                                             |
| `getLabellingCatalogue` no longer embeds `menu_items(archived_at)` in every entry (staff RLS on `menu_items` runs a lookup per returned row). It reads, as the caller under the same RLS and range-paged, the entries of the active version whose item is archived (`menu_entries` with an inner join to `menu_items` filtered `archived_at is not null`), so only archived items of that menu pay the per-row policy.                                                                                                                                                                                       | `lib/server/labels/index.ts`                                                                               |

Migration sha256 as committed and as applied on spare8 and spare9: `76b8ddcfe2d2a5c0a0ec6aa0551769d46d11333308c47156ed3dc91b358cd3af`.

No visibility rule changed. Results are the same: `tests/unit/menus-matching-equivalence.test.ts` compares the new matcher with the previous implementation (kept in `tests/unit/support/menus-matching-reference.ts`) on every pair of menu fixtures, with no base, and on 2,000-item and 150-item synthetic menus (identical, edited, all keys changed, recycled names, aliases equal to other names); `tests/security/menus-label-counts.test.ts` compares the RPC with the admin's own paged RLS read, including a venue with 1,100 labelled items of 1,300 and 1,500 label rows, items without labels (absent, read as 0) and deleted, unfinished, failed, processing, other-venue and deactivated-admin cases; `tests/security/menus-staff-visibility.test.ts` compares what staff read with the documented rule (own venue, transferred staff, move and deactivation while a session is open, inactive staff, drafts, retired versions, other venues; admin unchanged); `tests/security/labels-catalogue-equivalence.test.ts` compares the new catalogue read with the previous embed read for admin, staff and a transferred staff member (archived in the active version, archived only in a retired version, another venue's archived item). `tests/security/menus-archived-paging.test.ts` checks the concurrent archived-id paging against sequential paging.

## Results

Each cell is p50 / p95 in ms (wall time of the app function or of the full page). `before` is the code at `7be0acf` (`ws/tech-debt-ws3`, no migration) and `after` is this branch with the migration applied; both ran on the same stack, volumes and harness, one volume after the other. Raw files: `docs/perf/raw-menus/{before,after}/<volume>/`. Load average (1 minute) at the start of each bench is stored in each raw file; they ranged 4.4 to 10.7.

### App functions on the largest venues (`db-bench`)

| Path                                        |        |     current |        expected |              high | requests at high |
| ------------------------------------------- | ------ | ----------: | --------------: | ----------------: | ---------------: |
| getMenuVersion active, largest venue        | before | 74.2 / 80.2 | 2154.8 / 2570.1 | 16526.6 / 18334.1 |               60 |
|                                             | after  |  9.1 / 11.7 |     18.5 / 20.2 |       26.2 / 28.2 |                6 |
| getMenuVersion retired, largest venue       | before | 58.5 / 61.7 |   2378 / 2597.7 | 17977.9 / 24298.6 |               63 |
|                                             | after  | 12.2 / 13.9 |     20.3 / 24.3 |       26.8 / 27.9 |                9 |
| getMenuVersion active, smallest venue       | before | 35.9 / 37.6 |   120.1 / 134.4 |     477.2 / 557.9 |               11 |
|                                             | after  |   8.5 / 9.9 |     15.7 / 18.6 |       19.2 / 20.6 |                6 |
| getVenueMenuOverview, largest venue         | before | 23.4 / 33.3 |     37.1 / 42.9 |       44.9 / 48.4 |                5 |
|                                             | after  |   3.5 / 4.2 |       8.9 / 9.8 |         5.9 / 6.6 |                5 |
| getLabellingCatalogue admin, largest menu   | before |   68 / 74.8 |     73.7 / 81.7 |       159.6 / 264 |                4 |
|                                             | after  |  7.8 / 10.8 |     11.7 / 12.9 |         7.8 / 9.7 |                5 |
| getLabellingCatalogue admin, smallest venue | before | 32.6 / 35.9 |     34.9 / 43.8 |      83.4 / 113.7 |                4 |
|                                             | after  |  8.8 / 10.7 |       10.4 / 12 |         5.8 / 6.3 |                5 |
| getLabellingCatalogue staff, own venue      | before | 86.3 / 95.6 |     86.2 / 91.5 |       87.1 / 95.9 |                4 |
|                                             | after  |      9 / 10 |       11.8 / 15 |         8.7 / 9.8 |                5 |
| listMenuVenues                              | before | 46.2 / 48.1 |   100.4 / 123.7 |     164.4 / 191.5 |                3 |
|                                             | after  |     6.4 / 8 |       9.1 / 9.9 |           6.4 / 7 |                3 |

### Pages from `next start` (`ttfb-bench`), complete time

| Route                                       |        |     current |        expected |              high | HTML bytes at high |
| ------------------------------------------- | ------ | ----------: | --------------: | ----------------: | -----------------: |
| admin menus, largest venue                  | before | 28.9 / 30.1 | 2361.9 / 2477.5 | 16827.3 / 17419.3 |          1,531,623 |
|                                             | after  |   10.4 / 12 |       41 / 45.1 |       60.3 / 70.2 |          1,331,061 |
| admin menu version (largest venue, active)  | before | 83.2 / 87.8 | 2306.2 / 2725.9 | 16817.7 / 17526.2 |            196,755 |
|                                             | after  | 21.5 / 24.9 |     27.9 / 31.3 |         44 / 51.2 |            197,092 |
| admin menu version (smallest venue, active) | before | 42.1 / 46.4 |   131.1 / 137.4 |     474.9 / 513.7 |             87,912 |
|                                             | after  | 17.9 / 21.8 |     23.2 / 25.5 |       33.4 / 39.3 |             87,914 |
| admin menus list                            | before | 53.2 / 58.5 |   106.2 / 109.6 |     119.7 / 127.5 |             70,271 |
|                                             | after  | 16.9 / 20.2 |     17.8 / 20.3 |           19 / 24 |            239,378 |

### Import preview and catalogue reads by menu size (`menu-bench`), p50 ms

**current** (before load 6.3, after load 6.2)

| Items |        | preview, same file | preview, 10% edited | preview, all keys changed | getLabellingCatalogue admin | getLabellingCatalogue staff | getMenuVersion |
| ----: | ------ | -----------------: | ------------------: | ------------------------: | --------------------------: | --------------------------: | -------------: |
|    50 | before |               12.3 |                11.3 |                      11.7 |                        13.9 |                        16.4 |           14.2 |
|       | after  |               10.1 |                 8.4 |                      10.4 |                         7.4 |                        10.5 |           10.2 |
|   150 | before |               26.8 |                26.6 |                      31.2 |                        30.7 |                        39.2 |           34.4 |
|       | after  |               11.4 |                10.2 |                        11 |                        11.7 |                         6.9 |           10.9 |
|   600 | before |               97.8 |               101.4 |                     162.7 |                       102.1 |                       134.4 |          116.5 |
|       | after  |                 15 |                15.2 |                      16.7 |                        11.4 |                         9.9 |           13.8 |
|  2000 | before |              777.5 |               748.3 |                    1391.4 |                       833.6 |                      1406.5 |          837.2 |
|       | after  |               54.4 |                52.9 |                      58.4 |                        27.9 |                        29.8 |           47.5 |

**expected** (before load 8.4, after load 7.9)

| Items |        | preview, same file | preview, 10% edited | preview, all keys changed | getLabellingCatalogue admin | getLabellingCatalogue staff | getMenuVersion |
| ----: | ------ | -----------------: | ------------------: | ------------------------: | --------------------------: | --------------------------: | -------------: |
|    50 | before |               20.1 |                21.5 |                        20 |                          16 |                        22.2 |           27.5 |
|       | after  |               13.5 |                11.1 |                      11.3 |                         7.5 |                         8.1 |           13.2 |
|   150 | before |               37.5 |                  40 |                      44.1 |                        38.8 |                        49.2 |           45.1 |
|       | after  |               14.8 |                  14 |                      14.3 |                         8.1 |                         8.1 |           14.2 |
|   600 | before |              123.5 |               113.9 |                     174.3 |                       111.7 |                       159.8 |          138.4 |
|       | after  |               20.9 |                22.5 |                      21.8 |                        15.4 |                        19.7 |           23.2 |
|  2000 | before |              799.2 |               805.7 |                    1450.5 |                       850.3 |                        1180 |            847 |
|       | after  |               66.1 |                64.5 |                        66 |                        30.1 |                        33.3 |           68.7 |

**high** (before load 5.6, after load 6.3)

| Items |        | preview, same file | preview, 10% edited | preview, all keys changed | getLabellingCatalogue admin | getLabellingCatalogue staff | getMenuVersion |
| ----: | ------ | -----------------: | ------------------: | ------------------------: | --------------------------: | --------------------------: | -------------: |
|    50 | before |               21.4 |                19.3 |                      21.1 |                        15.8 |                        18.3 |             70 |
|       | after  |               17.1 |                15.5 |                      14.6 |                         7.7 |                          14 |           27.5 |
|   150 | before |               37.6 |                34.1 |                      40.7 |                        46.6 |                        43.9 |          100.1 |
|       | after  |               18.8 |                20.7 |                      22.9 |                         8.7 |                         9.2 |           27.3 |
|   600 | before |              118.1 |                 118 |                       177 |                       113.4 |                       153.6 |          137.1 |
|       | after  |               26.8 |                27.2 |                      28.1 |                        12.5 |                        10.2 |           26.5 |
|  2000 | before |              779.9 |               798.6 |                    1456.4 |                       877.3 |                      1138.9 |          850.3 |
|       | after  |               66.9 |                67.9 |                      67.3 |                        34.2 |                          37 |           74.2 |

### Import matching alone (pure CPU, p50 ms, match / diff), high volume run

| Items | Case                          |      before |     after |
| ----: | ----------------------------- | ----------: | --------: |
|   150 | same keys, edited 10%         |   0.5 / 0.1 | 0.2 / 0.1 |
|   150 | all keys changed (worst case) |   4.2 / 0.3 |   0.3 / 0 |
|  2000 | same keys, edited 10%         | 15.7 / 12.3 | 2.7 / 0.8 |
|  2000 | all keys changed (worst case) |  654.9 / 58 |   4 / 0.6 |

### Venue with 2,000 active items and 3,000 archived (`menus-archived-bench`, after only), p50 / p95 ms

2,000 items of an earlier menu that are no longer on it, plus 1,000 of the 2,000 current items, are archived (4,000 items in all; the current menu shows 1,000). The archived read spans several PostgREST pages. There is no `before` column: the same bench against the old code would run on the new staff policy because spare8 already carries the migration, so the before numbers for a plain 2,000-item menu above are the reference.

| Volume   | load | getLabellingCatalogue admin | getLabellingCatalogue staff | getMenuVersion | preview, same file | requests (catalogue) |
| -------- | ---: | --------------------------: | --------------------------: | -------------: | -----------------: | -------------------: |
| current  |  6.3 |                   85.5 / 92 |               199.1 / 235.1 |    414 / 459.3 |        63.3 / 72.5 |    8 admin / 8 staff |
| expected |  8.5 |                 82.7 / 88.3 |               241.7 / 487.1 |    455.8 / 638 |        65.6 / 72.8 |    8 admin / 8 staff |
| high     |  7.1 |               106.5 / 142.3 |               229.8 / 269.1 |  466.6 / 534.8 |        78.4 / 85.1 |    8 admin / 8 staff |

### Concurrent paging of the archived item ids (`getMenuVersion`, `getActiveMenuItems`)

`getMenuVersion` read the venue's archived item ids one 1,000-row page after the other (4 round trips for 3,000). `archivedItemIdsOf` now reads the first page, then further pages in waves of 4 at once (`selectAllConcurrent`, `lib/server/menus/index.ts`): same query (`menu_items`, venue, archived, `order by id`), same caller RLS, rows concatenated in page order and cut at the first short page, so the result is the same as sequential paging. A wave that holds the end of the list may ask for pages past it, so 3,000 archived items cost 5 requests instead of 4 (11 to 12 for `getMenuVersion` on that venue); a venue with fewer than 1,000 archived items takes the same single request as before. No migration change.

`tests/security/menus-archived-paging.test.ts` compares `getMenuVersion` and `getActiveMenuItems` with plain sequential paging for venues with 0, 999, 1,000, 3,500, 5,000 and 6,200 archived items (inside a page, on a page boundary, at the end of the first wave, and into a second wave): identical id lists in identical order. It fails when the page offsets are shifted by one.

Measured against the same generated data, back to back, sequential (the previous code, `HEAD` before this change) against concurrent, two rounds per volume, p50 / p95 ms. "Archived venue" is the 2,000-active, 3,000-archived venue of the section above; "largest venue" columns are `db-bench` `getMenuVersion` on the largest PERF venue. Raw: `docs/perf/raw-menus/archived-paging/<variant>-round<n>/<volume>/`.

| Volume   | Round | Code       | Load at start | Archived venue `getMenuVersion` | requests | Largest venue, active | Largest venue, retired |
| -------- | ----- | ---------- | ------------: | ------------------------------: | -------: | --------------------: | ---------------------: |
| expected | 1     | sequential |          20.2 |                   594.9 / 764.2 |       11 |           18.4 / 19.9 |            22.6 / 27.2 |
| expected | 1     | concurrent |          11.7 |                   293.7 / 305.2 |       12 |           31.1 / 37.7 |            34.3 / 45.9 |
| expected | 2     | sequential |          10.7 |                   457.8 / 539.4 |       11 |           26.3 / 33.9 |            29.4 / 37.9 |
| expected | 2     | concurrent |          16.5 |                   271.2 / 288.5 |       12 |             27.7 / 34 |            31.6 / 33.9 |
| high     | 1     | sequential |           5.7 |                   384.6 / 475.6 |       11 |           37.9 / 42.5 |            41.4 / 45.6 |
| high     | 1     | concurrent |           9.0 |                   281.5 / 384.2 |       12 |           46.5 / 65.9 |            57.4 / 83.2 |
| high     | 2     | sequential |           7.5 |                   413.7 / 450.5 |       11 |           38.7 / 66.5 |            41.3 / 43.4 |
| high     | 2     | concurrent |          13.1 |                   276.6 / 331.5 |       12 |             43 / 47.1 |              45.7 / 49 |

- On the archived venue p50 drops from 385 to 595 ms to 271 to 294 ms, and p95 from 451 to 764 ms to 289 to 384 ms, at loads of 5.7 to 20. Every concurrent p95 is below 500 ms, at load 16.5 and 11.7 as well as at 9.0 and 13.1; the sequential runs were above 500 ms twice (539 at load 10.7 and 764 at load 20).
- The real PERF venues have 18 to 46 archived items, so they stay on the single first request, the same code path as before. In the table the concurrent runs sit a few ms above the sequential ones, but the two variants were measured one after the other under changing load. A second, interleaved measurement (64 alternating calls per variant in one process, high volume, `interleaved-high.json`) shows no difference: largest venue 43.2 / 53.2 ms sequential against 41.7 / 53.7 ms concurrent (load 9.7); archived venue 424 / 560 ms against 235 / 291 ms (load 8.3). The sequential variant misses 500 ms at p95 there at a load under 9; the concurrent one does not.
- `getLabellingCatalogue` is not touched by this change; its archived read stays sequential. Its p50 on the archived venue moved between 84 and 164 ms (admin) and 224 and 436 ms (staff) across these runs with the load, with no relation to the variant.
- The `db-bench` rows for the smallest venue are left out: from the second run of each volume on, the harness picks the archived venue as its "smallest" venue (a side effect of the extra bench venue), so they are not the smallest real venue. The first sequential round of each volume has the clean numbers (19 / 58 ms at expected, 32 / 57 ms at high).

## Targets (baseline section 7, fixes 2 and 6), at the high volume (221k media)

| Target                                                                 | Result                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getMenuVersion` p95 at most 500 ms for any venue                      | Largest venue 28.2 ms (active) and 27.9 ms (retired), smallest 20.6 ms (before: 18,334, 24,298 and 558 ms). Met. On the artificial archived-heavy venue (3,000 archived items) the first pass gave 535 ms at high and 638 ms at expected (load 8.5); with the archived ids paged concurrently p95 is 289 to 384 ms in all four runs (load 9.0 to 16.5), see the section above. Met. |
| `/admin/menus/<venue>` at most 300 ms                                  | 60.3 ms p50, 70.2 ms p95 (before 16.8 s). Met.                                                                                                                                                                                                                                                                                                                                      |
| Request count independent of label volume                              | `getMenuVersion` makes 6 requests (9 for a retired version, which also reads the active menu) at every volume; before it made 6, 25 and 60 at current, expected and high for the largest venue. Met.                                                                                                                                                                                |
| Venue page HTML                                                        | 1,531,623 bytes before, 1,331,061 after (13% less). The page still carries the item picker for every open suggestion, which is page weight (baseline 7.8, outside phase 2). Not investigated further.                                                                                                                                                                               |
| Import preview at most 300 ms at 2,000 items                           | 54 to 67 ms p50 against an active 2,000-item menu (before 778 to 799 ms; all keys changed: 58 to 67 ms against 1,391 to 1,456 ms). Met.                                                                                                                                                                                                                                             |
| `getLabellingCatalogue` at most 400 ms at 2,000 items, admin and staff | Admin 28 to 34 ms, staff 30 to 37 ms (before 834 to 877 ms and 1,139 to 1,407 ms). Met, also on the archived-heavy venue (admin 83 to 107 ms, staff 199 to 242 ms p50; one expected-volume staff p95 of 487 ms at load 8.5).                                                                                                                                                        |
| No change at 150 items                                                 | Every path is equal or faster at 50, 150 and 600 items. Met.                                                                                                                                                                                                                                                                                                                        |

Where the time went. Matching itself was 14 ms at 2,000 items (618 ms when every key changed); the 780 to 880 ms of a 2,000-item preview or catalogue read was the two 1,000-row `menu_entries` pages, whose RLS called `staff_can_read_menu_version(version_id)` for every row, for admins too (the staff and admin policies are OR-ed), plus the per-variant `EXISTS` of the variants policy. Staff reads then spent another 300 ms on the per-row `staff_can_read_menu_item` policy through the `menu_items` embed. After the fix the matcher is 4 ms in the worst case.

## Migration phases and tests

Migration phases (Harness, isolated workdir, logs in `/tmp/nabalens-ws/mig-logs/menus/`; harness fix `05dc805` merged): `upgrade` 7 of 7 passed, `reset` 3 of 3 passed, `lint` 3 of 3 passed with exactly the 5 known findings (`private.menu_document_title`, `private.write_menu_document`) and nothing new.

Visibility, old policies against new, same test files at the same commit (`c1a994b`) with only the database different:

| Stack                              | Policies | Command                                                                                                                                                 | Result                      |
| ---------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| spare9 (12 migrations)             | old      | `vitest run --config tests/security/vitest.config.ts tests/security/menus-staff-visibility.test.ts tests/security/labels-catalogue-equivalence.test.ts` | exit 0, 2 files, 12 tests   |
| spare9 (13 migrations, hash above) | new      | same two files plus `menus-label-counts.test.ts`                                                                                                        | exit 0, 3 files, 21 tests   |
| spare9 (13 migrations)             | new      | whole security suite                                                                                                                                    | exit 0, 13 files, 269 tests |
| spare8 (13 migrations)             | new      | whole security suite                                                                                                                                    | exit 0, 13 files, 269 tests |

After the concurrent paging change (spare8, PERF data purged first because the library suites time out against 221k media): lint exit 0; typecheck exit 0; `test` exit 0, 61 files, 608 tests; security suite exit 0, 14 files, 275 tests (includes `menus-archived-paging`, 6); `test:integration` exit 0, 19 files passed and 1 skipped, 207 tests passed and 12 skipped; `test:archive` exit 0, 8 files, 174 tests; `test:monitoring` exit 0, 97 tests; `pnpm journeys run 'menus.*' --stack spare8`: 18 pass, 2 fail (the known `o2` and `o5` design observations), 0 unavailable.

## Notes on the measurements

- **Load.** Library ran heavy benches on the same Mac. Before: `ttfb-bench` at the expected volume started at load 10.7 (the other benches at 5.0 to 8.4). After: loads 4.4 to 8.5; at the expected volume a 15-second security run on spare9 overlapped the start of `db-bench`, and the archived-heavy bench ran at load 8.5. Each raw file records the load average at its start.
- **Admin menus list page.** Its HTML grew from 70,271 to 239,378 bytes between the runs because spare8 held 61 `TEST Venue` rows created by the security suites I ran on spare8 before the after pass; `generate --purge` only removes `perf-venue-%` venues. The list timings are therefore not comparable and the list page is not one of the targets.
- **Archived-heavy venue.** The first pass (sequential paging of 3,000 archived item ids, 414 to 467 ms p50, p95 535 and 638 ms) is the section above; the ids are now paged concurrently, see the section on concurrent paging. A venue with that many archived items is far beyond the baseline data (`getLabellingCatalogue` only reads the archived items of the menu being read).
- **Cleanup.** `node tests/perf/generate.mjs --purge` removes the bench venue (`perf-venue-menutest-archived`) along with the other PERF rows: checked on spare8, the venue existed before the purge and no `perf-venue-%` venue and no orphaned `menu_items` remained after it.
- **Before data.** `before` was measured from a detached worktree at `7be0acf` against spare8 before the migration was applied; spare8 was then reset from this branch (data reloaded for each after volume).

## Reproducing

```sh
export PERF_STACK=spare8; source /tmp/nabalens-ws/spare8/env.sh
npx -y pnpm@10.30.1 exec next build && npx -y pnpm@10.30.1 exec next start -p 3648 -H 127.0.0.1 &
for V in current expected high; do
  node tests/perf/generate.mjs --volume $V
  node --conditions=react-server --import tsx tests/perf/db-bench.mjs --volume $V --n 20 --out docs/perf/raw-menus/after
  node tests/perf/ttfb-bench.mjs --volume $V --out docs/perf/raw-menus/after
  node --conditions=react-server --import tsx tests/perf/menu-bench.mjs --volume $V --out docs/perf/raw-menus/after
  node --conditions=react-server --import tsx tests/perf/menus-archived-bench.mjs --volume $V --out docs/perf/raw-menus/after
done
```

`before` is the same sequence run from a checkout of `7be0acf` (without `menus-archived-bench.mjs`) against a stack without the migration.
