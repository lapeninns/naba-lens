# Acceptance ids and journey coverage

The catalogue of every acceptance id that a journey (`tests/journeys/*.journey.json`)
may declare in `scenarios`. It maps each id to its source, the journeys that cover
it, and a status. `tests/unit/acceptance-coverage.test.ts` fails when this file and
the declarations disagree (section 3). Owner: Evidence. Contracts: section 2.2 of
`docs/workstreams/contracts.md`.

This file records **what is mapped**, not what passes. Results come only from
journey runs on a named commit and are kept under `docs/qa/evidence/`
(section 4). An id is never marked resolved here.

## 1. How to read the table

| Column     | Meaning                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| `id`       | The acceptance id, as declared in a journey's `scenarios`                                                                |
| kind       | `matrix` (menus QA acceptance row), `smoke`, `defect`, `observation`, `known-gap`, `media` or `flaky` (see section 2)                    |
| source     | File and line where the original statement lives, at the time of writing                                                 |
| journeys   | Journey ids that declare the id. `-` when none                                                                           |
| status     | `covered`: at least one journey declares it. `gap`: the behaviour is known and no journey covers it yet. `not covered`: out of reach of a journey, with the reason in the note |

Kinds:

- `defect`, `observation`, `known-gap` and `flaky` are **historical** ids. A historical id must be
  `covered`. A defect journey asserts the correct behaviour, so `fail` with
  `reproducedOnHead: true` means the defect reproduces on that commit.
- An **observation** is not a defect (the QA report calls O1 to O5 "not defects; the
  lead's call"). A `fail` on an observation journey means **the observation
  reproduced**. Records say that, and never call it a bug.
- `known-gap` is a reported gap whose journey asserts the correct behaviour (GAP-5b, GAP-19).
- `flaky` is a test that failed under load. A pass is read as "not reproduced on this commit", never as "fixed under load".
- `matrix` ids are the rows of section 3 of `docs/qa/menus-qa-report.md`. The
  report's own verdicts (14 of 15 passed) are historical and are not repeated here.

## 2. Ids

### 2.0 Harness smoke

| id | kind | source | journeys | status | note |
| --- | --- | --- | --- | --- | --- |
| `AUTH-LOGIN-SMOKE` | smoke | docs/qa/harness.md:1 | `auth.login-smoke` | covered | Harness check that a staff member signs in by magic link on the fixture world and sees only their own photo. Proves the harness, not a product requirement |

### 2.1 Menus QA matrix (`docs/qa/menus-qa-report.md` section 3)

| id | kind | source | journeys | status | note |
| --- | --- | --- | --- | --- | --- |
| `MENUS-QA-01` | matrix | docs/qa/menus-qa-report.md:63 | `menus.catalogue-activation` | covered | Import two venue menus; venue separation |
| `MENUS-QA-02` | matrix | docs/qa/menus-qa-report.md:64 | `menus.import-validation`, `menus.catalogue-history` | covered | Malformed input rejected; duplicates, variants, ambiguous re-import (history covers the re-import part) |
| `MENUS-QA-03` | matrix | docs/qa/menus-qa-report.md:65 | `menus.catalogue-activation` | covered | Review and activate; a draft is never shown to staff as active |
| `MENUS-QA-04` | matrix | docs/qa/menus-qa-report.md:66 | `menus.catalogue-history`, `menus.unavailable-items` | covered | Rename, archive, re-import and category move keep historical labels |
| `MENUS-QA-05` | matrix | docs/qa/menus-qa-report.md:67 | `menus.label-batch` | covered | Upload a photo and a video, label both with several items |
| `MENUS-QA-06` | matrix | docs/qa/menus-qa-report.md:68 | `menus.label-skip-later` | covered | Upload without labels, label later |
| `MENUS-QA-07` | matrix | docs/qa/menus-qa-report.md:69 | `menus.label-batch` | covered | Batch apply, per-file override, persists after reload |
| `MENUS-QA-08` | matrix | docs/qa/menus-qa-report.md:70 | `menus.label-conflict`, `menus.unavailable-items` | covered | Missing item; unavailable or stale catalogue handled |
| `MENUS-QA-09` | matrix | docs/qa/menus-qa-report.md:71 | `menus.label-ownership` | covered | Staff own-only; no cross-staff or cross-venue item |
| `MENUS-QA-10` | matrix | docs/qa/menus-qa-report.md:72 | `menus.label-boundaries` | covered | Inactive users, deleted media, unfinished uploads. The journey checks the API level only. Browser-level coverage of this row stays in `pnpm test:security` |
| `MENUS-QA-11` | matrix | docs/qa/menus-qa-report.md:73 | `menus.label-transfer` | covered | Staff transfer: the old asset keeps the original venue catalogue |
| `MENUS-QA-12` | matrix | docs/qa/menus-qa-report.md:74 | `menus.library-filters` | covered | Admin correction, combined filters, search, stable pagination |
| `MENUS-QA-13` | matrix | docs/qa/menus-qa-report.md:75 | `menus.library-filters` | covered | Original bytes, upload, preview and download unchanged |
| `MENUS-QA-14` | matrix | docs/qa/menus-qa-report.md:76 | `menus.responsive-a11y` | covered | Phone widths, accessible names, keyboard focus. Chromium emulation, axe and name checks only: no screen reader, no physical phone. Failed in the report because of D1 and D2 |
| `MENUS-QA-15` | matrix | docs/qa/menus-qa-report.md:77 | `menus.draft-conflict`, `menus.label-conflict` | covered | Stale updates: no silent loss or duplicates |

### 2.2 Menus QA findings (historical)

| id | kind | source | journeys | status | note |
| --- | --- | --- | --- | --- | --- |
| `MENUS-D1` | defect | docs/qa/menus-qa-report.md:81 | `menus.d1-video-tile-name` | covered | Video tiles fail WCAG 2.5.3 Label in Name. Medium |
| `MENUS-D2` | defect | docs/qa/menus-qa-report.md:102 | `menus.d2-archive-button-name` | covered | Archive item buttons fail WCAG 2.5.3 Label in Name. Low to medium |
| `MENUS-O1` | observation | docs/qa/menus-qa-report.md:118 | `menus.o1-save-while-reloading` | covered | Save labels stays enabled while Reload the menu is loading. Recoverable |
| `MENUS-O2` | observation | docs/qa/menus-qa-report.md:122 | `menus.o2-narrow-draft-editor` | covered | 360 px draft editor truncates the section name. A `fail` means the observation reproduced |
| `MENUS-O3` | observation | docs/qa/menus-qa-report.md:127 | `menus.o3-usage-docs` | covered | The usage docs do not describe Menus, labelling or the library filters |
| `MENUS-O4` | observation | docs/qa/menus-qa-report.md:129 | `menus.o4-phone-project` | covered | The `mobile-chromium` PHONE grep does not select `menus-*` specs. A `fail` means the observation reproduced |
| `MENUS-O5` | observation | docs/qa/menus-qa-report.md:133 | `menus.o5-early-file-choice` | covered | A file chosen before the venue page hydrates is ignored. A `fail` means the observation reproduced |

### 2.3 Media upload and recovery (`docs/acceptance.md`)

The `source` column names the `GAP-n` item and the ledger R-number each id
relates to; neither is an id itself. `known-gap` ids and the `flaky` ids are
historical: their journeys assert the correct behaviour (section 1).

| id | kind | source | journeys | status | note |
| --- | --- | --- | --- | --- | --- |
| `MEDIA-INTERRUPTED-RESUME` | media | docs/acceptance.md:250 (GAP-4; R8) | `media.tus-interrupted-resume` | covered | A video upload interrupted mid-transfer resumes from the server offset on the real Supabase resumable endpoint |
| `MEDIA-OFFLINE-RETRY` | media | docs/acceptance.md:250 (GAP-4; R8) | `media.tus-offline-retry` | covered | Offline, or an outage that outlasts the retry schedule, shows a per-file Retry that resumes the same asset. Finding, not a defect: when the browser itself is offline the upload client fails at once and recovers through Retry. Its 0, 3, 5, 10, 20 s schedule applies only while the browser stays online |
| `MEDIA-RELOAD-RESUME` | media | docs/acceptance.md:250 (GAP-4; R8) | `media.reload-resume` | covered | After a reload mid-transfer, choosing the file again resumes the same asset from the stored offset |
| `MEDIA-REOPEN-STATES` | media | docs/acceptance.md:250 (GAP-4; R8) | `media.reopen-states`, `media.removed-reservation` | covered | After a reload the portfolio tells completed, incomplete and failed files apart (reopen-states). A removed reservation shows the action to take and Retry uploads a new asset (removed-reservation) |
| `MEDIA-PARTIAL-BATCH` | media | docs/acceptance.md:267 (GAP-5; R8) | `media.partial-batch` | covered | A partial batch keeps the good files, fails the bad one with a reason, and a retry leaves one row per file |
| `MEDIA-STUCK-PROCESSING` | known-gap | docs/acceptance.md:280 (GAP-5b; R15) | `media.stuck-processing` | covered | Covers the `fail_stale_media_processing` RPC (30 minute window, called with the service client) and the recovery in the UI. It does **not** cover the scheduler path (`runMediaCleanup`, `/api/internal/cleanup`), so R22 stays a gap |
| `MEDIA-LEAVE-WARNING` | known-gap | docs/acceptance.md:384 (GAP-19; spec section 5, no R-number) | `media.leave-warning` | covered | Leaving during an active upload prompts (navigation and tab close); an idle page does not |
| `MEDIA-RELOAD-METADATA` | media | docs/acceptance.md:118 (section 3 Image upload; R10) | `media.reload-metadata` | covered | After a reload the staff portfolio and the admin library show thumbnail, upload date, contributor and venue |
| `MEDIA-SLICE-UPLOAD-FLAKY` | flaky | docs/acceptance.md:58 (section 1.1; R6, R12, R13) | `media.slice-staff-upload`, `media.slice-staff-upload-mobile` | covered | Caveat: the original 504s and the "2 uploaded" timeout happened under load. Media ran the spec 13 times per project on its own head (10 repeats, the official run and two full re-runs), all passing, but the stack lock kept the load away. Wording: 13 runs per project on Media's head plus the run of record, all passing on a quiet stack; not shown resolved under load |
| `MEDIA-SLICE-PROFILE-FLAKY` | flaky | docs/acceptance.md:59 (section 1.1; R4) | `media.slice-profile-photo`, `media.slice-profile-photo-mobile` | covered | Same caveat as `MEDIA-SLICE-UPLOAD-FLAKY`: 13 runs per project on Media's head plus the run of record, all passing on a quiet stack; not shown resolved under load |

Items of `docs/acceptance.md` that WS1 does not touch (not ids, not covered by any
journey): GAP-1, GAP-2, GAP-3, GAP-6, GAP-7, GAP-8, GAP-11, GAP-12, GAP-13,
GAP-16, GAP-17, GAP-18, and the blocked items R21 and R22. R22 includes the
cleanup scheduler path, which `MEDIA-STUCK-PROCESSING` does not reach. They stay gaps.

## 3. The coverage check

`tests/unit/acceptance-coverage.test.ts` (run by `pnpm test`) reads this file and
every `tests/journeys/**/*.journey.json` through the harness registry and fails
when:

- a journey declares a scenario id that is not a row here;
- a row lists a journey that does not exist, or one that does not declare the id;
- a journey declares an id whose row does not list that journey;
- a `covered` row has no journey, or a `gap` or `not covered` row has one;
- a `gap` or `not covered` row has an empty note (the reason is required);
- a historical id (`defect`, `observation`, `known-gap`, `flaky`) has no journey, or none of its journeys
  carries `historical.id` equal to that id.

Adding a journey means adding or editing its rows here in the same change.

## 4. Evidence records

A run counts only when it ran on a clean tree (`dirty: false`) and its record is
kept under `docs/qa/evidence/<date>-<short-commit>-<label>/`. See
`docs/qa/evidence/README.md` for the format and how to write one.
