# S1-COV worker report

Final report from the T3 worker, kept verbatim as the hand-off record (branch `fa/s1-cov`, merged into `feat/full-app-v1`).

S1-COV is built and every check passes. One rule in the database now gives every photo slot its state, and staff Album, admin albums and the Our menu summary all count from it. The work is in three commits on `fa/s1-cov` (`fd03d9b85`, `4024e0dcc`, `2d2cfba7b`). The isolated stack was reset from scratch, the full security suite run on it, and the stack stopped with `--no-backup`. Nothing was pushed.

## Checklist (S1-COV)

| ID                                                                           | Result       | Why                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC16, M2-keep-reference, S2-reference-vs-public, S10-inv4-reference-no-close | built        | Dish and place decisions have a public or reference level. A reference photo stays stored but never covers its slot. Tested.                                                                                                                       |
| AC35, S10-inv3-one-primary, M2-select-primary, S3.3-primary-image            | built        | Dish primary photos only ever use public photos; keeping the primary as reference passes it to the next public photo in the same transaction. Places and amenities get a primary via `set_slot_primary_photo` with an append-only history. Tested. |
| A4-select-primary                                                            | partly built | The database action exists for every slot kind; the Library screen action belongs to S2-LIBRARY.                                                                                                                                                   |
| S10-coverage-states                                                          | built        | Missing, Pending, Covered, Check due, Replacement needed, Inactive, plus Not here, with a flag for temporarily unavailable.                                                                                                                        |
| S10-usage-review-states                                                      | partly built | `asset_usages` reads every photo's review state in one vocabulary, and places and amenities gain Not used. Dishes have no Not used decision yet (S2-REVIEW).                                                                                       |
| S2-completion-rule, S2-qualifying-asset                                      | partly built | One rule gives one mandatory public photo per subject: ready, not deleted, current, public level. There is no validity period or presentation revision on approvals yet.                                                                           |
| S2-fact-photo-separate, AC24 (FA-32)                                         | built        | Amenity photos get their own review. A confirmed No needs no photo, and policy questions (Wi-Fi, dogs and others) ask only for the fact.                                                                                                           |
| S10-inv7-sold-out, M4-blocked-sold-out, AC26                                 | partly built | The rule never drops an unavailable slot from the total (tested). The sold-out flag itself is S1-MENUS's to add through a hook.                                                                                                                    |
| AC39                                                                         | built        | Totals and per-category counts recount exactly from the slot rows. Admin albums and the Our menu summary give the same numbers.                                                                                                                    |
| S11-venue                                                                    | partly built | Venues gain `timezone` (default Europe/London), `locality` and `operating_status`. Nothing reads them yet.                                                                                                                                         |
| S11-organisation                                                             | not built    | FA-33 keeps one implicit organisation.                                                                                                                                                                                                             |
| S11-subject-record, S2-terms-subject, S11-requirement, S11-submission-usage  | partly built | Unified as read-only functions (`coverage_slots`, `asset_usages`) rather than new base tables. Places have no aliases. Requirements stay implicit, apart from the amenity photo table.                                                             |
| S10-inv1-exact-approval                                                      | partly built | Approvals already record item, variant, menu version and asset. There is no rendition id (FA-42) and no presentation revision.                                                                                                                     |
| S10-no-overloaded-status                                                     | not built    | `upload_state` belongs to S1-UPLOAD.                                                                                                                                                                                                               |

## Assumptions

- **Reference still earns month credit**, since it is an acceptance.
- **Policy questions need no photo.** I chose six: guest_wifi, dogs_inside, dogs_outside, live_music, pub_quiz, curbside_pickup. Their state is Inactive and they leave staff Album. Staff answer those facts through the existing knowledge and task screens.
- **Existing filled amenity slots stay filled.** Each confirmed Yes with a photo got a carried-over public acceptance on the photo Album already showed.
- **Check due counts in the waiting part, never as filled.** Staff see the words "Needs checking", because the copy guard bans "due" in staff text.
- **Approval wording is avoided.** The scope guard bans "approved", so usage states are `public` and `reference`, and the messages say "accepted for public use".
- **Our menu summary:** `covered_items` follows the rule. `needs_recheck_items` stays limited to what the caller can act on, as before.
- **Other:** dishes come only from food and drinks sections, so Other has no slots yet.

## Migrations (`20261118100000` to `100200`)

- `100000`: venue columns, `review_level` on dish and place decisions, `amenity_photo_requirements`, `amenity_photo_decisions` (append-only), `slot_primary_choices` (append-only), and the amenity carry-over.
- `100100`: public-only dish rules, `set_menu_item_photo_level`, `decide_area_photo_level` (`decide_area_photo` keeps its signature as a public accept), `decide_amenity_photo`, `amenity_photo_queue`, `set_slot_primary_photo`.
- `100200`: `private.coverage_slot_rows`, `public.coverage_slots`, `public.asset_usages`, two stub hooks, and the four readers re-created on the rule.

## Files

- **Mine:** the three migrations, `lib/album/model.ts`, `lib/server/album.ts`, `components/nabalens/album/slot-tile.tsx`, `lib/db/types.ts` (only my additions), and tests `tests/security/coverage-slots.test.ts`, `tests/unit/coverage-model.test.ts`, `tests/ui/slot-tile.test.tsx`.
- **Outside my ownership, minimal changes:**
  - `app/admin/albums/albums-model.ts` and `lib/server/album-admin.ts` now use the rule's states.
  - `app/globals.css` gains a `slot-ring-check` utility.
  - `docs/design-system/DESIGN.md` §4 gains a Check due row.
  - `tests/security/album-slot-photos.test.ts` now accepts the amenity photo before expecting it to show (FA-32).

## Checks

- `pnpm typecheck`: clean.
- `pnpm exec eslint . --ignore-pattern '.claude/**'`: exit 0.
- Prettier on changed files: all pass.
- `pnpm test`: 361 files, 4575 tests passed.
- Security suite after a fresh `db reset` of my stack: 77 files, 1168 tests passed, including the new file's 20.
- Skipped: e2e and browser QA (no new screen journey); `lci` and `verify:release` (coordinator only).

## For Sprint 2 workers

- **Reads**
  - `public.coverage_slots(p_venue_id?)` returns jsonb `{venueId, slots[], categories[], totals}`.
  - Each slot carries kind, slotId, category, state, counted, unavailable, primaryAssetId and pendingCount.
  - Callers: staff and managers at their own venue; admins must name a venue.
  - `public.asset_usages(p_venue_id?, p_asset_id?)`, for managers and admins.
  - `public.amenity_photo_queue(p_venue_id?, p_status, p_limit)`.
- **Writes**
  - `set_menu_item_photo_level(asset, item, variant, level, expected_revision, reason?, key?)`: Keep as reference, or Approve for public use, on a dish photo.
  - `decide_area_photo_level(label, action, level, reason?)`.
  - `decide_amenity_photo(check, asset, action, level, reason?)`.
  - `set_slot_primary_photo(kind 'area'|'amenity', slot, asset, reason?)`. Dishes keep `set_menu_item_primary_photo`.
- **TypeScript**
  - `lib/album/model.ts`: `CoverageState`, `CoverageCategory`, `COVERAGE_CATEGORIES`, `CoverageSlot`, `CoverageView`, `parseCoverage`, `countCoverage`, `coverageSlotState`, `coverageByAlbumId`, and the new `SlotState` value `"check-due"`.
  - `lib/server/album.ts`: `getCoverageSlots`, `setMenuItemPhotoLevel`, `decideAreaPhoto`, `decideAmenityPhoto`, `setSlotPrimaryPhoto`.
- **`album_admin_counts`** keeps its old keys and adds `slots`, `categories` and `totals`. Amenity rows gain `state`.
- **Hooks for S1-MENUS and S1-FACTS** to replace in their own migrations:
  - `private.coverage_temporarily_unavailable(kind, slot_id)` for sold out.
  - `private.coverage_check_due(kind, slot_id, covered_since)` for the 90-day freshness check.
- **The scope guard** (`tests/unit/scope-guard.test.ts`) fails the unit suite on any "approved" text, and the staff copy guard does the same for "due". Other workers will hit both.
