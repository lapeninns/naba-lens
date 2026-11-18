# S2-LIBRARY worker report

Final report from the T3 worker (branch `fa/s2-library`, merged into `feat/full-app-v1`).

# S2-LIBRARY report

I built 8 of the 10 checklist rows and partly built 2, plus all four Sprint 1 hand-off items. Everything is in 13 commits on `fa/s2-library`; nothing was pushed. Typecheck, ESLint and the unit suite pass, and the migration applies cleanly on a fresh reset of my stack. Two gaps: I didn't rerun the whole security suite after my last fix (details under Checks), and I didn't look at any screen in a browser.

## Checklist rows

| ID                        | Result                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A4-library-filters        | **Built.** New filters: in use or withdrawn (withdrawn photos are hidden by default), review state, date taken, orientation, request, collection, publication destination and tag. The existing filters (venue, item/alias, category, contributor, media type, upload date) are unchanged.                                                                                                                            |
| A4-asset-detail           | **Built.** `/admin/library/[assetId]` shows provenance, renditions, labels and their history, review decisions, the slots the photo fills and whether it's the main photo there, what it is evidence for, eligibility, exports, duplicates and history.                                                                                                                                                               |
| A4-controlled-tags        | **Built.** Admins create, rename, retire and restore tags at `/admin/library/tags`. Tags are added and removed on the detail page. A retired tag stays on photos but can't be added again.                                                                                                                                                                                                                            |
| A4-duplicates             | **Built.** The detail page lists exact duplicates (same file hash, anywhere in the group) and photos marked as duplicates. `/admin/library/compare` shows two side by side. Matching similar-but-different photos is Release 2.                                                                                                                                                                                       |
| A4-collections            | **Built.** `/admin/library/collections`: photos are added from the detail page; "Take out" removes only the reference, never the photo.                                                                                                                                                                                                                                                                               |
| A4-export                 | **Built.** "Export this photo" on the detail page, and "Export N from {venue}" per venue on a collection page, open the existing export builder with those photos already ticked. Packages are one venue each, so a mixed collection exports venue by venue.                                                                                                                                                          |
| A4-withdraw-restore       | **Built.** Withdraw and restore both need a reason and keep a history. A withdrawn photo drops out of export eligibility, so any package holding it is invalidated at download (AC32), and the database refuses to make it a main photo.                                                                                                                                                                              |
| A4-permanent-removal      | **Built** on the Sprint 1 removal functions. `/admin/library/[assetId]/remove` shows the impact preview, needs a reason, sends the preview's token back, and is refused while the photo is published. `/admin/library/removals` lists open requests: keep the photo with a reason, or go to its removal screen.                                                                                                       |
| S11-rendition             | **Partly built.** The detail page shows each stored rendition (kind, file key, type, size, pipeline version) and the review it inherits from the original. A separate approval per rendition needs edited versions, which are deferred (FA-42).                                                                                                                                                                       |
| S11-provenance-correction | **Partly built.** `admin_correct_asset_venue` records an audited correction with a reason, keeps the original venue unchanged, and withdraws the photo so its approvals and exports stop. It does **not** move the photo into the right venue's review queue. The upload venue is the key of about 18 venue-scoped tables with append-only histories; moving it needs a copy-into-venue design, which overlaps FA-41. |

Hand-off items:

- **`export_asset_status`:** built, on the detail page.
- **Removal screen and request list:** built (the two pages above).
- **Select primary for every slot kind:** built. Dishes use `set_menu_item_primary_photo` with the item revision; places and facilities use `set_slot_primary_photo`.
- **`asset_usages`:** built; it drives "Where it's used" on the detail page.

## Migration

One file: `20261118116000_library.sql`, in my range.

- **New tables:** withdrawals and their events, venue corrections, tags, asset tags, tag events, collections, collection items, collection events. Row-level security is on, there are no direct grants, and every history table is append-only.
- **New public functions:** `library_withdraw_asset`, `library_restore_asset`, `admin_correct_asset_venue`, `library_tags`, `library_tag_save`, `library_asset_tag`, `library_collections`, `library_collection_save`, `library_collection_set_items`, `library_filter_lists`, `library_asset_detail`. All are admin-only and need the second sign-in step.
- **`public.library_page`** is dropped and recreated with 9 new arguments at the end. Its earlier arguments still mean the same thing, except that withdrawn photos are left out by default.
- **`private.export_candidate_rows`** is redefined with one extra condition: withdrawn photos are excluded. **S2-INT also redefines this function (item 4), so the coordinator needs to merge both changes.** I first put the rule in `media_asset_use_state` instead, but the full security run showed asset search pins and mirrors that function, so I reverted it.
- Two triggers refuse a withdrawn photo as a main photo. Library writes are also recorded in the activity log (`library_asset_withdrawn`, `library_asset_restored`, `library_venue_corrected`).
- `lib/db/types.ts` was regenerated from my stack; the diff is additions only.

## Files

- **New:**
  - `lib/library/model.ts`, `lib/server/library/service.ts`
  - `app/admin/library/**`: detail, remove, compare, collections, tags and removals pages, server actions, loading and error states
  - `app/admin/library-more-filters.tsx`
  - Tests: `tests/security/library.test.ts`, `tests/unit/library-model.test.ts`, `tests/ui/library-screens.test.tsx`
- **Existing files I touched minimally** (outside my ownership marked ⚠):
  - `app/admin/(content)/page.tsx`, `admin-library.tsx`, `library-search.ts`, `library-actions.ts`, `app/api/library/route.ts`, `lib/server/media/library.ts`: pass the new filters through. The old `parseLibraryFilters` keeps its exact shape; `parseAdminLibraryFilters` was added alongside it.
  - ⚠ `components/nabalens/media-viewer.tsx`, `app/_media/media-gallery.tsx`: an optional "Open details" link.
  - ⚠ `app/admin/publishing/_components/export-builder.tsx` and `app/admin/publishing/new/page.tsx` (S1-EXPORT): an optional list of pre-ticked photos, read from `?assets=`.
  - `app/(dev)/ui-preview/ui-preview.tsx`: the new filter panel and the "Open details" link.
  - `tests/unit/scope-guard.test.ts`: allow-list entries for the 7 new pages, and for tag, approval and campaign wording in the library files only. The bans themselves are unchanged.
  - `docs/design-system/catalogue.md` (new rows; Prettier realigned the whole table, so the diff is wide), `docs/plans/full-app-v1/checklist.md`.

## Checks

- **`pnpm typecheck`** and **`pnpm exec eslint . --ignore-pattern '.claude/**'`:** clean.
- **`pnpm test`:** 385 files, 4797 tests, all passed. An earlier run had 21 failures, mostly 5-second timeouts while the security suite was loading the machine; the files with the timeouts passed when rerun alone (198/198). One was real: the scope guard flagged the ui-preview tag fixtures, and I fixed that.
- **Prettier:** changed files are formatted.
- **Fresh migration reset on my stack:** all 116 migrations apply.
- **Security tests, on the final migration:**
  - My new file plus the other library, export, coverage, privacy, use-grant and asset-search files: all pass.
  - The last full run, before the fix above: 1335 of 1337 passed. The 2 failures were the asset-search tests that the fix addresses, and they pass now. I didn't rerun all 86 files after the fix.
- **Not done:** no browser check at 320 px or on desktop, and no e2e run. The layouts use the existing responsive patterns and have no fixed widths, but nobody has looked at them in a browser.
- My stack is stopped (`--no-backup`).

## Assumptions

- **Withdraw doesn't change review decisions or coverage counts.** A slot filled by a withdrawn photo still counts as filled. Suspending a photo so the slot counts as empty again belongs to Review (M3-suspend, S2-REVIEW).
- **Library state words live in `lib/library/model.ts`, not in `status-chip.tsx`.** Putting "Approved for public use" in the shared chip file would widen the approval-word ban to screens staff see. If the design owner wants it there, record it in `departures.md`.
- **Export from a selection** works through the detail page and collections, not through multi-select on the library grid.
- **The request filter uses the existing coverage requirements.** If S2-REQ adds a new requests table, `private.library_ref_ids('request', …)` needs to follow it.

## For Sprint 3 reviewers and e2e writers

- **Routes:**
  - `/admin/library/[assetId]` and `/admin/library/[assetId]/remove`
  - `/admin/library/compare?a=…&b=…`
  - `/admin/library/collections` (`?archived=1` includes archived) and `/admin/library/collections/[id]`
  - `/admin/library/tags`, `/admin/library/removals`
  - New `/admin` URL params: `use` (withdrawn or all), `review`, `shot_from`, `shot_to`, `orientation`, `request`, `collection`, `destination`, `tag`
- **Test ids:**
  - Detail page: `asset-detail`, `asset-state`, `asset-slots`, `asset-corrections`, `asset-exports`, `asset-duplicates`
  - Library and collections: `library-more-filters`, `collections`, `collection-photos`, `tags`
  - Removal and compare: `removal-impact`, `removal-requests`, `compare-verdict`
- **Journeys:**
  - Tile → Open details → Withdraw (with reason) → the photo disappears from the export builder → Restore.
  - Make main photo on a dish or a place.
  - Add a tag or collection → open the collection → Export N from {venue}.
  - Removal request → Keep the photo, or Review removal → impact → reason → removed.
- **Seed data:** none was added. The security tests build their fixtures with psql, and `acceptPlacePhoto` in `tests/security/library.test.ts` shows how to make an accepted place photo.
