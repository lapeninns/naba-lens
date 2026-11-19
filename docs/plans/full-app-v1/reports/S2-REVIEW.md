# S2-REVIEW worker report

Manager review inbox (spec §7 M2, M3; FA-4, FA-7, FA-31, FA-35). Branch `fa/s2-review`, one migration in range.

## Checklist (S2-REVIEW)

The Result column of [checklist.md](../checklist.md) carries the same wording.

| ID                           | Result                                                                                                                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC03                         | built: Needs label photos (tagged food or drink, no dish) sit in the main Waiting queue. The 7-day Match later rule and the I'm not sure entry belong to S2-ADD (see Assumptions).                                        |
| S3.3-label-after-review      | partly: managers fix labels (audited, and the contributor gets a Label corrected notice). The staff correction request belongs to S2-STAFF.                                                                               |
| S9.1-review-criteria         | partly: Approve for public use is an explicit action, and the reasons cover people or personal details and the current way a dish is served. The clearance checklist stays owner-gated.                                   |
| S11-review-decision          | built: place and amenity decisions record `previous_decision_id`, and a stale decision is refused with the latest one shown.                                                                                              |
| M2-needs-label-main-queue    | built                                                                                                                                                                                                                     |
| M2-sort-filters              | partly: oldest first, with category (Food/Drinks), contributor, section, age (2+ or 7+ days), possible duplicate and needed-by (urgent) filters. There is no media-type filter because every review queue is photos only. |
| M2-detail-subject-context    | built: the detail shows the subject, presentation revision and needed-by date; the card shows the task under "Also counts for".                                                                                           |
| M2-detail-comparison         | built: the photos sent with this one, and the album's public photos for each slot.                                                                                                                                        |
| M2-detail-provenance         | built: contributor, upload date, capture date or "Taken: unknown" (with its source), and size.                                                                                                                            |
| M2-detail-flags-history-note | built: Needs label, Possible duplicate and Small (below 1600 px, reference only) flags; history from every decision table; the staff note.                                                                                |
| M2-fix-label                 | built for dishes: Fix label accepts the photo for the chosen item in the same step and notifies the contributor. Relabelling a place photo is not built.                                                                  |
| M2-approve-public            | partly: the public level is recorded, but no media-use grant or clearance step is tied to it (owner decision).                                                                                                            |
| M2-retake-reasons            | built: the spec's codes are carried in Album words (`RETAKE_REASONS`), plus a short note. "Wrong item" is no longer a retake reason.                                                                                      |
| M2-mark-duplicate            | built                                                                                                                                                                                                                     |
| M2-archive-not-used          | built                                                                                                                                                                                                                     |
| M2-batch                     | built (the loaded page, at most 24 photos)                                                                                                                                                                                |
| M2-self-review               | not built: an FA-9 single-reviewer venue needs a venue setting (S2-ADMIN) and changes to S1-COV's decision functions.                                                                                                     |
| M2-concurrent-conflict       | built                                                                                                                                                                                                                     |
| M3-album-states              | partly: the detail shows each slot's state and level. The manager Album view belongs to S2-MGR / S2-LIBRARY.                                                                                                              |
| M3-subject-detail            | not built here: S2-MGR (Venue/Album) and S2-LIBRARY (asset detail)                                                                                                                                                        |
| M3-actions                   | partly: Select primary, Fix label, Not used and Withdraw are on the photo detail.                                                                                                                                         |
| M3-suspend                   | not built: destination work belongs to S1-EXPORT / S2-LIBRARY.                                                                                                                                                            |
| M3-download                  | not built here: S1-EXPORT built the manager export, and downloading originals belongs to S2-LIBRARY.                                                                                                                      |
| M4-manager-review-task-sends | not built: belongs to S2-REQ's request model.                                                                                                                                                                             |
| M-nav                        | not built here: belongs to S2-MGR's row.                                                                                                                                                                                  |

Hand-off items:

- `presentation_changed` is added to `RecheckKind`, its parser and both copy tables ("Served differently now").
- The possible-duplicate and below-1600 px flags are built.
- A dish Not used decision is built: `review_set_aside` sets a whole photo aside.
- The detail and Review page use `set_menu_item_photo_level`, `decide_area_photo_level` / `decide_amenity_photo` (through stale-checked wrappers) and `amenity_photo_queue`.
- **Reviewer handover in `remove_venue_member` is not built**, because no reviewer model exists yet. It is recorded for S2-MGR, which owns main and backup reviewers.

## Assumptions

- **Needs label = the existing unlabelled set.** Today that means usable photos that staff tagged food or drink but did not match to a dish. Untagged Match later photos are not in the queue: `assign_menu_item_photo` refuses them, and FA-4's 7-day rule needs the staff side. **S2-ADD:** save "I'm not sure" as a content-type-only label (`dish` or `drinks`, no item) and it appears here automatically.
- **Mark duplicate does not touch `media_assets.duplicate_of_asset_id`.** S1-UPLOAD's guard fixes that column once a photo is ready, so the link lives in `review_dispositions.duplicate_of_asset_id`. A photo that is set aside can never be accepted, so it earns no coverage or credit.
- **Not used / Mark duplicate need the photo to have no live decision.** A photo already accepted or asked again is withdrawn first (`withdraw_first`), so a public decision is never undone silently. Setting a photo aside also records Not used on its waiting place and amenity rows.
- **Batch Not used uses one shared reason** (code `not_used_batch`). Photos of the same dish are decided in turn against the revision the previous decision left (`RevisionChain`); someone else's change still conflicts.
- **The detail is manager-only.** Admins keep their Review twin without a detail link (`photoHref` returns null for the admin scope). The server functions accept an admin `venueId` if the coordinator wants to add it.

## Migration

`20261118110000_review_inbox.sql`. It is additive, and RLS is on for the new table.

- **New table:** `review_dispositions`, append-only.
- **New private functions:** `asset_set_aside`, `review_conflict_detail`.
- **Private functions redefined:** `menu_photo_pending_tuples` and `menu_photo_stale_label`. Each keeps its body and adds "not set aside". `menu_photo_unlabelled_eligible` is deliberately unchanged: it also gates who may open an unlabelled photo and is pinned by `tests/security/asset-search.test.ts`, so the queue and the detail add the set-aside rule themselves.
- **Columns added:** `previous_decision_id` on `area_photo_decisions` and `amenity_photo_decisions`, filled by insert triggers.
- **New public functions:** `review_decide_area_photo`, `review_decide_amenity_photo`, `review_set_aside` and `review_photo_detail`.
- **Queue redefined:** `manager_menu_photo_queue` is dropped and recreated with four new optional parameters and six new columns. Existing named-argument callers are unchanged.
- **Notifications:** the `notifications_kind_check` constraint gains `label_corrected` (a minimal touch on S1-OPS's table). The `menu_item_photo_events_label_corrected` trigger writes the notice.

Execute on the new public functions is granted to `authenticated` only. It was proven on the isolated stack (`--ports 593`) with `db reset`, and `lib/db/types.ts` was regenerated from it with additions only.

## Files

- **New:**
  - `lib/review/inbox.ts`, `lib/server/review/inbox.ts`
  - `app/manager/review/actions.ts`, `app/manager/review/_shared/amenity-section.tsx`
  - `app/manager/review/photo/[assetId]/{page,loading,error}.tsx`
  - `components/nabalens/manager/review/inbox-{copy,flags,photo-detail,batch}.tsx|ts`
  - tests: `tests/security/review-inbox.test.ts`, `tests/unit/review-inbox.test.ts`, `tests/ui/review-inbox.test.tsx`
- **Changed (mine):**
  - `lib/server/menu-photos/{types,read}.ts`
  - `components/nabalens/manager/{hrefs,copy}.ts`
  - `components/nabalens/manager/review/{links,review-card,review-filters,review-list,review-screen,review-copy}.tsx|ts`
  - `app/manager/review/page.tsx`, `app/manager/review/_shared/review-page.tsx`
  - `components/nabalens/album/review/{model,copy,thumb-review}.ts|tsx` (spec reasons, Details link)
- **Outside my ownership (minimal):**
  - `lib/ops/notifications.ts`: the `label_corrected` kind and its words (S1-OPS).
  - `components/nabalens/area-photos/area-review-list.tsx`: a Details link.
  - `tests/unit/scope-guard.test.ts`: the route and the approval-words allow-list for the inbox files.
  - `docs/design-system/catalogue.md`: four rows. Prettier realigned the table.
  - Existing tests updated for the new reason chips: `tests/{ui,unit}/album-review.test.*`.
  - `lib/db/types.ts`.

## For Sprint 3 (reviewers and e2e)

- **Routes:**
  - `/manager/review` has the list view with new filter pills (`?category=food|drinks`, `?age=2|7`, `?dupes=1`, `?needed=1`), "Decide several" on the Waiting view, and an Amenity photos section.
  - `/manager/review/photo/[assetId]` is the photo detail.
- **Test ids:**
  - `data-review-filter`, `data-review-details`, `data-review-action` (approve, keep-reference, ask-another, fix-label, primary, withdraw, mark-duplicate, not-used, restore, send-ask, confirm-duplicate)
  - `data-review-slot`, `data-review-history`, `data-review-taken`, `data-review-note`, `data-review-contributor`
  - `data-batch-toggle`, `data-batch-card`, `data-batch-action`, `data-batch-confirm`, `data-batch-confirm-button`, `data-batch-failures`
  - `data-review-amenities`
- **Journeys:**
  - **AC03:** staff tags a photo Food with no dish, and it shows on Review with "Needs label". The manager fixes the label from the detail, and the photo is accepted.
  - **AC15:** a staff label is wrong. The manager uses Fix label, and the contributor's inbox shows "Label corrected: <dish>".
  - **AC16:** Keep as reference leaves the slot uncovered.
  - **AC17:** Ask for another photo with "Too dark" and a note.
  - **AC18:** two sessions each open the detail. The second decision shows "Someone else decided this photo first" with the first decision.
  - **AC21:** Mark duplicate against an accepted photo.
  - **AC37:** batch-approve two photos and check the confirm dialog shows exactly two thumbnails.
- **Error codes:**
  - `review_conflict` (40001) carries the latest decision as JSON in `details`.
  - `withdraw_first`, `duplicate_target_invalid`, `already_set_aside`, `nothing_to_restore` (P0001).
  - The queue adds `invalid_section_kind` and `invalid_age` (22023).
