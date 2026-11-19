# S1-UPLOAD worker report

Final report from the T3 worker, kept verbatim as the hand-off record (branch `fa/s1-upload`, merged into `feat/full-app-v1`).

S1-UPLOAD is done on `fa/s1-upload`: 6 commits from `975b6ab3a`, tree clean, stack stopped. Of the 21 checklist rows, 12 are built, 6 partly built and 3 not built. Typecheck and lint are clean. All 77 security files pass. The unit suite does not have a clean run: the final full run had 2 failures, which pass when run alone (details under Checks). Nothing was pushed or deployed.

**Mistakes to know about**

- During a test run I accidentally ran `git checkout main --`, which switched the worktree to `main`. The tree was clean, so nothing was lost; I switched straight back and checked all commits were there and no stash entry was created.
- My first version of the migration put foreign keys on two new columns. That made the existing PostgREST link from `media_assets` to `profiles` ambiguous and broke typecheck. I removed them; both are now plain uuid columns written only by database functions.

## Checklist results

| ID                                         | Result                                                                                                                                                                                                                                                                       |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S12.1-image-limits                         | **Built.** 25 MiB, set in app config, reserve SQL and the device journal.                                                                                                                                                                                                    |
| S12.1-video-limits                         | **Partly.** 250 MiB and 60 s (half a second of slack), read from the stored file. Fragmented MP4 has no readable length, so only the byte limit applies. WebM is still accepted because existing behaviour was kept, and codecs are not validated beyond the existing probe. |
| S12.2-stable-ids                           | **Built.** One batch ID per selection, stored by the first reservation and kept on retries; the item ID is the existing upload key.                                                                                                                                          |
| S12.3-renditions                           | **Built.** New `media_renditions` table (kind, key, type, dimensions, settings, pipeline version). Existing previews are backfilled as `legacy`.                                                                                                                             |
| S12.4-hash-dedup                           | **Built.** SHA-256 at finalise; a copy is linked only to an earlier live, ready asset at the **same venue**. Other venues are never compared (AC23).                                                                                                                         |
| AC12                                       | **Built.** Security test covers a staff member moved to another venue, deactivated, venue closed, and a manager's grant ended.                                                                                                                                               |
| S5.1-captured-date, S11-captured-time      | **Built.** Capture time comes from the EXIF date-taken tag or the MP4/MOV creation time, never GPS. Unknown is the default. `set_media_captured_at` records a correction.                                                                                                    |
| S11-asset                                  | **Built.**                                                                                                                                                                                                                                                                   |
| S5.6-honest-states                         | **Built.** See the receipt words below.                                                                                                                                                                                                                                      |
| S10-transfer-states, S10-processing-states | **Built** as a mapping in `lib/upload/states.ts`; no new stored column.                                                                                                                                                                                                      |
| S12.4-membership-recheck, S16              | **Partly.** Storage writes and finalise now recheck the current venue. Preview and export rechecks belong to S1-PRIVACY and S1-EXPORT.                                                                                                                                       |
| AC21                                       | **Partly.** Duplicates earn no monthly credit. Coverage counts still need to ignore them (S1-COV).                                                                                                                                                                           |
| S5.6-processing-failed-recovery            | **Partly.** Retry re-finalises without resending the file. A server-side reprocess waits for durable jobs (FA-42).                                                                                                                                                           |
| S12.1-public-quality-target                | **Partly.** `belowPublicQuality()` helper; showing the flag in review is S2-REVIEW.                                                                                                                                                                                          |
| S12.2-orientation-display                  | **Partly.** Orientation is corrected inline, not in a durable job (FA-42).                                                                                                                                                                                                   |
| S12.3-durable-jobs                         | **Not built.** FA-42 defers it (needs a media worker).                                                                                                                                                                                                                       |
| S3.3-upload-scope (admin upload)           | **Not built.** Depends on S1-PEOPLE memberships.                                                                                                                                                                                                                             |
| S10-labelling-states                       | **Not built.** Belongs to S2-ADD and S2-REVIEW (FA-3, FA-4).                                                                                                                                                                                                                 |

## Migration

One migration: `20261118102000_upload_pipeline.sql`. It applies with plain psql and through `supabase db reset` (CLI statement splitter checked).

- **New columns on `media_assets`:** `client_batch_id`, `content_sha256`, `duplicate_of_asset_id`, `captured_at`, `captured_at_source`, `captured_at_set_by`. Batch, hash and duplicate link can't be changed once set.
- **Limits:** byte limits now come from `private.media_upload_max_bytes`. The media bucket and the archive receipt check go up to 250 MiB.
- **Venue recheck:** one rule, `private.media_upload_venue_allowed`, used by the storage insert policy, the storage write trigger and finalise.
- **`reserve_media_asset`:** dropped and recreated with an extra optional `p_client_batch_id`; otherwise the same body.
- **`complete_media_finalise`:** the old body moved unchanged to `private.complete_media_finalise_core`. A new public wrapper locks the asset, checks the venue (raises `upload_access_ended`), stores hash, duplicate link and capture time, then calls the old body. It also returns `duplicate_of_asset_id`.
- **Credit:** the old `monthly_credit_items` is renamed `monthly_credit_items_base`; a wrapper with the original name leaves duplicates out.
- **New function:** `set_media_captured_at(asset, time or null)`, allowed for the uploader, the venue's manager, or an admin.

## Files

Inside my ownership: `lib/upload/**` (new `states.ts`), `lib/server/media/{finalise,reserve,errors}.ts`, `components/nabalens/upload-queue.ts`, `upload-dialog.tsx`, the migration, `lib/db/types.ts` (my additions only), and new tests (`tests/security/upload-pipeline.test.ts`, `tests/media/capture-time.test.ts`, `tests/upload/states.test.ts`, `tests/unit/upload-limits-spec.test.ts`).

Outside my ownership, kept small:

- `lib/media/{capture-time.ts (new), index.ts (imageSize), video.ts (creation time)}`, `lib/config/media.ts`, `lib/server/archive/core.ts` (250 MiB limit)
- `app/staff/_shell/add-host.tsx`, `app/staff/actions.ts`, `components/nabalens/album/match/{match-screen,copy}.ts(x)`, `app/(dev)/ui-preview/fixtures.ts`
- `supabase/config.toml` (local storage limit 250MiB)
- Docs: `docs/media-pipeline.md`, `docs/design-system/departures.md` (new entry A-2), my rows in the checklist
- Existing tests updated for the new limits, the extra `onReady` argument and the duplicate flag.

## Checks

- `pnpm typecheck`: clean.
- `pnpm exec eslint . --ignore-pattern '.claude/**'`: clean.
- Prettier: clean on every file I changed.
- **Security, on my stack:** all 77 files pass. My new file passes 20/20, including again on a fresh database after the CLI reset.
  - One planner-sensitive test (asset-search "reads no evidence") failed once on a stack I had been filling with test rows for over an hour. On a reset database it passes both without my migration and with it (35/35), so it was stale table statistics, not this change.
- **`pnpm test`:** the final run gave 4583 passed and 2 failed. The two (`tests/media/review.test.ts` "normalizes advisory MIME" and `tests/ui/people.test.tsx` paging) pass when run alone.
  - Across three full runs a different set of timing-sensitive tests failed each time, and every one passed alone. They look like load flakes, but the suite has not had a clean full run.
- **Not run:** integration and e2e suites (coordinator's). Their 200 MB/20 MB assertions and fixture were updated, but not run.

## For Sprint 2 workers

- **`lib/upload/states.ts`:** `uploadReceipt(item)`, `transferState`, `processingState`, `serverProcessingState`, `RECEIPT_WORDS` (Album words) and `RECEIPT_SPEC_NAMES`.
- **Receipt words:** Saved on this phone, Sending, Checking, Waiting, Sent, Couldn't finish, Not sent. "Waiting" is shown only once the photo's slot was saved with it. Recorded as departure A-2; DESIGN.md §4 still needs the three new words.
- **Upload dialog:** new `onProcessing(file)` prop; `onReady` gets a third `receipts` argument; `onUnfinished` gets a third `stage` argument.
- **Queue:** queue items now carry `batchId`, `failedStage` and `duplicate`. The Match `SendState` type gains `checking`, `sent` and `unfinished`.
- **Finalise:** a ready response may include `duplicate: true`. A venue that no longer allows the uploader gets 403.
- **Config:** `MEDIA_LIMITS.maxVideoSeconds`, `MEDIA_LIMITS.publicQualityLongEdgePx`, `belowPublicQuality()` and `MEDIA_PIPELINE_VERSION`.
- **S1-COV:** coverage should ignore assets with `duplicate_of_asset_id` set.
- **S1-PEOPLE:** extend `private.media_upload_venue_allowed` for memberships and admin upload. If you also redefine `reserve_media_asset`, mine (later timestamp) wins and the two need merging.
- **Later migrations:** anything that redefines `monthly_credit_items` will replace the duplicate filter unless it keeps reading through the base.
- **S2-STAFF and S2-REVIEW:** build the screen that corrects capture time (call `set_media_captured_at`) and the review list's "possible duplicate" and below-1600 px flags.

## Assumptions

- "MB" in the spec is read as MiB, the units the code already uses.
- Duplicates are checked within one venue only.
- An EXIF time without a time zone is read as Europe/London, the venue default from FA-33.
- Capture time is never filled in automatically as "estimated".
- **Owner action:** before release, the hosted project's global upload limit must be raised to at least 250 MiB. No migration changes that.
