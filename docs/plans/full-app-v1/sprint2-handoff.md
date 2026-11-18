# Full App v1: Sprint 2 hand-off

Sprint 1 (eight foundation tasks) is merged into `feat/full-app-v1`. All 23 migrations (`20261118100000` to `107200`) apply in order on a fresh stack; typecheck, ESLint and the unit suite (383 files, 4778 tests) pass on the merged head. Each worker's full report is in [reports/](reports/): read the "For Sprint 2" section of every report your task builds on.

This file assigns the loose ends those reports name. Each Sprint 2 task owns the items in its section, on top of its row in [sprint-plan.md](sprint-plan.md).

## Migration ranges

| Task       | Range                                |
| ---------- | ------------------------------------ |
| S2-INT     | `20261118109000` to `20261118109900` |
| S2-REVIEW  | `20261118110000` to `110900`         |
| S2-STAFF   | `20261118111000` to `111900`         |
| S2-ADD     | `20261118112000` to `112900`         |
| S2-MGR     | `20261118113000` to `113900`         |
| S2-REQ     | `20261118114000` to `114900`         |
| S2-ADMIN   | `20261118115000` to `115900`         |
| S2-LIBRARY | `20261118116000` to `116900`         |
| S2-METRICS | `20261118117000` to `117900`         |

S2-INT runs before the screen tasks' migrations by timestamp. Screen tasks must not redefine a function S2-INT redefines; if you need to, say so in your report and the coordinator merges them.

## Rules carried from Sprint 1

- **Wording guards.** `tests/unit/scope-guard.test.ts` bans approval words and some feature words outside allow-listed routes, and the staff copy guard bans "due". Staff copy follows FA-7 (In the album, Kept for reference, Retake, Label corrected, Not used). Manager and admin screens may use the spec's action names ("Approve for public use", "Keep as reference"); add your routes to the guard's allow-list rather than weakening the ban.
- **One rule for coverage.** Read slot state from `public.coverage_slots` (via `getCoverageSlots` in `lib/server/album.ts`, `parseCoverage` in `lib/album/model.ts`). Do not count slots another way.
- **One visibility rule.** Colleague media goes through `private.media_visible_to_caller`. Never draw an unreviewed colleague photo for staff (FA-20).
- **Per-venue role.** New database checks use `private.venue_role_of(user, venue)`. The profile's venue is the person's active venue; `switch_active_venue` changes it.
- **Shared components.** Status words and icons live in `components/nabalens/status-chip.tsx`; slot tiles in `components/nabalens/album/slot-tile.tsx`. Check `docs/design-system/catalogue.md` before building a component.
- **Notifications** are inbox and badges only (FA-10), from `lib/server/notifications`.
- **Errors** use the shared shape in `lib/server/http/errors.ts` for new code.

## S2-INT: database integration (new task, team-07 after S2-LIBRARY, or its own account)

Wire the Sprint 1 pieces that were built in parallel and could not see each other:

1. **Sold out into coverage.** Replace the stub `private.coverage_temporarily_unavailable(kind, slot_id)` (S1-COV) with S1-MENUS' dish availability (and any amenity or area unavailability that exists). AC26: the slot stays in the total.
2. **Freshness into coverage.** Replace the stub `private.coverage_check_due(kind, slot_id, covered_since)` with S1-FACTS' rules: `private.area_photo_freshness(label_id)` for places, the fact verification state for amenities, and menu photo rechecks. In `lib/album/model.ts` `amenityState`, a complete check whose answer is not currently confirmed reads Check due and is not counted as filled (AC30).
3. **Duplicates add no coverage.** Coverage ignores assets with `duplicate_of_asset_id` set (AC21; S1-UPLOAD).
4. **Exports use the review level.** `private.export_candidate_rows` (S1-EXPORT) accepts only public-level decisions (S1-COV `review_level`); a reference photo is never exportable or publishable (AC16).
5. **Capture time in exports.** Fill `capturedAt` in `export_package_download_start` from `media_assets.captured_at` (S1-UPLOAD), "unknown" when null.
6. **Memberships everywhere.** Move `private.media_upload_venue_allowed` (S1-UPLOAD) and `private.can_view_venue_album` (S1-PRIVACY) onto memberships (S1-PEOPLE): a person may upload to and view the album of a venue where they hold an active membership and it is their active venue; admins may upload to any active venue (S3.3-upload-scope). Check the ops digest recipients (`private.effective_manager_venue_id`, S1-OPS) and export access (`can_manage_venue`, S1-EXPORT) still resolve to the venue's managers under the membership model, including a person who manages one venue and is staff at another (AC14).
7. **Admin MFA on direct role checks.** S1-PRIVACY notes a few database checks test `role = 'admin'` directly (admin label reads, one grant read) without the `aal2` rule. Move them onto `private.is_active_admin`.
8. **Policy facts need no photo (FA-32).** S1-COV treats six policy questions (guest_wifi, dogs_inside, dogs_outside, live_music, pub_quiz, curbside_pickup) as fact-only, but the amenity catalogue's evidence rule still makes a Yes include a photo (S1-FACTS). Make media optional for those keys (a catalogue version 2 if needed) so a policy Yes can be confirmed without a photo, while keeping existing answers readable.
9. **Security suite.** Fix any failure the coordinator's full security run on the merged head reports (listed below when known), and add a cross-task security test file `tests/security/full-app-integration.test.ts` covering items 1 to 8.

Coordinator's full security run on the merged head: see "Known failures" at the end of this file.

## Screen tasks: Sprint 1 items they own

- **S2-REVIEW:** add `presentation_changed` to `RecheckKind` and the review copy (S1-MENUS); show "possible duplicate" and below-public-quality flags (`belowPublicQuality`, S1-UPLOAD); a dish Not used decision (S1-COV); use `set_menu_item_photo_level`, `decide_area_photo_level`, `decide_amenity_photo` and `amenity_photo_queue` (S1-COV); reviewer handover in `remove_venue_member` once the reviewer model exists, or record it for S2-MGR.
- **S2-STAFF:** `VenueSwitcher` and `switchVenueAction` on Me; the first sign-in welcome with `CONTRIBUTION_NOTICE` and `acknowledgeNoticeAction` (S1-PEOPLE); the staff notification inbox and badge, and notification preferences on Me (S1-OPS); correcting a photo's capture time with `set_media_captured_at` (S1-UPLOAD); "request removal" on an accepted own photo (`request_media_removal`, S1-PRIVACY); receipt words from `lib/upload/states.ts` (S1-UPLOAD) and the three new words in DESIGN.md §4; Check due tiles read "Needs checking" (S1-COV).
- **S2-ADD:** the Match `SendState` additions `checking`, `sent`, `unfinished` and the upload dialog's `onProcessing` and receipts (S1-UPLOAD); staff can suggest a local special (S1-MENUS `createSpecial`) from Add photos when a dish is missing.
- **S2-MGR:** link `/manager/exports` from Overview and show `publication_overview().outstanding` (S1-EXPORT); manager review badge (S1-OPS); move the amenities archive screen to `amenity_check_set_applicability` and then remove execute on the reasonless `amenity_archive_check` (S1-MENUS); menus, specials, availability, local names and change requests screens use `lib/server/menus/local.ts` (S1-MENUS); facts confirmation ("Still right") and fact coverage (S1-FACTS); venue team with `VenueSwitcher` (S1-PEOPLE); main and backup reviewer, and reviewer handover on removal.
- **S2-REQ:** call `private.notify(..., 'assigned', ...)` when a request names a person (S1-OPS); a fact-confirmation request completes on a confirmed fact or a `knowledge_reconfirm` result (S1-FACTS).
- **S2-ADMIN:** the accommodation and scope settings screen (`getVenueScope`, `setVenueScope`, S1-MENUS); admin reset of another admin's lost authenticator (S1-PRIVACY); venue timezone and operating status edit (S1-COV columns); admin navigation now has Publishing and Settings: check it at 320 px; use `admin_set_venue_membership` for multi-venue people (S1-PEOPLE).
- **S2-LIBRARY:** `export_asset_status(asset)` (S1-EXPORT); permanent removal screen with `media_removal_impact` and `admin_delete_media_asset` and the removal request list (S1-PRIVACY); select primary for every slot kind (`set_slot_primary_photo`, `set_menu_item_primary_photo`, S1-COV); `asset_usages` (S1-COV).
- **S2-METRICS:** fact coverage from `knowledge_fact_coverage` (S1-FACTS); technical versus editorial failures separated (S1-OPS monitoring); coverage numbers from `coverage_slots` totals only (S1-COV).

## Owner actions recorded in Sprint 1 (for the release notes)

- Hosted project: raise the global upload limit to at least 250 MiB (S1-UPLOAD).
- Hosted Auth: TOTP MFA enabled (on by default); existing admins will be asked to enrol at next sign-in (S1-PRIVACY).
- Session expiry is a hosted Auth setting (S1-PEOPLE).
- After the facts migration, answers last checked over 90 days ago read Check due; staff Wi-Fi answers without manager confirmation read Unconfirmed. Preview with `knowledge_freshness_preview` before migrating (S1-FACTS).
- Restore rehearsal (AC38) needs the owner's approval to run against a hosted project (S1-OPS).
- `next build` recommended a Next.js security upgrade; not done, owner decision (S1-PRIVACY).

## Known failures

(Filled in by the coordinator after the merged-head security run.)
