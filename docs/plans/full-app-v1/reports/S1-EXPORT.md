# S1-EXPORT worker report

Final report from the T3 worker, kept verbatim as the hand-off record (branch `fa/s1-export`, merged into `feat/full-app-v1`).

S1-EXPORT is done and committed on `fa/s1-export` (13 commits). Nothing was pushed, and my stack (ports 586xx) is stopped. Typecheck, ESLint, Prettier, the full unit suite and the full security suite all pass. I didn't run a browser check of the new screens; that's left for the coordinator's browser pass.

## Checklist results

| ID                                                                      | Result           | Notes                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S14.1-scope                                                             | built            | A manager exports from their own venue only; an admin exports from any venue, or several in one package. Access is checked again on every call and at download.                                                                           |
| S14.1-default-public                                                    | built            | Public is the default. "Internal" is a separate choice for admins only, and every file in it is marked internal only.                                                                                                                     |
| S14.1-output-profiles                                                   | built            | Original, Website image (WebP, fits 1600 × 1600), Social image (JPEG, fits 1080 × 1350) and Custom size. Admins can edit the presets, and every change is kept in a history table. Resized files carry no camera details or location.     |
| S14.1-manifest                                                          | built            | Each ZIP holds `manifest.json`, `manifest.csv` and `READ-ME.txt`, with one row per file. Capture date reads "unknown" until S1-UPLOAD records it.                                                                                         |
| S14.1-alt-text                                                          | partly           | Alt text is typed and reviewed by the person in the selection screen. Captions are stored by the database but have no field on screen yet. Automatic suggestions are Release 2.                                                           |
| S14.1-filenames                                                         | built            | `venue-slug-subject-slug-<first 8 of asset id>.ext`, built in the database. Filenames never contain the uploader's original filename, a person's name or a note.                                                                          |
| S14.1-recheck-invalidate, AC32                                          | built            | A package with a withdrawn photo can't be downloaded; it is marked and offers "Rebuild without withdrawn photos". The package list warns before anyone tries.                                                                             |
| S14.1-snapshot, AC31, S10-inv9                                          | built            | A finished download is recorded as Exported, with each file's hash and size. Exported is never shown as Published.                                                                                                                        |
| S14.2-only-approved                                                     | partly           | Exports and Published records require a photo that is approved for public use now. Facts are not exported.                                                                                                                                |
| S14.2-manual-followup, A5-withdrawal-pending, S9.3-withdrawal-stops-use | built            | A Published photo that stops being approved shows as Withdrawal pending until an admin confirms it was taken down. No screen claims a downloaded copy can be recalled. No public cache exists yet, so no cache-withdrawal step was built. |
| S10-publication-states, S11-export-publication                          | built for manual | Queued and Update pending have words but nothing produces them; they belong to integrated destinations (Release 2).                                                                                                                       |
| S3.3-download-originals                                                 | built            | Managers get originals through an Original-profile package of their own venue. The single-file route under `app/api/media/**` stays admin-only, because S1-PRIVACY owns it.                                                               |
| S3.3-publish-integrations                                               | built            | Destinations and publication records are admin-only.                                                                                                                                                                                      |
| A5-screen, A5-exported-vs-published, A5-words-conflict                  | built            | The Exported/Published words are recorded as departure A-E1; staff screens never show them.                                                                                                                                               |
| A5-destination-config                                                   | partly           | Destinations are manual and scoped to one venue or all venues, with name, address, counts and last published date. There is no retry state, since nothing is integrated.                                                                  |
| S9.3-review-due-excluded-exports                                        | partly           | Menu photos needing a recheck and stale amenity answers are excluded. Places' Check due depends on S1-COV and S1-FACTS.                                                                                                                   |
| S16-central-public-use-review                                           | partly           | Use restrictions are stored on each export item. Recording the contribution notice belongs to the first sign-in task.                                                                                                                     |
| S19-workers                                                             | partly           | The ZIP is streamed one file at a time inside the request (limited to 300 seconds); there is no durable background worker.                                                                                                                |
| S19-api-layer, S21-R1-exports                                           | built            |                                                                                                                                                                                                                                           |

## Migrations (all in my 105xxx range; a fresh reset applies them cleanly)

- `20261118105000_export_packages.sql`: profiles and their history, packages, items, downloads, the single eligibility rule, staleness and access helpers.
- `20261118105100_publication_records.sql`: destinations, append-only publication records, derived states.
- `20261118105200_export_publication_api.sql`: the 13 public functions.
- `20261118105300_export_asset_thumb.sql`: thumbnail gate for the export screens.

## Files

**Mine:** `lib/server/exports/*` (model, service, download, an in-house ZIP writer, renderer, links), `app/api/exports/**`, `app/admin/publishing/**`, plus tests: `tests/security/exports.test.ts`, `tests/unit/exports-files.test.ts`, `tests/unit/exports-service.test.ts`, `tests/ui/exports.test.tsx`.

**Outside my ownership (small edits):**

- `app/manager/exports/**` (new)
- `components/nabalens/status-chip.tsx`: publication and package states
- `components/nabalens/app-shell.tsx`: Publishing in the admin nav
- `components/nabalens/manager/hrefs.ts`: an `exports` link
- `lib/server/coverage/evidence.ts`: one line, the gate name
- `lib/db/types.ts`: additions only
- `tests/unit/scope-guard.test.ts` and `tests/ui/app-shell.test.tsx`
- `docs/design-system/departures.md` (A-E1) and `catalogue.md` (4 rows)

**Scope guard: needs your review.** The old guard banned ZIP export and approval words. I added the new routes to its allow-lists and exempted only my own files and migration range from those two bans. Other workers will hit the same guard for notifications and campaigns.

## Checks

- `pnpm typecheck`: clean
- `pnpm exec eslint . --ignore-pattern '.claude/**'`: exit 0, no findings
- Prettier on every changed file: "All matched files use Prettier code style!"
- `pnpm test`: 363 files, 4591 tests passed
- Full security suite on my stack: 77 files, 1172 tests passed; `exports.test.ts` alone: 24 passed, including a real ZIP built through the download code
- Migration suite, lint phase: 4 passed (no drift, no new lint findings)

## For Sprint 2 and integration

- **Functions** (all callable by signed-in users only): `export_candidates`, `export_package_create`, `export_packages_list`, `export_package_detail`, `export_package_download_start`, `export_package_download_finish`, `export_package_rebuild`, `export_asset_status`, `export_profiles`, `export_profile_set`, `publication_destination_save`, `publication_record`, `publication_overview`, `export_asset_thumb`.
- **TypeScript:** DTOs, parsers and `PUBLICATION_STATES` / `PUBLICATION_WORDS` are in `lib/server/exports/model.ts`. Chip keys are `publication_<state>`, `package_<state>` and `internal_only`.
- **S1-COV:** when review levels land, tighten `private.export_candidate_rows`. It is the only eligibility rule; it currently treats "accepted" as public.
- **S1-UPLOAD:** fill `capturedAt` in `export_package_download_start`.
- **S1-PEOPLE:** access goes through `can_manage_venue`; the list and profile reads also use `my_manager_venue_id()`.
- **S2-MGR:** link `/manager/exports` from Overview. "Publication issues" is `publication_overview().outstanding`.
- **S2-LIBRARY:** use `export_asset_status(asset)`.
- **S2-ADMIN:** the admin nav now has 6 items; please check it at phone width.
- **S1-OPS:** failed exports are `export_package_downloads.failed_at`. The "export formats" setting is `export_profile_set`; please don't build a second one.

## Assumptions

- **ZIP:** I wrote a small ZIP writer instead of adding a dependency, so the lockfile is unchanged. It has no ZIP64, so Original packages over about 4 GB are refused with a message.
- **Public:** "approved for public use" means the current accepted review decision.
- **Amenity photos:** these count as public only with an in-force use grant plus amenity eligibility. Grants are switched off today, so in practice amenity photos are internal-only.
- **Images only:** videos are not exported (FA-42).
- **HEIC:** HEIC originals are resized from their stored 1600px preview, so their resized files are at most 1600px.
- **Package size:** at most 200 photos per package.
- **Published records:** only for photos approved for public use now, dated today or earlier (London time).
